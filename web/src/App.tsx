import { PlusIcon, ShoppingBagIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "./account";
import { AccountMenu, SignInButton } from "./AccountMenu";
import { create, say, stop } from "./agent";
import { useEdits } from "./edits";
import { type Build, type BuildSummary, type Piece, type Source, verified } from "./model";
import { type Color, usePalette } from "./palette";
import { usePrices } from "./pickabrick";
import { PriceMenu } from "./PriceMenu";
import { ChatPanel } from "./ChatPanel";
import { DownloadMenu } from "./DownloadMenu";
import { LibraryPage, type Shelf } from "./LibraryPage";
import { countParts, PartsPanel } from "./PartsPanel";
import { PublishButton } from "./PublishButton";
import { ShopDialog } from "./ShopDialog";
import { Timeline } from "./Timeline";
import { FilmExport } from "./FilmExport";
import { InstructionsExport } from "./InstructionsExport";
import { library, publish, remember, thumbnail, unpublish } from "./library";
import { type BuildRef, useBuild } from "./useBuild";
import { ThemeToggle } from "./ThemeToggle";
import { type Framing, type Mode, ViewControls, Viewer, type ViewerHandle } from "./Viewer";

const STEP_MS = 700;
const TITLE = document.title;
const SIGN_IN = "Sign in with your H account to build with Holo.";
/** The URL parameter naming the open build, by where it is read from. */
const PARAMS: Record<Source, string> = { session: "build", public: "public", showcase: "showcase" };

function urlBuild(): BuildRef | null {
  const params = new URLSearchParams(window.location.search);
  for (const [source, param] of Object.entries(PARAMS) as [Source, string][]) {
    const id = params.get(param);
    if (id) return { id, source };
  }
  return null;
}

const SHELF = "library";

function urlShelf(): Shelf | null {
  const shelf = new URLSearchParams(window.location.search).get(SHELF);
  return shelf === "mine" || shelf === "public" ? shelf : null;
}

const same = (a: BuildRef | null, b: BuildRef | null) => a?.id === b?.id && a?.source === b?.source;

/** Part titles from the build's verified parts list, by LDraw part. */
const titlesOf = (build: Build | null) =>
  new Map((build && verified(build.bom))?.lines.map((l) => [l.part, l.title]) ?? []);

/** Names each piece by its verified parts-list title, else its LDraw part, and its palette color. */
function describer(build: Build | null, palette: Color[]): (piece: Piece) => string {
  const titles = titlesOf(build);
  const colors = new Map(palette.map((c) => [c.code, c.name]));
  return (p) => `${titles.get(p.part) ?? p.part.replace(/\.dat$/, "")} · ${colors.get(p.color) ?? `color ${p.color}`}`;
}

export default function App() {
  const account = useAccount();
  const [ref, setRef] = useState<BuildRef | null>(urlBuild);
  const opened = useRef(ref);
  opened.current = ref;
  const [shelf, setShelf] = useState<Shelf | null>(urlShelf);
  const buildId = ref?.id ?? null;
  const { build: live, loading, thinking, renderRequest, error, syncError, answer } = useBuild(ref);
  const edits = useEdits(live);
  /** The build as shown, with this browser's hand edits. */
  const build = edits.build;
  const [mode, setMode] = useState<Mode>("view");
  const palette = usePalette();
  const prices = usePrices();
  const viewer = useRef<ViewerHandle>(null);
  const [builds, setBuilds] = useState<BuildSummary[] | null>(null);
  const [buildsFailed, setBuildsFailed] = useState(false);
  const [center, setCenter] = useState<"model" | "parts">("model");
  const [step, setStep] = useState(Infinity);
  const [following, setFollowing] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [framing, setFraming] = useState<Framing>({ view: "iso" });
  const [spin, setSpin] = useState(false);
  const [exportBuild, setExportBuild] = useState<Build | null>(null);
  const [instructionsBuild, setInstructionsBuild] = useState<Build | null>(null);
  const [shopping, setShopping] = useState<{ build: Build; preview: Promise<Blob | null> } | null>(null);
  const edited = edits.edits.length > 0 && build !== live;

  useEffect(() => {
    if (mode === "edit" && !edits.editable) setMode("view");
  }, [mode, edits.editable]);
  const shop = () => {
    if (build?.status === "done" && build.pieces.length && !edited) {
      setShopping({ build: structuredClone(build), preview: viewer.current?.image() ?? Promise.resolve(null) });
    }
  };
  const exportReplay = () => {
    if (build?.pieces.length) setExportBuild(structuredClone(build));
  };
  const last = (build?.steps.length ?? 0) - 1;

  const latest = useRef(0);
  const refreshBuilds = useCallback(() => {
    const request = ++latest.current;
    setBuildsFailed(false);
    library().then(
      (next) => request === latest.current && setBuilds(next),
      (e) => {
        if (request !== latest.current) return;
        console.error(e);
        setBuildsFailed(true);
      },
    );
  }, []);

  useEffect(() => refreshBuilds(), [refreshBuilds, account?.user.id, !!shelf]);

  const summary = builds?.find((b) => b.id === buildId && b.source === ref?.source);
  const heading = build ?? summary;
  const listed = builds?.find((b) => b.id === buildId && b.source === "public");

  useEffect(() => {
    if (build && builds && summary?.status !== build.status) refreshBuilds();
  }, [build?.id, build?.status, summary?.status]);

  useEffect(() => {
    document.title = buildId && heading ? `${heading.name} · ${TITLE}` : TITLE;
  }, [buildId, heading?.name]);

  const show = useCallback((next: BuildRef | null) => {
    setRef(next);
    setMode("view");
    setStep(Infinity);
    setFollowing(true);
    setPlaying(false);
  }, []);

  /** Show this build, with the library open on `nextShelf` over it, and put both in the URL. */
  const navigate = useCallback(
    (next: BuildRef | null, nextShelf: Shelf | null) => {
      if (!same(next, opened.current)) show(next);
      setShelf(nextShelf);
      const url = new URL(window.location.href);
      for (const param of [...Object.values(PARAMS), SHELF]) url.searchParams.delete(param);
      if (next) url.searchParams.set(PARAMS[next.source], next.id);
      if (nextShelf) url.searchParams.set(SHELF, nextShelf);
      if (url.href !== window.location.href) window.history.pushState(null, "", url);
    },
    [show],
  );
  const open = (next: BuildRef | null) => navigate(next, null);

  useEffect(() => {
    const sync = () => {
      const next = urlBuild();
      if (!same(next, opened.current)) show(next);
      setShelf(urlShelf());
    };
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
    open({ id, source: "session" });
    refreshBuilds();
  };

  const saveThumbnail = async (png: Blob) => {
    if (ref?.source !== "session") return;
    remember(ref.id, { thumbnail: await thumbnail(png) });
    refreshBuilds();
  };

  const publishBuild = async () => {
    if (!live) return;
    const png = await viewer.current?.image();
    const hand = edits.edits.length ? { revision: live.revision, edits: edits.edits } : null;
    await publish(live.id, png ? await thumbnail(png) : null, hand);
    open({ id: live.id, source: "public" });
    refreshBuilds();
  };

  const unpublishBuild = async () => {
    if (!live) return;
    await unpublish(live.id);
    if (ref?.source === "public") open({ id: live.id, source: "session" });
    refreshBuilds();
  };

  /** The signed-in user's build, from their session or as they published it. */
  const owned =
    !!account && (ref?.source === "session" || (ref?.source === "public" && summary?.owner === account.user.id));

  const unavailable = account ? null : SIGN_IN;
  const closed =
    ref?.source === "showcase" ? (
      "A showcase from the gallery. Start a new build to make your own."
    ) : ref?.source === "public" ? (
      `Shared by ${summary?.author ?? "an H builder"}. Start a new build to make your own.`
    ) : unavailable ? (
      <>
        {unavailable} <SignInButton />
      </>
    ) : build && !build.open && build.status !== "building" ? (
      "This build's session has ended. Start a new build to make another."
    ) : null;

  const visibleStep = Math.min(step, last);

  return (
    <div className="app">
      <header>
        <button className="brand" onClick={home}>
          <img className="brand-icon" src="/brick.png" alt="" />
          Brickyard
        </button>
        <button
          className={shelf ? "library-toggle active" : "library-toggle"}
          aria-pressed={!!shelf}
          onClick={() => navigate(ref, shelf ? null : account ? "mine" : "public")}
        >
          <SquaresFourIcon size={16} /> Library
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
            {ref?.source === "public" && summary?.author && <span className="chip">by {summary.author}</span>}
            {prices && build.pieces.length > 0 && <PriceMenu build={build} table={prices} edited={edited} />}
          </>
        )}
        <span className="spacer" />
        {build && account && owned && (
          <PublishButton
            published={ref?.source === "public" || !!listed}
            blocked={
              build.status === "building"
                ? "Publish once Holo answers"
                : !build.pieces.length
                  ? "Nothing is built yet"
                  : null
            }
            author={account.user.name}
            onPublish={publishBuild}
            onUnpublish={unpublishBuild}
          />
        )}
        {build && (
          <button
            className="shop-trigger"
            onClick={shop}
            disabled={build.status !== "done" || !build.pieces.length || edited}
            title={
              edited
                ? "Reset your edits to shop the verified parts list"
                : build.status === "done"
                  ? "Shop bricks with HoloTab"
                  : "Finish your build to shop its bricks"
            }
          >
            <ShoppingBagIcon size={16} /> <span>Shop bricks</span>
          </button>
        )}
        <ThemeToggle />
        <AccountMenu />
        {build && (
          <DownloadMenu
            build={build}
            image={() => viewer.current?.image() ?? Promise.resolve(null)}
            onReplay={exportReplay}
            onInstructions={() => build?.pieces.length && setInstructionsBuild(structuredClone(build))}
          />
        )}
      </header>
      <aside>
        <div className="aside-bar">
          <span className="aside-title">Chat</span>
          {ref && (
            <button className="new-build" onClick={() => open(null)}>
              <PlusIcon size={14} weight="bold" />
              New build
            </button>
          )}
        </div>
        <div className="aside-body">
          <ChatPanel
            build={live}
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
        </div>
      </aside>
      <main>
        <div className="center-bar">
          <div className="tabs">
            <button className={center === "model" ? "active" : ""} onClick={() => setCenter("model")}>
              Model
            </button>
            <button
              className={center === "parts" ? "active" : ""}
              disabled={!build}
              onClick={() => {
                setCenter("parts");
                setMode("view");
              }}
            >
              Parts
            </button>
          </div>
          {center === "model" && !error && (
            <ViewControls
              framing={framing}
              spin={spin}
              mode={mode}
              canEdit={edits.editable && !!build?.pieces.length}
              canWalk={!!build?.pieces.length}
              onFrame={(next) => {
                if (mode === "walk") setMode("view");
                setFraming(next);
              }}
              onSpin={setSpin}
              onMode={setMode}
            />
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
              mode={mode}
              edits={edits}
              describe={describer(live, palette)}
              palette={palette}
              onMode={setMode}
            />
          </div>
          {center === "parts" && build && (
            <div className="pane">
              <PartsPanel build={build} counted={edited ? countParts(build.pieces, titlesOf(live), palette) : null} />
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
        {shelf && (
          <LibraryPage
            builds={builds}
            failed={buildsFailed}
            shelf={shelf}
            signedIn={!!account}
            active={ref}
            onShelf={(next) => navigate(ref, next)}
            onRetry={refreshBuilds}
            onOpen={(b) => open({ id: b.id, source: b.source })}
          />
        )}
      </main>
      {exportBuild && <FilmExport build={exportBuild} onClose={() => setExportBuild(null)} />}
      {instructionsBuild && (
        <InstructionsExport
          build={instructionsBuild}
          describe={describer(live, palette)}
          onClose={() => setInstructionsBuild(null)}
        />
      )}
      {shopping && <ShopDialog build={shopping.build} preview={shopping.preview} onClose={() => setShopping(null)} />}
    </div>
  );
}
