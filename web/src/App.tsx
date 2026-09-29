import { PlusIcon, ShoppingBagIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { create, say, stop, unavailable } from "./agent";
import type { Build, BuildSummary } from "./api";
import { ChatPanel } from "./ChatPanel";
import { DownloadMenu } from "./DownloadMenu";
import { LibraryPanel } from "./LibraryPanel";
import { PartsPanel } from "./PartsPanel";
import { ShopDialog } from "./ShopDialog";
import { Timeline } from "./Timeline";
import { FilmExport } from "./FilmExport";
import { library, remember, thumbnail } from "./library";
import { type BuildRef, useBuild } from "./useBuild";
import { ThemeToggle } from "./ThemeToggle";
import { type Framing, ViewControls, Viewer, type ViewerHandle } from "./Viewer";

const STEP_MS = 700;
const TITLE = document.title;

function urlBuild(): BuildRef | null {
  const params = new URLSearchParams(window.location.search);
  const session = params.get("build");
  const showcase = params.get("showcase");
  return session ? { id: session, showcase: false } : showcase ? { id: showcase, showcase: true } : null;
}

const same = (a: BuildRef | null, b: BuildRef | null) => a?.id === b?.id && a?.showcase === b?.showcase;

export default function App() {
  const [ref, setRef] = useState<BuildRef | null>(urlBuild);
  const buildId = ref?.id ?? null;
  const { build, loading, thinking, renderRequest, error, syncError, answer } = useBuild(ref);
  const viewer = useRef<ViewerHandle>(null);
  const [builds, setBuilds] = useState<BuildSummary[] | null>(null);
  const [buildsFailed, setBuildsFailed] = useState(false);
  const [left, setLeft] = useState<"chat" | "library">("chat");
  const [center, setCenter] = useState<"model" | "parts">("model");
  const [step, setStep] = useState(Infinity);
  const [following, setFollowing] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [framing, setFraming] = useState<Framing>({ view: "iso" });
  const [spin, setSpin] = useState(false);
  const [exportBuild, setExportBuild] = useState<Build | null>(null);
  const [shopping, setShopping] = useState<{ build: Build; preview: Promise<Blob | null> } | null>(null);
  const shop = () => {
    if (build?.status === "done" && build.pieces.length) {
      setShopping({ build: structuredClone(build), preview: viewer.current?.image() ?? Promise.resolve(null) });
    }
  };
  const exportReplay = () => {
    if (build?.pieces.length) setExportBuild(structuredClone(build));
  };
  const last = (build?.steps.length ?? 0) - 1;

  const refreshBuilds = useCallback(() => {
    setBuildsFailed(false);
    library().then(setBuilds, (e) => {
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

  const show = useCallback((next: BuildRef | null) => {
    setRef(next);
    setStep(Infinity);
    setFollowing(true);
    setPlaying(false);
  }, []);

  const open = useCallback(
    (next: BuildRef | null) => {
      show(next);
      if (same(next, urlBuild())) return;
      const url = new URL(window.location.href);
      url.searchParams.delete("build");
      url.searchParams.delete("showcase");
      if (next) url.searchParams.set(next.showcase ? "showcase" : "build", next.id);
      window.history.pushState(null, "", url);
    },
    [show],
  );

  useEffect(() => {
    const sync = () => show(urlBuild());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [show]);

  const home = () => open(null);

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

  const start = async (prompt: string, images: string[]) => {
    const id = await create(prompt, images);
    remember(id, { name: prompt.slice(0, 60) || "Untitled build", prompt });
    open({ id, showcase: false });
    setLeft("chat");
    refreshBuilds();
  };

  const saveThumbnail = async (png: Blob) => {
    if (!ref || ref.showcase) return;
    remember(ref.id, { thumbnail: await thumbnail(png) });
    refreshBuilds();
  };

  const closed =
    unavailable ??
    (ref?.showcase
      ? "A showcase from the gallery. Start a new build to make your own."
      : build && !build.open && build.status !== "building"
        ? "This build's session has ended. Start a new build to make another."
        : null);

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
        {build && (
          <button
            className="shop-trigger"
            onClick={shop}
            disabled={build.status !== "done" || !build.pieces.length}
            title={build.status === "done" ? "Shop bricks with HoloTab" : "Finish your build to shop its bricks"}
          >
            <ShoppingBagIcon size={16} /> <span>Shop bricks</span>
          </button>
        )}
        <ThemeToggle />
        {build && (
          <DownloadMenu
            build={build}
            image={() => viewer.current?.image() ?? Promise.resolve(null)}
            onReplay={exportReplay}
          />
        )}
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
          {ref && (
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
              closed={closed}
              onCreate={start}
              onSay={async (text, images) => {
                if (build) await say(build.id, text, images);
              }}
              onStop={async () => {
                if (build) await stop(build.id);
              }}
            />
          ) : (
            <LibraryPanel
              builds={builds}
              failed={buildsFailed}
              onRetry={refreshBuilds}
              activeId={buildId}
              onOpen={(b) => {
                open({ id: b.id, showcase: b.showcase });
                setLeft("chat");
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
              syncError={syncError}
              framing={framing}
              spin={spin}
              onRender={answer}
              onThumbnail={saveThumbnail}
              empty={unavailable ?? "Describe a model in the chat to start building."}
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
            onReplay={exportReplay}
          />
        )}
      </main>
      {exportBuild && <FilmExport build={exportBuild} onClose={() => setExportBuild(null)} />}
      {shopping && <ShopDialog build={shopping.build} preview={shopping.preview} onClose={() => setShopping(null)} />}
    </div>
  );
}
