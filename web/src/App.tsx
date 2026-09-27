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

function initialBuildId(): string | null {
  return new URLSearchParams(window.location.search).get("build");
}

export default function App() {
  const [buildId, setBuildId] = useState<string | null>(initialBuildId);
  const { build, loading, thinking, renderRequest } = useBuild(buildId);
  const viewer = useRef<ViewerHandle>(null);
  const [builds, setBuilds] = useState<BuildSummary[]>([]);
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
    api.builds().then(setBuilds, console.error);
  }, []);

  useEffect(refreshBuilds, [refreshBuilds, build?.status, left]);

  const open = useCallback((id: string | null) => {
    setBuildId(id);
    setStep(Infinity);
    setFollowing(true);
    setPlaying(false);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("build", id);
    else url.searchParams.delete("build");
    window.history.replaceState(null, "", url);
  }, []);

  const home = () => (GALLERY ? open(builds[0]?.id ?? null) : open(null));

  useEffect(() => {
    if (GALLERY && builds.length && !builds.some((b) => b.id === buildId)) open(builds[0].id);
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
        {loading && <span className="title">{builds.find((b) => b.id === buildId)?.name}</span>}
        {build && (
          <>
            <span className="title">{build.name}</span>
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
          <div className="tabs">
            <button className={left === "chat" ? "active" : ""} onClick={() => setLeft("chat")}>
              Chat
            </button>
            <button className={left === "library" ? "active" : ""} onClick={() => setLeft("library")}>
              Library
            </button>
          </div>
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
          {center === "model" && <ViewControls framing={framing} spin={spin} onFrame={setFraming} onSpin={setSpin} />}
        </div>
        <div className="stage">
          <div className={center === "model" ? "pane" : "pane hidden"}>
            <Viewer
              ref={viewer}
              build={build}
              loading={loading}
              step={visibleStep}
              renderRequest={renderRequest}
              framing={framing}
              spin={spin}
            />
          </div>
          {center === "parts" && build && (
            <div className="pane">
              <PartsPanel build={build} />
            </div>
          )}
        </div>
        <Timeline
          build={build}
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
      </main>
    </div>
  );
}
