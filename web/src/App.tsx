import { PlusIcon, ShoppingBagIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Account } from "./account";
import { AccountMenu } from "./AccountMenu";
import { RecoveryPanel } from "./RecoveryPanel";
import { create, remix, say, stop } from "./agent";
import { PHASES } from "./activity";
import { useEdits } from "./edits";
import { type Build, type BuildSummary, EMPTY_MODEL, type Piece, type Source, verified } from "./model";
import { type Color, usePalette } from "./palette";
import { estimate, money, usePrices } from "./pickabrick";
import { ChatPanel } from "./ChatPanel";
import { HomeShelves } from "./HomeShelves";
import { ImportBuild } from "./ImportBuild";
import { LibraryPage } from "./LibraryPage";
import { countParts, PartsPanel } from "./PartsPanel";
import { ShareMenu } from "./ShareMenu";
import { Timeline } from "./Timeline";
import {
  card,
  library,
  listing,
  LISTINGS,
  onRemember,
  publish,
  remember,
  SHELF,
  setPrivate,
  type Shelf,
  thumbnail,
  unpublish,
} from "./library";
import { label } from "./suggestions";
import { type BuildRef, useBuild } from "./useBuild";
import { useKeeper } from "./useSession";
import { type Framing, type Mode, ViewControls, Viewer, type ViewerHandle } from "./Viewer";

const FilmExport = lazy(() => import("./FilmExport").then((m) => ({ default: m.FilmExport })));
const InstructionsExport = lazy(() => import("./InstructionsExport").then((m) => ({ default: m.InstructionsExport })));
const ShopDialog = lazy(() => import("./ShopDialog").then((m) => ({ default: m.ShopDialog })));

const STEP_MS = 700;
const TITLE = document.title;
const NEW_BUILD = "New build";
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

const linkTo = (ref: BuildRef) => `${window.location.origin}/?${new URLSearchParams({ [PARAMS[ref.source]]: ref.id })}`;

const LIBRARY = "library";

const urlLibrary = () => new URLSearchParams(window.location.search).has(LIBRARY);

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

