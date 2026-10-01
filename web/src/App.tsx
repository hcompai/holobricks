import { PlusIcon, ShoppingBagIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Account } from "./account";
import { AccountMenu } from "./AccountMenu";
import { RecoveryPanel } from "./RecoveryPanel";
import { create, say, stop } from "./agent";
import { ForkDialog } from "./ForkDialog";
import { HistoryPanel } from "./HistoryPanel";
import { design, useHistory, type Version } from "./history";
import type { ForkOrigin } from "./fork";
import { provideParts } from "./scene";
import { useEdits } from "./edits";
import { type Build, type BuildSummary, type Piece, type Source, verified } from "./model";
import { type Color, usePalette } from "./palette";
import { usePrices } from "./pickabrick";
import { PriceMenu } from "./PriceMenu";
import { ChatPanel } from "./ChatPanel";
import { CopyLink } from "./CopyLink";
import { DownloadMenu } from "./DownloadMenu";
import { ImportBuild } from "./ImportBuild";
import { LibraryPage } from "./LibraryPage";
import { countParts, PartsPanel } from "./PartsPanel";
import { DeleteButton } from "./DeleteButton";
import { PublishButton } from "./PublishButton";
import { ShopDialog } from "./ShopDialog";
import { Timeline } from "./Timeline";
import { FilmExport } from "./FilmExport";
import { InstructionsExport } from "./InstructionsExport";
import { card, library, publish, remember, setPrivate, type Shelf, thumbnail, unpublish } from "./library";
import { type BuildRef, useBuild } from "./useBuild";
import { useKeeper } from "./useSession";
import { ThemeToggle } from "./ThemeToggle";
import { type Framing, type Mode, ViewControls, Viewer, type ViewerHandle } from "./Viewer";

