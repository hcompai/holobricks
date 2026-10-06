import { Thinking } from "./Thinking";
import type { Activity } from "./session";
import { PlacementSoundToggle } from "./PlacementSound";
import { type Ref, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import {
  ArrowsClockwiseIcon,
  CrosshairSimpleIcon,
  LockSimpleIcon,
  PauseIcon,
  PencilSimpleIcon,
  PersonSimpleWalkIcon,
  PlayIcon,
  VideoCameraIcon,
} from "@phosphor-icons/react";
import * as THREE from "three";
import type { Build, Piece } from "./model";
import { BrickLoader } from "./BrickLoader";
import { buildRevision } from "./buildRevision";
import { ACTION_KEYS, type Action, EditBar, EditPanel } from "./EditPanel";
import { type Edit, type Edits, PLATE, pivot, STUD } from "./edits";
import { replacementOffset } from "./partCatalog";
import type { Color } from "./palette";
import { BrickScene, provideParts, typing, type View, type PlacementProgress } from "./scene";
import { Shortcuts } from "./Shortcuts";
import { WalkHud } from "./WalkHud";
import { useWalkFullscreen } from "./useWalkFullscreen";

/** Hand edits come in bursts; the library tile waits for a pause. */
const THUMBNAIL_IDLE_MS = 1500;

const VIEWS: { id: View; label: string }[] = [
  { id: "iso", label: "3/4" },
  { id: "front", label: "Front" },
  { id: "top", label: "Top" },
];

/** A camera choice; a fresh object reframes even when the view is unchanged. */
export interface Framing {
  view: View;
}

/** Orbit and look, select and change pieces, or walk through the model. */
export type Mode = "view" | "edit" | "walk";

export function ViewControls({
  framing,
  spin,
  followCamera = false,
  onFollowCamera,
  mode,
  canEdit,
  editHint,
  built,
  onFrame,
  onSpin,
  onMode,
}: {
  framing: Framing;
  spin: boolean;
  followCamera?: boolean;
  onFollowCamera?: (follow: boolean) => void;
  mode: Mode;
  canEdit: boolean;
  editHint?: string;
  /** The model has pieces, so it can be edited or walked through. */
  built: boolean;
  onFrame: (framing: Framing) => void;
  onSpin: (spin: boolean) => void;
  onMode: (mode: Mode) => void;
}) {
  const hintId = useId();
  const blocked = built && !canEdit && mode !== "edit";
  const toggle = (next: Mode) => onMode(mode === next ? "view" : next);
  return (
    <div className="view-controls">
      <div className="tabs">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={!followCamera && framing.view === v.id ? "active" : ""}
            aria-pressed={!followCamera && framing.view === v.id}
            onClick={() => onFrame({ view: v.id })}
          >
            {v.label}
          </button>
        ))}
        <button aria-label="Reset view" title="Reset view" onClick={() => onFrame({ view: "iso" })}>
          <CrosshairSimpleIcon size={14} weight="bold" />
        </button>
        <span className="tabs-sep" />
        {onFollowCamera && (
          <button
            className={followCamera ? "active" : ""}
            aria-pressed={followCamera}
            disabled={mode !== "view"}
            title="Frame each step during builds and replay. Drag or zoom to take control."
            onClick={() => onFollowCamera(!followCamera)}
          >
            <VideoCameraIcon size={14} weight="bold" />
            <span className="button-label">Follow build</span>
          </button>
        )}
        <button className={spin ? "active" : ""} aria-pressed={spin} onClick={() => onSpin(!spin)}>
          <ArrowsClockwiseIcon size={14} weight="bold" />
          <span className="button-label">Spin</span>
        </button>
        {built && (
          <>
            <span className="tabs-sep" />
            <button
              className={mode === "edit" ? "active" : ""}
              aria-pressed={mode === "edit"}
              disabled={blocked}
              aria-describedby={blocked && editHint ? hintId : undefined}
              title={
                canEdit
                  ? "Select pieces to move, turn or delete them"
                  : (editHint ?? "Pieces can be edited once Holo is done")
              }
              onClick={() => toggle("edit")}
            >
              {blocked ? <LockSimpleIcon size={14} weight="bold" /> : <PencilSimpleIcon size={14} weight="bold" />}
              <span className="button-label">Edit</span>
            </button>
            <button
              className={mode === "walk" ? "needs-mouse active" : "needs-mouse"}
              aria-pressed={mode === "walk"}
              title="Walk through the model: WASD and the mouse"
              onClick={() => toggle("walk")}
            >
              <PersonSimpleWalkIcon size={14} weight="bold" />
              <span className="button-label">Walk</span>
            </button>
          </>
        )}
        <Shortcuts />
      </div>
      {blocked && editHint && (
        <p id={hintId} className="edit-availability" role="status">
          {editHint}
        </p>
      )}
    </div>
  );
}

