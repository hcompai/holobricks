import { PlusIcon, ShoppingBagIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Account } from "./account";
import { AccountMenu } from "./AccountMenu";
import { RecoveryPanel } from "./RecoveryPanel";
import { create, remix, say, stop } from "./agent";
import { ProjectTitle } from "./ProjectTitle";
import { useProjectNames } from "./useProjectNames";
import { HistoryPanel } from "./HistoryPanel";
import { design, useHistory, type Version } from "./history";
import { startFork, forkSeed, type ForkSeed } from "./fork";
import { provideParts } from "./scene";
import { PHASES } from "./activity";
import { useEdits } from "./edits";
import { type Build, type BuildSummary, EMPTY_MODEL, type Piece, type Source, verified } from "./model";
import { type Color, usePalette } from "./palette";
import { estimate, money, usePrices } from "./pickabrick";
import { ChatPanel } from "./ChatPanel";
import { HomeShelves } from "./HomeShelves";
import { ImportBuild } from "./ImportBuild";
import { countParts, PartsPanel } from "./PartsPanel";
import { ShareMenu } from "./ShareMenu";
import { Timeline } from "./Timeline";
import {
  card,
  copyModel,
  library,
  LibraryError,
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
/** The phone breakpoint of styles.css. */
const PHONE = window.matchMedia("(max-width: 760px)");
const onPhoneChange = (change: () => void) => {
  PHONE.addEventListener("change", change);
  return () => PHONE.removeEventListener("change", change);
};
/** The URL parameter naming the open build, by where it is read from. */
const PARAMS: Record<Source, string> = { session: "build", public: "public", showcase: "showcase", fork: "fork" };

function urlBuild(): BuildRef | null {
  const params = new URLSearchParams(window.location.search);
  for (const [source, param] of Object.entries(PARAMS) as [Source, string][]) {
    const id = params.get(param);
    if (id) return { id, source };
  }
  return null;
}

const linkTo = (ref: BuildRef) => `${window.location.origin}/?${new URLSearchParams({ [PARAMS[ref.source]]: ref.id })}`;

const urlVersion = () => {
  const n = Number(new URLSearchParams(window.location.search).get("version"));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

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
  const buildId = ref?.id ?? null;
  const read = useBuild(ref);
  const { names, rename } = useProjectNames(account.user.id);
  /** What the user just asked for, shown as a starting build where they asked it, until its session answers. */
  const [draft, setDraft] = useState<{ at: BuildRef | null; build: Build; since: number } | null>(null);
  const drafted = draft && same(draft.at, ref) && read.build?.id !== draft.build.id ? draft.build : null;
  const rawLive = drafted ?? read.build;
  const live = useMemo(
    () => (rawLive && ref && names[ref.id] ? { ...rawLive, name: names[ref.id].name } : rawLive),
    [rawLive, ref?.id, names],
  );
  const loading = read.loading && !drafted;
  const activity = drafted ? { label: PHASES.idea, since: draft!.since, work: null } : read.activity;
  const { error, syncError, models, seed, runId, attachSession } = read;
  const edits = useEdits(live);
  const [historyOpen, setHistoryOpen] = useState(() => urlVersion() !== null);
  const [wantedVersion, setWantedVersion] = useState<number | null>(urlVersion);
  const [selected, setSelected] = useState<Version | null>(null);
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState("");
  const copyAttempt = useRef<{ key: string; id: string; seed: ForkSeed } | null>(null);
  const history = useHistory(
    ref && (ref.source === "session" || ref.source === "fork") ? ref.id : null,
    models,
    seed?.model ?? null,
    historyOpen || wantedVersion !== null,
  );
  const previewing = selected !== null || wantedVersion !== null;
  const readOnly = previewing;
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
  const [loadedBuilds, setBuilds] = useState<BuildSummary[] | null>(null);
  const builds = useMemo(
    () => loadedBuilds?.map((b) => (names[b.id] ? { ...b, name: names[b.id].name } : b)) ?? null,
    [loadedBuilds, names],
  );
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
  const edited = !readOnly && edits.edits.length > 0 && build !== live;
  const phone = useSyncExternalStore(onPhoneChange, () => PHONE.matches);
  const built = !!build?.pieces.length;

  useEffect(() => {
    if ((mode === "edit" && (!edits.editable || readOnly)) || (mode !== "view" && !built)) setMode("view");
  }, [mode, edits.editable, built, readOnly]);
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

  const home = !ref && !drafted;
  useEffect(() => void refreshBuilds(), [refreshBuilds, account.user.id, home]);
  /** Sessions this tab started, before the library lists them. */
  const started = useRef(new Set<string>());
  const mine = (id: string) =>
    started.current.has(id) ||
    !!builds?.some((b) => (b.source === "session" || b.source === "fork") && (b.sessionId ?? b.id) === id);
  const running = [
    ...new Set([
      ...(builds ?? [])
        .filter(
          (b) =>
            (b.source === "session" || b.source === "fork") &&
            b.status === "building" &&
            ((b.sessionId ?? b.id) !== runId || live?.status === "building"),
        )
        .map((b) => b.sessionId ?? b.id),
      ...(live?.status === "building" && runId && mine(runId) ? [runId] : []),
    ]),
  ];
  useKeeper(running, refreshBuilds);

  const summary = builds?.find((b) => b.id === buildId && b.source === ref?.source);
  const heading = build ?? summary;
  const listed = builds?.find((b) => b.id === buildId && b.source === "public");
  /** The build as anyone opens it: a showcase, or in the public library. */
  const shared: BuildRef | null =
    ref?.source === "session" || ref?.source === "fork"
      ? listed
        ? { id: ref.id, source: "public" }
        : null
      : summary?.private
        ? null
        : ref;

  useEffect(() => {
    if (live && builds && summary?.status !== live.status) refreshBuilds();
  }, [live?.id, live?.status, summary?.status]);

  useEffect(() => {
    document.title = heading ? `${heading.name} · ${TITLE}` : TITLE;
  }, [heading?.name]);

  const show = useCallback((next: BuildRef | null, version: number | null = null) => {
    setRef(next);
    setDraft(null);
    setCenter("model");
    setMode("view");
    setStep(Infinity);
    setFollowing(true);
    setPlaying(false);
    setHistoryOpen(version !== null);
    setWantedVersion(version);
    setSelected(null);
    setForkError("");
    copyAttempt.current = null;
  }, []);

  /** Open a build at Latest, or return home, and put it in the URL. */
  const open = (next: BuildRef | null) => {
    show(next);
    const url = new URL(window.location.href);
    for (const param of [...Object.values(PARAMS), "version", "library"]) url.searchParams.delete(param);
    if (next) url.searchParams.set(PARAMS[next.source], next.id);
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
  };

  useEffect(() => {
    const sync = () => {
      const next = urlBuild();
      show(next, urlVersion());
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
    const session =
      b.source === "public" && builds?.find((s) => (s.source === "session" || s.source === "fork") && s.id === b.id);
    open({ id: b.id, source: session ? session.source : b.source });
  };

  const saveThumbnail = async (png: Blob, revision: string) => {
    if (!readOnly && ref && (ref.source === "session" || ref.source === "fork"))
      remember(ref.id, { thumbnail: await thumbnail(png), revision });
  };

  useEffect(
    () =>
      onRemember((id) => {
        const shown = card(id)?.thumbnail;
        if (!shown) return;
        setBuilds((previous) =>
          previous?.some((b) => b.id === id && (b.source === "session" || b.source === "fork") && b.thumbnail !== shown)
            ? previous.map((b) =>
                b.id === id && (b.source === "session" || b.source === "fork") ? { ...b, thumbnail: shown } : b,
              )
            : previous,
        );
      }),
    [],
  );

  const publishBuild = async () => {
    if (!live || readOnly) return;
    const png = await viewer.current?.thumbnail();
    const hand = edits.edits.length ? { revision: live.revision, edits: edits.edits } : null;
    await publish(live.id, png ? await thumbnail(png) : null, hand);
    await refreshBuilds();
  };

  /** The signed-in user's build, from their session or as they published it. */
  const owned =
    ref?.source === "fork"
      ? !!read.build
      : ref?.source === "session"
        ? mine(ref.id)
        : ref?.source === "public" && summary?.owner === account.user.id;
  /** An imported build of theirs: it lives only in the library, with no session to fall back to. */
  const imported = owned && ref?.source === "public" && ref.id.startsWith("import-");
  const renameTitle = ref && owned && !previewing ? (name: string) => rename(ref, name) : undefined;

  const unpublishBuild = async () => {
    if (!live) return;
    // Unpublishing would delete an imported build; making it private keeps it under the user's builds.
    if (imported) await setPrivate(live.id, true);
    else {
      await unpublish(live.id);
      if (ref?.source === "public") open({ id: live.id, source: live.id.startsWith("fork-") ? "fork" : "session" });
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
    open(null);
    await refreshBuilds();
  };

  const closed =
    ref?.source === "showcase" ? (
      "Showcase · Fork to edit"
    ) : ref?.source === "public" ? (
      `By ${summary?.author ?? "an H builder"} · Fork to edit`
    ) : ref?.source === "session" && builds && !buildsFailed.includes("mine") && !owned ? (
      "Teammate’s build · Fork to edit"
    ) : build?.status === "error" ? (
      <RecoveryPanel
        key={build.id}
        build={runId && live ? { ...live, id: runId } : live!}
        edited={edited}
        onOpen={(id) => {
          started.current.add(id);
          if (same(ref, opened.current)) open({ id, source: "session" });
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
  const beginFork = async () => {
    if (!build?.pieces.length || !ref || wantedVersion !== null || forking) return;
    const key = `${ref.source}:${ref.id}:${design(build)}`;
    if (copyAttempt.current?.key !== key) {
      const saved = !edited && [...history.versions].reverse().find((v) => design(v.model) === design(build));
      copyAttempt.current = {
        key,
        id: `fork-${crypto.randomUUID()}`,
        seed: forkSeed(
          build,
          {
            ...ref,
            name: build.name,
            version: selected?.number ?? (saved ? saved.number : null),
            revision: build.revision,
          },
          `${build.name.slice(0, 70)} · Fork`,
        ),
      };
    }
    setForking(true);
    setForkError("");
    const attempt = copyAttempt.current;
    try {
      const id = await copyModel(attempt.id, attempt.seed);
      if (same(ref, opened.current)) open({ id, source: "fork" });
      refreshBuilds();
    } catch (e) {
      setForkError(e instanceof LibraryError ? e.message : "Couldn't copy. Try Fork again.");
    } finally {
      setForking(false);
    }
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
        <button disabled={!selected || forking} onClick={beginFork}>
          Fork
        </button>
      </div>
    </>
  );
  /** The open build, once it is more than a request on its way. */
  const actionable = drafted ? null : build;

  const actions = actionable && (
    <>
      <ShareMenu
        build={actionable}
        link={!readOnly && shared ? linkTo(shared) : null}
        loading={loading}
        publishing={
          owned && !readOnly
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
        onDelete={imported && !readOnly ? deleteBuild : null}
        image={() => viewer.current?.image() ?? Promise.resolve(null)}
        onGif={exportReplay}
        onInstructions={exportInstructions}
      />
      {actionable.pieces.length > 0 && (
        <button
          className="primary"
          onClick={shop}
          disabled={!shoppable}
          title={shoppable ? undefined : "Get the bricks once Holo finishes"}
        >
          <ShoppingBagIcon size={16} />
          <span className="button-label">Get the bricks{price && ` · ≈ ${price}`}</span>
        </button>
      )}
    </>
  );

  return (
    <div className={`app${home ? " home" : ""}${historyOpen ? " has-history" : ""}`}>
      <header>
        <button className="brand" onClick={() => open(null)}>
          <img className="brand-icon" src="/brick.png" alt="" />
          <span className="button-label">HoloBricks</span>
        </button>
        {phone && heading && (
          <ProjectTitle
            key={`${ref?.source}:${ref?.id}`}
            className="title"
            name={heading.name}
            onRename={renameTitle}
          />
        )}
        <span className="spacer" />
        {!phone && actions}
        <AccountMenu account={account} building={running.length > 0} />
      </header>
      <aside>
        <div className="aside-bar">
          <ProjectTitle
            key={`${ref?.source}:${ref?.id}:${previewing}`}
            className="aside-title"
            name={previewing ? "Latest chat" : (!phone && heading?.name) || "Chat"}
            onRename={!phone && heading ? renameTitle : undefined}
          />
          {ref && (
            <button className="quiet" onClick={() => open(null)}>
              <PlusIcon size={16} />
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
              if (!live || readOnly || (!live.open && live.status !== "building")) return;
              if (runId) await say(runId, text, images);
              else if (ref?.source === "fork" && seed) {
                const id = await startFork(ref.id, seed, text, images);
                started.current.add(id);
                attachSession(id);
                refreshBuilds();
              }
            }}
            onStop={async () => {
              if (runId && !readOnly) await stop(runId);
            }}
            onFork={beginFork}
            onRemix={async (text, images) => {
              if (build && !readOnly && owned) await start(text, images, build);
            }}
          />
          {forkError && (
            <p className="composer-error" role="alert">
              {forkError}
            </p>
          )}
          {home && (
            <HomeShelves
              builds={builds}
              failed={buildsFailed}
              me={account.user.id}
              onRetry={refreshBuilds}
              onOpen={openListed}
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
              {(ref?.source === "session" || ref?.source === "fork") && (
                <button aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)}>
                  History
                </button>
              )}
              <button disabled={forking || !build.pieces.length || wantedVersion !== null} onClick={beginFork}>
                Fork
              </button>
            </div>
          )}
          {center === "model" && !error && (
            <ViewControls
              framing={framing}
              spin={spin}
              mode={mode}
              canEdit={!readOnly && edits.editable && built}
              editHint={previewing ? "Edit Latest or Fork" : undefined}
              built={built}
              onFrame={(next) => {
                if (mode === "walk") setMode("view");
                setFraming(next);
              }}
              onSpin={setSpin}
              onMode={(mode) => {
                if (mode !== "edit" || !readOnly) setMode(mode);
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
              opening={buildId && !error ? `Opening ${heading?.name ?? "the build"}` : null}
              step={visibleStep}
              syncError={selected ? null : syncError}
              framing={framing}
              spin={spin}
              onThumbnail={!readOnly && owned ? saveThumbnail : undefined}
              thumbnailed={!readOnly && owned && ref ? card(ref.id)?.revision : undefined}
              mode={mode}
              edits={readOnly ? { ...edits, editable: false, stale: 0, hidden: 0 } : edits}
              describe={describer(build, palette)}
              palette={palette}
              onMode={(mode) => {
                if (mode !== "edit" || !readOnly) setMode(mode);
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
        {phone && actions && <div className="build-actions">{actions}</div>}
      </main>
      <Suspense>{exportBuild && <FilmExport build={exportBuild} onClose={() => setExportBuild(null)} />}</Suspense>
      <Suspense>
        {instructionsBuild && (
          <InstructionsExport
            build={instructionsBuild}
            describe={describer(build, palette)}
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
            describe={describer(build, palette)}
            onReset={resetForShopping}
            onClose={() => setShopping(null)}
          />
        )}
      </Suspense>
    </div>
  );
}