const STEP_MS = 700;
const TITLE = document.title;
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
const urlVersion = () => {
  const n = Number(new URLSearchParams(window.location.search).get("version"));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

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
  const { build: live, loading, activity, error, syncError, models, seed } = useBuild(ref);
  const edits = useEdits(live);
  const [historyOpen, setHistoryOpen] = useState(() => urlVersion() !== null);
  const [wantedVersion, setWantedVersion] = useState<number | null>(urlVersion);
  const [selected, setSelected] = useState<Version | null>(null);
  const [forking, setForking] = useState<{ build: Build; origin: ForkOrigin } | null>(null);
  const history = useHistory(
    ref?.source === "session" ? ref.id : null,
    models,
    seed?.model ?? null,
    historyOpen || wantedVersion !== null,
  );
  const previewing = selected !== null || wantedVersion !== null;
  useEffect(() => {
    if (wantedVersion === null || history.loading || history.error || loading) return;
    const version = history.versions.find((v) => v.number === wantedVersion);
    if (!version) return;
    provideParts(version.model.parts);
    setSelected(version);
    setWantedVersion(null);
  }, [wantedVersion, history.versions, history.loading, history.error, loading]);
  /** Preview never replaces the live model used by the builder or the manual-edit state. */
  const build =
    wantedVersion !== null
      ? null
      : selected && live
        ? { ...live, ...selected.model, name: live.name, open: false }
        : edits.build;
  const [mode, setMode] = useState<Mode>("view");
  const palette = usePalette();
  const prices = usePrices();
  const viewer = useRef<ViewerHandle>(null);
  const [builds, setBuilds] = useState<BuildSummary[] | null>(null);
  const [buildsFailed, setBuildsFailed] = useState<Shelf[]>([]);
  const [center, setCenter] = useState<"model" | "parts">("model");
  const [starting, setStarting] = useState(false);
  const [step, setStep] = useState(Infinity);
  const [following, setFollowing] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [framing, setFraming] = useState<Framing>({ view: "iso" });
  const [spin, setSpin] = useState(false);
  const [exportBuild, setExportBuild] = useState<Build | null>(null);
  const [instructionsBuild, setInstructionsBuild] = useState<Build | null>(null);
  const [shopping, setShopping] = useState<{ build: Build; preview: Promise<Blob | null> } | null>(null);
  const edited = !previewing && edits.edits.length > 0 && build !== live;

  useEffect(() => {
    if (mode === "edit" && (!edits.editable || previewing)) setMode("view");
  }, [mode, edits.editable, previewing]);
  const shop = () => {
    if (build?.status === "done" && build.pieces.length && !edited) {
      setShopping({ build: structuredClone(build), preview: viewer.current?.image() ?? Promise.resolve(null) });
    }
  };
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
        const kept = (shelf: Shelf, previous: BuildSummary[] | null) =>
          failed.includes(shelf) ? (previous ?? []).filter((b) => (b.source === "session") === (shelf === "mine")) : [];
        setBuilds((previous) => [...kept("mine", previous), ...next, ...kept("public", previous)]);
        setBuildsFailed(failed);
      },
      (e) => {
        if (request !== latest.current) return;
        console.error(e);
        setBuildsFailed(["mine", "public"]);
      },
    );
  }, []);

  useEffect(() => void refreshBuilds(), [refreshBuilds, account.user.id, libraryOpen]);
  const running = [
    ...new Set([
      ...(builds ?? [])
        .filter(
          (b) => b.source === "session" && b.status === "building" && (b.id !== live?.id || live.status === "building"),
        )
        .map((b) => b.id),
      ...(live?.status === "building" ? [live.id] : []),
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
    if (live && builds && summary?.status !== live.status) refreshBuilds();
  }, [live?.id, live?.status, summary?.status]);

  useEffect(() => {
    document.title = buildId && heading ? `${heading.name} · ${TITLE}` : TITLE;
  }, [buildId, heading?.name]);

  const show = useCallback((next: BuildRef | null, version: number | null = null) => {
    setRef(next);
    setCenter("model");
    setMode("view");
    setStep(Infinity);
    setFollowing(true);
    setPlaying(false);
    setHistoryOpen(version !== null);
    setWantedVersion(version);
    setSelected(null);
    setForking(null);
  }, []);

  /** Show this build, with the library over it or not, and put both in the URL. */
  const navigate = useCallback(
    (next: BuildRef | null, library: boolean) => {
      const changed = !same(next, opened.current);
      if (changed) show(next);
      setLibraryOpen(library);
      const url = new URL(window.location.href);
      for (const param of [...Object.values(PARAMS), LIBRARY]) url.searchParams.delete(param);
      if (changed) url.searchParams.delete("version");
      if (next) url.searchParams.set(PARAMS[next.source], next.id);
      if (library) url.search += `${url.search ? "&" : "?"}${LIBRARY}`;
      if (url.href !== window.location.href) window.history.pushState(null, "", url);
    },
    [show],
  );
  const open = (next: BuildRef | null) => {
    navigate(next, false);
    if (same(next, opened.current)) {
      show(next);
      const url = new URL(window.location.href);
      url.searchParams.delete("version");
      window.history.replaceState(null, "", url);
    }
  };

  useEffect(() => {
    const sync = () => {
      const next = urlBuild();
      show(next, urlVersion());
      setLibraryOpen(urlLibrary());
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
    setStarting(true);
    try {
      const id = await create(prompt, images);
      const name = prompt || "Untitled build";
      remember(id, { name: name.slice(0, 60), prompt });
      open({ id, source: "session" });
      refreshBuilds();
    } finally {
      setStarting(false);
    }
  };

  const saveThumbnail = async (png: Blob) => {
    if (previewing || ref?.source !== "session") return;
    remember(ref.id, { thumbnail: await thumbnail(png) });
    refreshBuilds();
  };

  const publishBuild = async () => {
    if (!live || previewing) return;
    const png = await viewer.current?.thumbnail();
    const hand = edits.edits.length ? { revision: live.revision, edits: edits.edits } : null;
    await publish(live.id, png ? await thumbnail(png) : null, hand);
    await refreshBuilds();
  };

  /** The signed-in user's build, from their session or as they published it. */
  const owned = ref?.source === "session" || (ref?.source === "public" && summary?.owner === account.user.id);
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
      "Showcase · Fork to edit"
    ) : ref?.source === "public" ? (
      `By ${summary?.author ?? "an H builder"} · Fork to edit`
    ) : build && !build.open && build.status !== "building" ? (
      <RecoveryPanel
        key={build.id}
        build={live!}
        edited={edited}
        onOpen={(id) => {
          if (opened.current?.source === "session" && opened.current.id === build.id) open({ id, source: "session" });
          refreshBuilds();
        }}
      />
    ) : null;

  const visibleStep = Math.min(step, last);
  const selectVersion = (version: Version | null) => {
    setWantedVersion(null);
    const url = new URL(window.location.href);
    if (version) url.searchParams.set("version", String(version.number));
    else url.searchParams.delete("version");
    window.history.replaceState(null, "", url);
    if (version) provideParts(version.model.parts);
    setSelected(version);
    setMode("view");
    setCenter("model");
    setFollowing(true);
    setStep(Infinity);
    setPlaying(false);
  };
  const beginFork = () => {
    if (!build?.pieces.length || !ref || wantedVersion !== null) return;
    const saved = !edited && [...history.versions].reverse().find((v) => design(v.model) === design(build));
    setForking({
      build: structuredClone(build),
      origin: {
        ...ref,
        name: build.name,
        version: selected?.number ?? (saved ? saved.number : null),
        revision: build.revision,
      },
    });
  };
  const preview = previewing && (
    <>
      <strong>
        {selected
          ? `Preview · V${selected.number}`
          : history.loading || loading
            ? "Opening version…"
            : "Version unavailable"}
      </strong>
      <div>
        <button onClick={() => selectVersion(null)}>Latest</button>
        <button disabled={!selected} onClick={beginFork}>
          Fork
        </button>
      </div>
    </>
  );

  return (
    <div className={`app${running.length ? " has-running" : ""}${historyOpen ? " has-history" : ""}`}>
      <header>
        <button className="brand" onClick={home}>
          <img className="brand-icon" src="/brick.png" alt="" />
          Brickyard
        </button>
        <button
          className={libraryOpen ? "library-toggle active" : "library-toggle"}
          aria-pressed={libraryOpen}
          onClick={() => navigate(ref, !libraryOpen)}
        >
          <SquaresFourIcon size={16} /> <span>Library</span>
        </button>
        {loading && summary && <span className="title">{summary.name}</span>}
        {build && (
          <>
            <span className="title" title={build.name}>
              {build.name}
            </span>
            {build.pieces.length > 0 && (
              <>
                <span className="chip">{build.pieces.length.toLocaleString()} pieces</span>
                <span className="chip">{build.steps.length} steps</span>
              </>
            )}
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
        {build && owned && !previewing && (
          <PublishButton
            published={imported ? !summary?.private : ref?.source === "public" || !!listed}
            imported={imported}
            blocked={
              build.status === "building"
                ? "Publish once Holo answers"
                : !build.pieces.length
                  ? "Nothing is built yet"
                  : null
            }
            author={account.user.name}
            onPublish={imported ? republish : publishBuild}
            onUnpublish={unpublishBuild}
          />
        )}
        {build && shared && !previewing && <CopyLink url={linkTo(shared)} />}
        {build && imported && !previewing && <DeleteButton name={build.name} onDelete={deleteBuild} />}
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
        <AccountMenu account={account} building={running.length > 0} />
        {build && <DownloadMenu build={build} image={() => viewer.current?.image() ?? Promise.resolve(null)} />}
      </header>
      {running.length > 0 && (
        <div className="build-notice" role="note" aria-label="Keep Brickyard open">
          <strong>Keep this tab open while Holo builds.</strong> Your browser renders the model for Holo. You can browse
          within Brickyard; closing this tab, leaving the site or sleeping your device can interrupt the build.
        </div>
      )}
      <aside>
        <div className="aside-bar">
          <span className="aside-title">{previewing ? "Latest chat" : "Chat"}</span>
          {ref && (
            <button className="new-build" onClick={() => open(null)}>
              <PlusIcon size={14} weight="bold" />
              New build
            </button>
          )}
        </div>
        <div className="aside-body">
          {seed && (
            <p className="recovery-origin">
              Fork of{" "}
              <a
                href={`${linkTo(seed.origin)}${seed.origin.version ? `&version=${seed.origin.version}` : ""}`}
                onClick={(event) => {
                  event.preventDefault();
                  const origin = seed.origin;
                  open({ id: origin.id, source: origin.source });
                  if (origin.version) {
                    setWantedVersion(origin.version);
                    setHistoryOpen(true);
                    window.history.replaceState(null, "", `${linkTo(origin)}&version=${origin.version}`);
                  }
                }}
              >
                {seed.origin.name}
                {seed.origin.version ? ` · V${seed.origin.version}` : ""}
              </a>
            </p>
          )}
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
            preview={preview}
            onCreate={start}
            onSay={async (text, images) => {
              if (live?.open && !previewing && ref?.source === "session") await say(live.id, text, images);
            }}
            onStop={async () => {
              if (live && !previewing && ref?.source === "session") await stop(live.id);
            }}
            onFork={beginFork}
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
          {build && (build.pieces.length > 0 || models.length > 0) && (
            <div className="history-tools">
              {selected && <span className="preview-badge">Preview · V{selected.number}</span>}
              {ref?.source === "session" && (
                <button aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)}>
                  History
                </button>
              )}
              <button disabled={!build.pieces.length || wantedVersion !== null} onClick={beginFork}>
                Fork
              </button>
            </div>
          )}
          {center === "model" && !error && (
            <ViewControls
              framing={framing}
              spin={spin}
              mode={mode}
              canEdit={!previewing && edits.editable && !!build?.pieces.length}
              editHint={previewing ? "Edit Latest or Fork" : undefined}
              canWalk={!!build?.pieces.length}
              onFrame={(next) => {
                if (mode === "walk") setMode("view");
                setFraming(next);
              }}
              onSpin={setSpin}
              onMode={(mode) => {
                if (mode !== "edit" || !previewing) setMode(mode);
              }}
            />
          )}
        </div>
        {historyOpen && (
          <HistoryPanel
            {...history}
            selected={selected?.id ?? null}
            onRetry={history.retry}
            onSelect={selectVersion}
            onClose={() => setHistoryOpen(false)}
          />
        )}
        <div className="stage">
          <div className={center === "model" ? "pane" : "pane hidden"}>
            <Viewer
              ref={viewer}
              build={build}
              opening={
                buildId && !error ? `Opening ${heading?.name ?? "the build"}` : starting ? "Starting Holo…" : null
              }
              step={visibleStep}
              syncError={selected ? null : syncError}
              framing={framing}
              spin={spin}
              onThumbnail={saveThumbnail}
              empty="Describe a model in the chat to start building."
              mode={mode}
              edits={previewing ? { ...edits, editable: false, stale: 0, hidden: 0 } : edits}
              describe={describer(build, palette)}
              palette={palette}
              onMode={(mode) => {
                if (mode !== "edit" || !previewing) setMode(mode);
              }}
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
            onInstructions={exportInstructions}
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
            onOpen={(b) => {
              const mine = b.source === "public" && builds?.some((s) => s.source === "session" && s.id === b.id);
              open({ id: b.id, source: mine ? "session" : b.source });
            }}
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
      {exportBuild && <FilmExport build={exportBuild} onClose={() => setExportBuild(null)} />}
      {instructionsBuild && (
        <InstructionsExport
          build={instructionsBuild}
          describe={describer(build, palette)}
          onClose={() => setInstructionsBuild(null)}
        />
      )}
      {shopping && <ShopDialog build={shopping.build} preview={shopping.preview} onClose={() => setShopping(null)} />}
      {forking && (
        <ForkDialog
          {...forking}
          onClose={() => setForking(null)}
          onCreated={(id) => {
            setForking(null);
            open({ id, source: "session" });
            refreshBuilds();
          }}
        />
      )}
    </div>
  );
}