export interface ViewerHandle {
  /** The current view as a PNG. */
  image: () => Promise<Blob | null>;
  /** The model as a library tile: a square 3/4 view on a transparent background. */
  thumbnail: () => Promise<Blob | null>;
}

interface Props {
  thinking?: Activity | null;
  placementSpeed?: number;
  onPlacing?: (placing: boolean) => void;
  ref?: Ref<ViewerHandle>;
  build: Build | null;
  /** What is opening, shown until its pieces are drawn; null when no build is open. */
  opening: string | null;
  step: number;
  syncError?: string | null;
  framing: Framing;
  spin: boolean;
  followCamera?: boolean;
  onFollowCamera?: (follow: boolean) => void;
  /** Called with a thumbnail once a finished revision is drawn; without it, the build keeps no thumbnail. */
  onThumbnail?: (png: Blob, revision: string) => void;
  /** The revision the build's saved thumbnail shows, which needs no new one. */
  thumbnailed?: string;
  mode: Mode;
  /** The open build's hand edits; `build` already shows them. */
  edits: Edits;
  /** A piece's name, such as "Brick 2 x 4 · Red". */
  describe: (piece: Piece) => string;
  /** Every color a piece can take. */
  palette: Color[];
  onAsk?: (text: string, model: Build, ids: number[]) => Promise<boolean>;
  onMode: (mode: Mode) => void;
}

