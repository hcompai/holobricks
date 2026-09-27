import { PlusIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, GALLERY, type BuildSummary } from "./api";
import { ChatPanel } from "./ChatPanel";
import { DownloadMenu } from "./DownloadMenu";
import { LibraryPanel } from "./LibraryPanel";
import { PartsPanel } from "./PartsPanel";
import { Timeline } from "./Timeline";
import { useBuild } from "./useBuild";
import { ThemeToggle } from "./ThemeToggle";
import { type Framing, ViewControls, Viewer, type ViewerHandle } from "./Viewer";

const STEP_MS = 700;
const TITLE = document.title;

function urlBuildId(): string | null {
  return new URLSearchParams(window.location.search).get("build");
}

export default function App() {
  const [buildId, setBuildId] = useState<string | null>(urlBuildId);
  const { build, loading, thinking, renderRequest, error } = useBuild(buildId);
  const viewer = useRef<ViewerHandle>(null);
  const [builds, setBuilds] = useState<BuildSummary[] | null>(null);
  const [buildsFailed, setBuildsFailed] = useState(false);
  const [left, setLeft] = useState<"chat" | "library">(GALLERY ? "library" : "chat");
  const [center, setCenter] = useState<"model" | "parts">("model");
  const [step, setStep] = useState(Infinity);
  const [following, setFollowing] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [framing, setFraming] = useState<Framing>({ view: "iso" });
  const [spin, setSpin] = useState(false);
  const last = (build?.steps.length ?? 0) - 1;

  const refreshBuilds = useCallback(() => {
    setBuildsFailed(false);
    api.builds().then(setBuilds, (e) => {
      console.error(e);
      setBuildsFailed(true);
    });
  }, []);

  useEffect(refreshBuilds, [refreshBuilds]);

  const summary = builds?.find((b) => b.id === buildId);
  const heading = build ?? summary;

  useEffect(() => {
    if (build && builds && summary?.status !== build.status) refreshBuilds();
  }, [build?.id, build?.status, summary?.status]);

  useEffect(() => {
    document.title = buildId && heading ? `${heading.name} · ${TITLE}` : TITLE;
  }, [buildId, heading?.name]);

  const show = useCallback((id: string | null) => {
    setBuildId(id);
    setStep(Infinity);
    setFollowing(true);
    setPlaying(false);
  }, []);

  const open = useCallback(
    (id: string | null, replace = false) => {
      show(id);
      if (id === urlBuildId()) return;
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("build", id);
      else url.searchParams.delete("build");
      window.history[replace ? "replaceState" : "pushState"](null, "", url);
    },
    [show],
  );

  useEffect(() => {
    const sync = () => show(urlBuildId());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [show]);

  const home = () => (GALLERY ? open(builds?.[0]?.id ?? null) : open(null));

  useEffect(() => {
    if (GALLERY && builds?.length && !builds.some((b) => b.id === buildId)) open(builds[0].id, true);
  }, [buildId, builds, open]);

  useEffect(() => {
    if (following) setStep(last);
  }, [following, last]);

  useEffect(() => {
    if (!playing) return;
    if (step >= last) {
      setPlaying(false);
      setFollowing(true);
      return;
    }
    const timer = setTimeout(() => setStep((s) => s + 1), STEP_MS / speed);
    return () => clearTimeout(timer);
  }, [playing, speed, step, last]);

  const scrub = (s: number) => {
    setPlaying(false);
    setStep(s);
    setFollowing(s >= last);
  };

  const create = async (prompt: string, images: string[]) => {
    const created = await api.create(prompt, images);
    open(created.id);
    setLeft("chat");
    refreshBuilds();
  };

  const visibleStep = Math.min(step, last);

  return (
    <div className="app">
      <header>
        <button className="brand" onClick={home}>
          <img className="brand-icon" src="/brick.png" alt="" />
          Brickyard
        </button>
        {loading && summary && <span className="title">{summary.name}</span>}
        {build && (
          <>
            <span className="title" title={build.name}>
              {build.name}
            </span>
            <span className="chip">{build.pieces.length.toLocaleString()} pieces</span>
            <span className="chip">{build.steps.length} steps</span>
            {build.width > 0 && (
              <span className="chip">
                {build.width}×{build.depth} studs
              </span>
            )}
          </>
        )}
        <span className="spacer" />
        <ThemeToggle />
        {build && <DownloadMenu build={build} image={() => viewer.current?.image() ?? Promise.resolve(null)} />}
      </header>
      <aside>
        <div className="aside-bar">
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={left === "chat"}
              className={left === "chat" ? "active" : ""}
              onClick={() => setLeft("chat")}
            >
              Chat
            </button>
            <button
              role="tab"
              aria-selected={left === "library"}
              className={left === "library" ? "active" : ""}
              onClick={() => setLeft("library")}
            >
              Library
            </button>
          </div>
          {buildId && !GALLERY && (
            <button
              className="new-build"
              onClick={() => {
                open(null);
                setLeft("chat");
              }}
            >
              <PlusIcon size={14} weight="bold" />
              New build
            </button>
          )}
        </div>
        <div className="aside-body">
          {left === "chat" ? (
            <ChatPanel
              build={build}
              loading={loading}
              thinking={thinking}
              onCreate={create}
              onSay={async (text, images) => {
                if (build) await api.say(build.id, text, images);
              }}
            />
          ) : (
            <LibraryPanel
              builds={builds}
              failed={buildsFailed}
              onRetry={refreshBuilds}
              activeId={buildId}
              onOpen={(id) => {
                open(id);
                if (!GALLERY) setLeft("chat");
              }}
            />
          )}
        </div>
      </aside>
      <main>
        <div className="center-bar">
          <div className="tabs">
            <button className={center === "model" ? "active" : ""} onClick={() => setCenter("model")}>
              Model
            </button>
            <button className={center === "parts" ? "active" : ""} disabled={!build} onClick={() => setCenter("parts")}>
              Parts
            </button>
          </div>
          {center === "model" && !error && (
            <ViewControls framing={framing} spin={spin} onFrame={setFraming} onSpin={setSpin} />
          )}
        </div>
        <div className="stage">
          <div className={center === "model" ? "pane" : "pane hidden"}>
            <Viewer
              ref={viewer}
              build={build}
              opening={buildId && !error ? `Opening ${heading?.name ?? "the build"}` : null}
              step={visibleStep}
              renderRequest={renderRequest}
              framing={framing}
              spin={spin}
              thumbnailFresh={
                builds && build ? summary?.thumbnail != null && summary.thumbnail >= build.updated * 1000 : undefined
              }
              onThumbnail={refreshBuilds}
            />
          </div>
          {center === "parts" && build && (
            <div className="pane">
              <PartsPanel build={build} />
            </div>
          )}
          {error && (
            <div className="pane notice" role="alert">
              <b>{error}</b>
              <button onClick={() => open(null)}>Back to the start</button>
            </div>
          )}
        </div>
        {!error && (
          <Timeline
            build={build}
            loading={loading}
            step={visibleStep}
            playing={playing}
            speed={speed}
            onStep={scrub}
            onPlay={(p) => {
              setFollowing(false);
              setPlaying(p);
            }}
            onSpeed={setSpeed}
          />
        )}
      </main>
    </div>
  );
}