export default function App({ account }: { account: Account }) {
  const [ref, setRef] = useState<BuildRef | null>(urlBuild);
  const opened = useRef(ref);
  opened.current = ref;
  const [libraryOpen, setLibraryOpen] = useState(urlLibrary);
  const buildId = ref?.id ?? null;
  const read = useBuild(ref);
  /** What the user just asked for, shown as a starting build where they asked it, until its session answers. */
  const [draft, setDraft] = useState<{ at: BuildRef | null; build: Build; since: number } | null>(null);
  const drafted = draft && same(draft.at, ref) && read.build?.id !== draft.build.id ? draft.build : null;
  const live = drafted ?? read.build;
  const loading = read.loading && !drafted;
  const activity = drafted ? { label: PHASES.idea, since: draft!.since, work: null } : read.activity;
  const { error, syncError } = read;
  const edits = useEdits(live);
  /** The build as shown, with this browser's hand edits. */
  const build = edits.build;
  const [mode, setMode] = useState<Mode>("view");
  const palette = usePalette();
  const prices = usePrices();
  const viewer = useRef<ViewerHandle>(null);
  const [builds, setBuilds] = useState<BuildSummary[] | null>(null);
  const [buildsFailed, setBuildsFailed] = useState<Shelf[]>([]);
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
  const built = !!build?.pieces.length;

  useEffect(() => {
    if ((mode === "edit" && !edits.editable) || (mode !== "view" && !built)) setMode("view");
  }, [mode, edits.editable, built]);
  const shoppable = !!build?.pieces.length && build.status !== "building";
  const shop = () => {
    if (build && shoppable)
      setShopping({ build: structuredClone(build), preview: viewer.current?.image() ?? Promise.resolve(null) });
  };
  const resetForShopping = () => {
    edits.reset();
    if (live) setShopping((open) => open && { ...open, build: structuredClone(live) });
  };
  const price = useMemo(() => {
    const found = prices && build?.pieces.length ? estimate(build.pieces, prices) : null;
    return found?.priced ? money(found.cents, prices!, true) : null;
  }, [build?.pieces, prices]);
  const exportReplay = () => {
    if (build?.pieces.length) setExportBuild(structuredClone(build));
  };
  const exportInstructions = () => {
    if (build?.pieces.length) setInstructionsBuild(structuredClone(build));
  };
  const last = (build?.steps.length ?? 0) - 1;

  const latest = useRef(0);
  const refreshBuilds = useCallback(() => {
    const request = ++latest.current;
    return library().then(
      ({ builds: next, failed }) => {
        if (request !== latest.current) return;
        setBuilds((previous) =>
          LISTINGS.flatMap((from) =>
            (failed.includes(from) ? (previous ?? []) : next).filter((b) => listing(b) === from),
          ),
        );
        setBuildsFailed(failed.map((from) => SHELF[from]));
      },
      (e) => {
        if (request !== latest.current) return;
        console.error(e);
        setBuildsFailed(["mine", "public"]);
      },
    );
  }, []);

  useEffect(() => void refreshBuilds(), [refreshBuilds, account.user.id, libraryOpen]);
  /** Sessions this tab started, before the library lists them. */
  const started = useRef(new Set<string>());
  const mine = (id: string) => started.current.has(id) || !!builds?.some((b) => b.source === "session" && b.id === id);
  const running = [
    ...new Set([
      ...(builds ?? [])
        .filter(
          (b) => b.source === "session" && b.status === "building" && (b.id !== live?.id || live.status === "building"),
        )
        .map((b) => b.id),
      ...(live?.status === "building" && mine(live.id) ? [live.id] : []),
    ]),
  ];
  useKeeper(running, refreshBuilds);

  const summary = builds?.find((b) => b.id === buildId && b.source === ref?.source);
  const heading = build ?? summary;
  const listed = builds?.find((b) => b.id === buildId && b.source === "public");
  /** The build as anyone opens it: a showcase, or in the public library. */
  const shared: BuildRef | null =
    ref?.source === "session" ? (listed ? { id: ref.id, source: "public" } : null) : summary?.private ? null : ref;

  useEffect(() => {
    if (build && builds && summary?.status !== build.status) refreshBuilds();
  }, [build?.id, build?.status, summary?.status]);

  useEffect(() => {
    document.title = heading ? `${heading.name} · ${TITLE}` : TITLE;
  }, [heading?.name]);

  const show = useCallback((next: BuildRef | null) => {
    setRef(next);
    setDraft(null);
    setCenter("model");
    setMode("view");
    setStep(Infinity);
    setFollowing(true);
    setPlaying(false);
  }, []);

  /** Show this build, with the library over it or not, and put both in the URL. */
  const navigate = useCallback(
    (next: BuildRef | null, library: boolean) => {
      if (!same(next, opened.current)) show(next);
      setLibraryOpen(library);
      const url = new URL(window.location.href);
      for (const param of [...Object.values(PARAMS), LIBRARY]) url.searchParams.delete(param);
      if (next) url.searchParams.set(PARAMS[next.source], next.id);
      if (library) url.search += `${url.search ? "&" : "?"}${LIBRARY}`;
      if (url.href !== window.location.href) window.history.pushState(null, "", url);
    },
    [show],
  );
  const open = (next: BuildRef | null) => navigate(next, false);

  useEffect(() => {
    const sync = () => {
      const next = urlBuild();
      if (!same(next, opened.current)) show(next);
      setLibraryOpen(urlLibrary());
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [show]);

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

  /** Start a build and show it at once: a new one, or a copy of `from` that Holo changes as asked, under the same name if it is the user's. */
  const start = async (prompt: string, images: string[], from?: Build) => {
    const name = from ? (owned ? from.name : `${from.name} remix`) : (label(prompt) ?? NEW_BUILD);
    const at = opened.current;
    const since = Date.now();
    const build: Build = {
      ...EMPTY_MODEL,
      id: "",
      name,
      status: "building",
      open: false,
      messages: [{ role: "user", text: prompt, images }],
    };
    setDraft({ at, build, since });
    try {
      const id = await (from ? remix(from, prompt, images) : create(prompt, images));
      started.current.add(id);
      remember(id, { name: name.slice(0, 60), prompt });
      refreshBuilds();
      if (!same(opened.current, at)) return;
      const next: BuildRef = { id, source: "session" };
      open(next);
      setDraft({ at: next, build: { ...build, id }, since });
    } catch (e) {
      setDraft((current) => (current?.build === build ? null : current));
      throw e;
    }
  };

  /** Open a listed build: the user's public builds as their session, when they have one. */
  const openListed = (b: BuildSummary) => {
    const session = b.source === "public" && builds?.some((s) => s.source === "session" && s.id === b.id);
    open({ id: b.id, source: session ? "session" : b.source });
  };

  const saveThumbnail = async (png: Blob, revision: string) => {
    if (ref?.source === "session") remember(ref.id, { thumbnail: await thumbnail(png), revision });
  };

  useEffect(
    () =>
      onRemember((id) => {
        const shown = card(id)?.thumbnail;
        if (!shown) return;
        setBuilds((previous) =>
          previous?.some((b) => b.id === id && b.source === "session" && b.thumbnail !== shown)
            ? previous.map((b) => (b.id === id && b.source === "session" ? { ...b, thumbnail: shown } : b))
            : previous,
        );
      }),
    [],
  );

  const publishBuild = async () => {
    if (!live) return;
    const png = await viewer.current?.thumbnail();
    const hand = edits.edits.length ? { revision: live.revision, edits: edits.edits } : null;
    await publish(live.id, png ? await thumbnail(png) : null, hand);
    await refreshBuilds();
  };

  /** The signed-in user's build, from their session or as they published it. */
  const owned =
    ref?.source === "session" ? mine(ref.id) : ref?.source === "public" && summary?.owner === account.user.id;
  /** An imported build of theirs: it lives only in the library, with no session to fall back to. */
  const imported = owned && ref?.source === "public" && ref.id.startsWith("import-");

  const unpublishBuild = async () => {
    if (!live) return;
    // Unpublishing would delete an imported build; making it private keeps it under Mine.
    if (imported) await setPrivate(live.id, true);
    else {
      await unpublish(live.id);
      if (ref?.source === "public") open({ id: live.id, source: "session" });
    }
    await refreshBuilds();
  };

  const republish = async () => {
    if (!live) return;
    await setPrivate(live.id, false);
    await refreshBuilds();
  };

  const deleteBuild = async () => {
    if (!live) return;
    await unpublish(live.id);
    navigate(null, true);
    await refreshBuilds();
  };

  const closed =
    ref?.source === "showcase" ? (
      "A showcase from the gallery: remix it to make your own."
    ) : ref?.source === "public" ? (
      `Shared by ${summary?.author ?? "an H builder"}: remix it to make your own.`
    ) : ref?.source === "session" && builds && !buildsFailed.includes("mine") && !owned ? (
      "A teammate's build: remix it to make your own."
    ) : build?.status === "error" ? (
      <RecoveryPanel
        key={build.id}
        build={live!}
        edited={edited}
        onOpen={(id) => {
          started.current.add(id);
          if (opened.current?.source === "session" && opened.current.id === build.id) open({ id, source: "session" });
          refreshBuilds();
        }}
      />
    ) : null;

  const visibleStep = Math.min(step, last);
  const home = !ref && !drafted;
  /** The open build, once it is more than a request on its way. */
  const actionable = drafted ? null : build;

  return (
    <div className={`app${home ? " home" : ""}${libraryOpen ? " library" : ""}${running.length ? " has-running" : ""}`}>
      <header>
        <button className="brand" onClick={() => open(null)}>
          <img className="brand-icon" src="/brick.png" alt="" />
          <span className="button-label">Brickyard</span>
        </button>
        <button
          className={libraryOpen ? "quiet active" : "quiet"}
          aria-pressed={libraryOpen}
          onClick={() => navigate(ref, !libraryOpen)}
        >
          <SquaresFourIcon size={16} />
          <span className="button-label">Library</span>
        </button>
        {loading && summary && <span className="title">{summary.name}</span>}
        {build && (
          <>
            <span className="title" title={build.name}>
              {build.name}
            </span>
            {build.pieces.length > 0 && <span className="chip">{build.pieces.length.toLocaleString()} pieces</span>}
          </>
        )}
        <span className="spacer" />
        {actionable && (
          <ShareMenu
            build={actionable}
            link={shared && linkTo(shared)}
            loading={loading}
            publishing={
              owned
                ? {
                    published: imported ? !summary?.private : ref?.source === "public" || !!listed,
                    imported,
                    blocked:
                      actionable.status === "building"
                        ? "Publish once Holo answers"
                        : !actionable.pieces.length
                          ? "Nothing is built yet"
                          : null,
                    author: account.user.name,
                    onPublish: imported ? republish : publishBuild,
                    onUnpublish: unpublishBuild,
                  }
                : null
            }
            onDelete={imported ? deleteBuild : null}
            image={() => viewer.current?.image() ?? Promise.resolve(null)}
            onGif={exportReplay}
            onInstructions={exportInstructions}
          />
        )}
        {actionable && (
          <button
            className="primary"
            onClick={shop}
            disabled={!shoppable}
            title={
              shoppable
                ? undefined
                : actionable.pieces.length
                  ? "Get the bricks once Holo finishes"
                  : "Nothing is built yet"
            }
          >
            <ShoppingBagIcon size={16} />
            <span className="button-label">Get the bricks{price && ` · ≈ ${price}`}</span>
          </button>
        )}
        <AccountMenu account={account} building={running.length > 0} />
      </header>
      {running.length > 0 && (
        <div className="build-notice" role="note" aria-label="Keep Brickyard open">
          <strong>Keep this tab open while Holo builds:</strong> it looks at your model through it.
        </div>
      )}
      <aside>
        <div className="aside-bar">
          <span className="aside-title">Chat</span>
          {ref && (
            <button className="quiet" onClick={() => open(null)}>
              <PlusIcon size={16} />
              New build
            </button>
          )}
        </div>
        <div className="aside-body">
          {ref?.source === "session" && card(ref.id)?.recoveredFrom && (
            <p className="recovery-origin">
              Recovery attempt ·{" "}
              <a
                href={`/?build=${encodeURIComponent(card(ref.id)!.recoveredFrom!)}`}
                onClick={(event) => {
                  event.preventDefault();
                  open({ id: card(ref.id)!.recoveredFrom!, source: "session" });
                }}
              >
                Open original build
              </a>
            </p>
          )}
          <ChatPanel
            key={ref ? `${ref.source}:${ref.id}` : "new"}
            build={live}
            loading={loading}
            activity={activity}
            closed={closed}
            onCreate={start}
            onSay={async (text, images) => {
              if (build) await say(build.id, text, images);
            }}
            onStop={async () => {
              if (build) await stop(build.id);
            }}
            onRemix={async (text, images) => {
              if (build) await start(text, images, build);
            }}
          />
          {home && builds && (
            <HomeShelves
              builds={builds}
              me={account.user.id}
              onOpen={openListed}
              onLibrary={() => navigate(null, true)}
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
              canEdit={edits.editable && built}
              built={built}
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
              syncError={syncError}
              framing={framing}
              spin={spin}
              onThumbnail={ref?.source === "session" && owned ? saveThumbnail : undefined}
              thumbnailed={ref?.source === "session" && owned ? card(ref.id)?.revision : undefined}
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
        {!error && (!build || built) && (
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
            spaceKey={mode !== "walk"}
          />
        )}
        {libraryOpen && (
          <LibraryPage
            builds={builds}
            failed={buildsFailed}
            active={ref}
            onRetry={refreshBuilds}
            onClose={() => navigate(ref, false)}
            onOpen={openListed}
            me={account.user.id}
            mineActions={
              <ImportBuild
                onImported={(id) => {
                  refreshBuilds();
                  open({ id, source: "public" });
                }}
              />
            }
          />
        )}
      </main>
      <Suspense>{exportBuild && <FilmExport build={exportBuild} onClose={() => setExportBuild(null)} />}</Suspense>
      <Suspense>
        {instructionsBuild && (
          <InstructionsExport
            build={instructionsBuild}
            describe={describer(live, palette)}
            onClose={() => setInstructionsBuild(null)}
          />
        )}
      </Suspense>
      <Suspense>
        {shopping && (
          <ShopDialog
            build={shopping.build}
            preview={shopping.preview}
            table={prices}
            edited={edited}
            describe={describer(live, palette)}
            onReset={resetForShopping}
            onClose={() => setShopping(null)}
          />
        )}
      </Suspense>
    </div>
  );
}