export function Viewer(props: Props) {
  const { ref, build, opening, step, framing, spin, onThumbnail, thumbnailed, syncError } = props;
  const { mode, edits, describe, palette, onMode } = props;
  const walkScreen = useWalkFullscreen(mode === "walk");
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<BrickScene | null>(null);
  const framedBuild = useRef<string | null>(null);
  const [placement, setPlacement] = useState<PlacementProgress | null>(null);
  const followListener = useRef(props.onFollowCamera);
  followListener.current = props.onFollowCamera;
  const placingListener = useRef(props.onPlacing);
  placingListener.current = props.onPlacing;
  const previousBuild = useRef<string | null>(null);
  const [drawn, setDrawn] = useState<{
    id: string;
    key: string;
    pieces: Build["pieces"];
    size: THREE.Vector3;
  } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [locked, setLocked] = useState(false);
  const [flying, setFlying] = useState(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const hoverFrame = useRef(0);
  const editing = mode === "edit";
  const selectedPieces = build?.pieces.filter((p) => selected.includes(p.id)) ?? [];
  const selectedColors = [...new Set(selectedPieces.map((p) => p.color))];
  const version = build ? `${build.id}:${build.revision}` : null;
  /** This exact revision is drawn. */
  const ready = !!build && drawn?.key === version && drawn.pieces === build.pieces && !renderError;
  /** Some revision of this build is drawn; the scene keeps it up until the next one is ready. */
  const shown = !!build?.pieces.length && drawn?.id === build.id && !renderError;
  const empty = !!build && !build.pieces.length;
  const failed = (error: unknown) => {
    scene.current?.finishPlacement();
    setDrawn(null);
    setRenderError(error instanceof Error ? error.message : "Could not draw the latest model");
  };
  const width = build?.width || 32;
  const depth = build?.depth || 32;

  useEffect(() => {
    setDrawn(null);
    setRenderError(null);
    try {
      const s = new BrickScene(container.current!, {
        onError: failed,
        onWalkLock: setLocked,
        onFly: setFlying,
        onFollowBuild: (follow) => followListener.current?.(follow),
        onPlacement: (next) => {
          setPlacement(next);
          placingListener.current?.(next.active);
        },
      });
      scene.current = s;
      return () => {
        scene.current = null;
        placingListener.current?.(false);
        s.dispose();
      };
    } catch (error) {
      failed(error);
    }
  }, [retry]);

  useImperativeHandle(
    ref,
    () => ({
      image: () => (ready && !syncError ? (scene.current?.image() ?? Promise.resolve(null)) : Promise.resolve(null)),
      thumbnail: () =>
        ready && !syncError && build
          ? (scene.current?.renderThumbnail(build.pieces) ?? Promise.resolve(null))
          : Promise.resolve(null),
    }),
    [ready, syncError, build?.pieces],
  );

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    let current = true;
    setRenderError(null);
    if (!build) setDrawn(null);
    s.setBuildComplete(build?.status === "done" && step >= (build?.steps.length ?? 0) - 1);
    s.setVisibleStep(step);
    const fresh = previousBuild.current !== (build?.id ?? null);
    previousBuild.current = build?.id ?? null;
    // Edited builds can use parts their revision did not, put in by Replace.
    if (build) provideParts(build.parts);
    s.setPieces(build?.pieces ?? [], { fresh, animate: mode === "view" && build?.status === "building" })
      .then(async (applied) => {
        if (!current || !build || !applied) return;
        if ((await buildRevision(build.pieces)) !== build.revision) {
          throw new Error("Model revision mismatch. Reload the model to recover.");
        }
        if (!current) return;
        if (build.pieces.length && (framedBuild.current !== build.id || !s.userMoved)) {
          const same = framedBuild.current === build.id;
          if (!same) s.userMoved = false;
          framedBuild.current = build.id;
          if (!(build.status === "building" && s.followingBuild)) s.frameView(framing.view, width, depth, same);
        }
        s.drawCurrent();
        // Measure the full model in its own axes, independent of camera, replay and placement animation.
        // LDraw: 1 unit ≈ 0.4 mm (https://www.ldraw.org/article/218.html).
        const size = s
          .piecesBox(build.pieces.map((p) => p.id))
          .getSize(new THREE.Vector3())
          .multiplyScalar(0.04);
        setDrawn({ id: build.id, key: version!, pieces: build.pieces, size });
      })
      .catch((error) => {
        if (current) failed(error);
      });
    return () => {
      current = false;
    };
  }, [build?.id, build?.pieces, version, retry]);

  useEffect(() => {
    const s = scene.current;
    if (!s || !ready || !onThumbnail || !build?.pieces.length || build.status !== "done") return;
    if (build.revision === thumbnailed) return;
    let current = true;
    const { pieces, revision } = build;
    const timer = setTimeout(
      () =>
        s
          .renderThumbnail(pieces)
          .then((png) => current && png && onThumbnail(png, revision))
          .catch((error) => console.error("Could not make the thumbnail", error)),
      THUMBNAIL_IDLE_MS,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [ready, build?.status, version, thumbnailed, !onThumbnail]);

  useEffect(() => {
    scene.current?.setBuildComplete(build?.status === "done" && step >= (build?.steps.length ?? 0) - 1);
    scene.current?.setVisibleStep(step, mode === "view");
  }, [step, build?.status, retry]);
  useEffect(
    () => scene.current?.setFollowBuild((props.followCamera ?? true) && mode === "view" && !spin),
    [props.followCamera, mode, spin, retry],
  );
  useEffect(() => scene.current?.setPlacementSpeed(props.placementSpeed ?? 1), [props.placementSpeed, retry]);

  useEffect(() => {
    scene.current?.setPlacementEnabled(mode === "view");
    scene.current?.setWalk(mode === "walk");
    if (mode !== "walk") {
      setLocked(false);
      setFlying(false);
    }
    if (!editing) {
      setHover(null);
      setSelected([]);
    }
  }, [mode, retry]);

  useEffect(() => setSelected([]), [build?.id]);

  // Undoing or resetting can remove selected pieces; keep only those still in the model.
  useEffect(() => {
    if (selectedPieces.length !== selected.length) setSelected(selectedPieces.map((p) => p.id));
  }, [build?.pieces]);

  useEffect(
    () => scene.current?.setHighlight(editing ? hover : null, editing ? selected : []),
    [editing, hover, selected, drawn, retry],
  );

  useEffect(() => {
    if (mode !== "walk" || locked) return;
    const leave = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !typing(event)) onMode("view");
    };
    window.addEventListener("keydown", leave);
    return () => window.removeEventListener("keydown", leave);
  }, [mode, locked]);

  /** Apply `action` to the selected pieces as one edit; moves follow the view, snapped to the model's axes. */
  const act = (action: Action) => {
    const s = scene.current;
    const ids = selectedPieces.map((p) => p.id);
    if (!s || !ids.length || !edits.editable) return;
    const push = (edit: Edit) => edits.push(edit);
    if (action === "delete") {
      push({ kind: "delete", ids });
      setSelected([]);
      return;
    }
    if (action === "turnLeft" || action === "turnRight") {
      push({ kind: "rotate", ids, turns: action === "turnRight" ? 1 : -1, about: pivot(selectedPieces) });
      return;
    }
    const { right, forward } = s.screenAxes();
    const scale = (v: number[], by: number) => v.map((x) => x * by) as [number, number, number];
    if (action === "duplicate") {
      // Beside the selection, on the screen's right: as many studs as it is wide along that axis.
      const size = s.piecesBox(ids).getSize(new THREE.Vector3());
      const wide = Math.abs(right[0]) ? size.x : size.z;
      const first = Math.max(...build!.pieces.map((p) => p.id)) + 1;
      push({ kind: "duplicate", ids, by: scale(right, STUD * Math.max(1, Math.round(wide / STUD))), first });
      setSelected(ids.map((_, i) => first + i));
      return;
    }
    const by = {
      left: scale(right, -STUD),
      right: scale(right, STUD),
      forward: scale(forward, STUD),
      back: scale(forward, -STUD),
      up: [0, -PLATE, 0] as [number, number, number],
      down: [0, PLATE, 0] as [number, number, number],
    }[action];
    push({ kind: "move", ids, by });
  };

  /** Put `part` in each selected piece's place, keeping the piece's bottom and first stud. */
  const replace = (part: string, pack: string) => {
    const targets = selectedPieces.filter((p) => p.part !== part);
    if (!build || !targets.length || !edits.editable) return;
    edits.push({
      kind: "replace",
      ids: targets.map((p) => p.id),
      part,
      by: targets.map((p) => replacementOffset(p, build.parts[p.part] ?? "", pack)),
    });
  };

  useEffect(() => {
    if (!editing) return;
    const key = (event: KeyboardEvent) => {
      if (typing(event)) return;
      if ((event.metaKey || event.ctrlKey) && (event.code === "KeyZ" || event.code === "KeyY")) {
        event.preventDefault();
        if (event.code === "KeyY" || event.shiftKey) edits.redo();
        else edits.undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.code === "KeyD" && selected.length) {
        event.preventDefault();
        act("duplicate");
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || !selected.length) return;
      if (event.key === "Escape") return setSelected([]);
      const action = ACTION_KEYS[event.key];
      if (!action) return;
      event.preventDefault();
      act(action);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const pointed = (event: React.PointerEvent) => {
    pointer.current = { x: event.clientX, y: event.clientY };
  };

  /** Shift-drag in edit mode draws a selection box instead of orbiting; runs before the camera sees the press. */
  const boxStart = (event: React.PointerEvent) => {
    if (!editing || !event.shiftKey || event.button !== 0) return;
    scene.current?.setOrbit(false);
    (event.target as Element).setPointerCapture(event.pointerId);
    setBox({ x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY });
  };

  const boxEnd = (event: React.PointerEvent) => {
    if (!box) return;
    scene.current?.setOrbit(true);
    setBox(null);
    if (Math.hypot(event.clientX - box.x0, event.clientY - box.y0) <= 5) return;
    // Option (Alt) also takes the pieces hidden behind others.
    const within = event.altKey ? scene.current?.piecesIn : scene.current?.piecesSeenIn;
    const inside = within?.call(scene.current, box.x0, box.y0, event.clientX, event.clientY) ?? [];
    setSelected([...new Set([...selected, ...inside])]);
  };

  const hovered = (event: React.PointerEvent) => {
    if (box) return setBox({ ...box, x1: event.clientX, y1: event.clientY });
    if (!editing || event.buttons) return;
    const { clientX, clientY } = event;
    cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = requestAnimationFrame(() => setHover(scene.current?.pick(clientX, clientY)?.id ?? null));
  };

  const clicked = (event: React.MouseEvent) => {
    if (mode === "walk") return scene.current?.lockPointer();
    const start = pointer.current;
    pointer.current = null;
    if (!editing || !start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    const id = scene.current?.pick(event.clientX, event.clientY)?.id;
    // Shift, Cmd or Ctrl adds a piece to the selection or takes it out; a plain click selects only it.
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      if (id !== undefined) setSelected(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
    } else setSelected(id === undefined ? [] : [id]);
  };
  useEffect(() => scene.current?.setSpin(spin), [spin, retry]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.userMoved = false;
    s.frameView(framing.view, width, depth);
  }, [framing]);

  return (
    <div
      ref={walkScreen.ref}
      className={walkScreen.fullscreen ? "viewer walk-fullscreen" : "viewer"}
      data-revision={ready ? build?.revision : undefined}
      data-placing={placement?.active ? "true" : "false"}
      data-placed={placement?.placed ?? 0}
      data-placement-total={placement?.total ?? 0}
      data-render-state={ready ? "ready" : renderError ? "error" : "loading"}
    >
      <div
        className="viewer-canvas"
        ref={container}
        style={{
          visibility: shown && !syncError ? "visible" : "hidden",
          cursor: (editing && hover !== null) || (mode === "walk" && !locked) ? "pointer" : undefined,
        }}
        onPointerDownCapture={boxStart}
        onPointerDown={pointed}
        onPointerMove={hovered}
        onPointerUp={boxEnd}
        onPointerCancel={boxEnd}
        onPointerLeave={() => setHover(null)}
        onClick={clicked}
      />
      {shown && (edits.stale > 0 || edits.hidden > 0) && (
        <div className="edit-notice" role="status">
          {edits.stale > 0 ? (
            <>
              {edits.stale} edit{edits.stale === 1 ? " was" : "s were"} made on an earlier revision of this model.
              <button onClick={edits.reset}>Discard</button>
            </>
          ) : (
            `Your ${edits.hidden} edit${edits.hidden === 1 ? " is" : "s are"} hidden while Holo works.`
          )}
        </div>
      )}
      {box && <div className="select-box" style={boxStyle(box, container.current)} />}
      {editing && shown && <EditBar edits={edits} />}
      {editing && shown && selectedPieces.length > 0 && (
        <EditPanel
          label={selectedPieces.length === 1 ? describe(selectedPieces[0]) : `${selectedPieces.length} pieces`}
          onAction={act}
          onClose={() => setSelected([])}
          palette={palette}
          used={usedColors(build!.pieces)}
          current={selectedColors}
          onColor={(color) => {
            const ids = selectedPieces.filter((p) => p.color !== color).map((p) => p.id);
            if (ids.length && edits.editable) edits.push({ kind: "color", ids, color });
          }}
          usedParts={usedParts(build!.pieces)}
          packs={build!.parts}
          currentParts={[...new Set(selectedPieces.map((p) => p.part))]}
          onReplace={replace}
          onAsk={
            ready && props.onAsk
              ? (text) =>
                  props.onAsk!(
                    text,
                    build!,
                    selectedPieces.map((p) => p.id),
                  )
              : undefined
          }
          count={selectedPieces.length}
        />
      )}
      {mode === "walk" && shown && (
        <WalkHud
          locked={locked}
          flying={flying}
          fullscreen={walkScreen.fullscreen}
          onFullscreen={walkScreen.toggle}
          onLeave={() => onMode("view")}
        />
      )}
      {shown && drawn && !syncError && mode !== "walk" && (
        <div className="viewer-info">
          {mode === "view" && placement?.active && (
            <div className="placement-hud" role="status" aria-live="off">
              <span>
                Layer {placement.layer} · {placement.placed.toLocaleString()} / {placement.total.toLocaleString()}
              </span>
              <button
                onClick={() => scene.current?.pausePlacement(!placement.paused)}
                aria-label={placement.paused ? "Resume placement" : "Pause placement"}
              >
                {placement.paused ? <PlayIcon size={12} weight="fill" /> : <PauseIcon size={12} weight="fill" />}
              </button>
              <button onClick={() => scene.current?.finishPlacement()}>Skip</button>
            </div>
          )}
          <dl className="model-size" aria-label="Model size" title="Approximate size · full model">
            {[
              { label: "Height", value: drawn.size.y },
              { label: "Width", value: drawn.size.x },
              { label: "Depth", value: drawn.size.z },
            ].map(({ label, value }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value.toFixed(1)} cm</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {shown && <PlacementSoundToggle />}
      {syncError || renderError ? (
        <div className="viewer-empty" role="alert">
          <div>{syncError ?? `The latest model could not be displayed. ${renderError}`}</div>
          {!syncError && <button onClick={() => setRetry((n) => n + 1)}>Reload model</button>}
        </div>
      ) : (
        <>
          {props.thinking && !shown && (
            <Thinking
              activity={props.thinking}
              name={build?.name}
              request={build?.messages.find((m) => m.role === "user")?.text}
              photos={build?.messages.find((m) => m.role === "user")?.images}
            />
          )}
          {!props.thinking && opening && !shown && !empty && (
            <BrickLoader label={build ? "Loading the model…" : opening} />
          )}
          {empty && build.status !== "building" && (
            <BrickLoader idle label="There's nothing here yet, so ask Holo in the chat to start building." />
          )}
        </>
      )}
    </div>
  );
}

/** The model's colors, most used first. */
function usedColors(pieces: Piece[]): number[] {
  return mostUsed(pieces.map((p) => p.color));
}

function usedParts(pieces: Piece[]): string[] {
  return mostUsed(pieces.map((p) => p.part));
}

function mostUsed<T>(values: T[]): T[] {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

/** The selection box in the viewer's own coordinates. */
function boxStyle(box: { x0: number; y0: number; x1: number; y1: number }, within: HTMLElement | null) {
  const origin = within?.getBoundingClientRect() ?? { left: 0, top: 0 };
  return {
    left: Math.min(box.x0, box.x1) - origin.left,
    top: Math.min(box.y0, box.y1) - origin.top,
    width: Math.abs(box.x1 - box.x0),
    height: Math.abs(box.y1 - box.y0),
  };
}
