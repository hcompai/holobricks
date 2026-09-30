import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowsClockwiseIcon, PencilSimpleIcon, PersonSimpleWalkIcon } from "@phosphor-icons/react";
import * as THREE from "three";
import type { Build, Piece } from "./model";
import { BrickLoader } from "./BrickLoader";
import { buildRevision } from "./buildRevision";
import { ACTION_KEYS, type Action, EditBar, EditPanel } from "./EditPanel";
import { type Edit, type Edits, PLATE, pivot, STUD } from "./edits";
import type { Color } from "./palette";
import { BrickScene, typing, type View } from "./scene";
import { Shortcuts } from "./Shortcuts";
import { WalkHud } from "./WalkHud";

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
  mode,
  canEdit,
  canWalk,
  onFrame,
  onSpin,
  onMode,
}: {
  framing: Framing;
  spin: boolean;
  mode: Mode;
  canEdit: boolean;
  canWalk: boolean;
  onFrame: (framing: Framing) => void;
  onSpin: (spin: boolean) => void;
  onMode: (mode: Mode) => void;
}) {
  const toggle = (next: Mode) => onMode(mode === next ? "view" : next);
  return (
    <div className="tabs">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          className={framing.view === v.id ? "active" : ""}
          aria-pressed={framing.view === v.id}
          onClick={() => onFrame({ view: v.id })}
        >
          {v.label}
        </button>
      ))}
      <span className="tabs-sep" />
      <button className={spin ? "active" : ""} aria-pressed={spin} onClick={() => onSpin(!spin)}>
        <ArrowsClockwiseIcon size={14} weight="bold" />
        Spin
      </button>
      <span className="tabs-sep" />
      <button
        className={mode === "edit" ? "active" : ""}
        aria-pressed={mode === "edit"}
        disabled={!canEdit && mode !== "edit"}
        title={canEdit ? "Select pieces to move, turn or delete them" : "Pieces can be edited once Holo is done"}
        onClick={() => toggle("edit")}
      >
        <PencilSimpleIcon size={14} weight="bold" />
        Edit
      </button>
      <button
        className={mode === "walk" ? "active" : ""}
        aria-pressed={mode === "walk"}
        disabled={!canWalk && mode !== "walk"}
        title="Walk through the model: WASD and the mouse"
        onClick={() => toggle("walk")}
      >
        <PersonSimpleWalkIcon size={14} weight="bold" />
        Walk
      </button>
      <Shortcuts />
    </div>
  );
}

export interface ViewerHandle {
  /** The current view as a PNG. */
  image: () => Promise<Blob | null>;
  /** The model as a library tile: a square 3/4 view on a light background. */
  thumbnail: () => Promise<Blob | null>;
}

interface Props {
  ref?: Ref<ViewerHandle>;
  build: Build | null;
  /** What is opening, shown until its pieces are drawn; null when no build is open. */
  opening: string | null;
  step: number;
  syncError?: string | null;
  framing: Framing;
  spin: boolean;
  /** Called with a thumbnail once a finished revision is drawn. */
  onThumbnail: (png: Blob) => void;
  /** What shows before any build is open. */
  empty: string;
  mode: Mode;
  /** The open build's hand edits; `build` already shows them. */
  edits: Edits;
  /** A piece's name, such as "Brick 2 x 4 · Red". */
  describe: (piece: Piece) => string;
  /** Every color a piece can take. */
  palette: Color[];
  onMode: (mode: Mode) => void;
}

export function Viewer(props: Props) {
  const { ref, build, opening, step, framing, spin, onThumbnail, syncError, empty } = props;
  const { mode, edits, describe, palette, onMode } = props;
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<BrickScene | null>(null);
  const framedBuild = useRef<string | null>(null);
  const thumbnailed = useRef(new Set<string>());
  const [drawn, setDrawn] = useState<{ id: string; key: string; pieces: Build["pieces"] } | null>(null);
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
  const shown = !!build && drawn?.id === build.id && !renderError;
  const waiting = shown && !build.pieces.length;
  const failed = (error: unknown) => {
    setDrawn(null);
    setRenderError(error instanceof Error ? error.message : "Could not draw the latest model");
  };
  const width = build?.width || 32;
  const depth = build?.depth || 32;

  useEffect(() => {
    setDrawn(null);
    setRenderError(null);
    try {
      const s = new BrickScene(container.current!, { onError: failed, onWalkLock: setLocked, onFly: setFlying });
      scene.current = s;
      return () => {
        scene.current = null;
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
    s.setVisibleStep(step);
    s.setPieces(build?.pieces ?? [])
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
          s.frameView(framing.view, width, depth, same);
        }
        s.drawCurrent();
        setDrawn({ id: build.id, key: version!, pieces: build.pieces });
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
    if (!s || !ready || !build?.pieces.length || build.status !== "done" || thumbnailed.current.has(version!)) return;
    let current = true;
    const timer = setTimeout(
      () =>
        s
          .renderThumbnail(build.pieces)
          .then((png) => {
            if (!current || !png) return;
            thumbnailed.current.add(version!);
            onThumbnail(png);
          })
          .catch((error) => console.error("Could not make the thumbnail", error)),
      THUMBNAIL_IDLE_MS,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [ready, build?.status, version]);

  useEffect(() => scene.current?.setVisibleStep(step), [step, retry]);

  useEffect(() => {
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
      className="viewer"
      data-revision={ready ? build?.revision : undefined}
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
        />
      )}
      {mode === "walk" && shown && <WalkHud locked={locked} flying={flying} />}
      {syncError || renderError ? (
        <div className="viewer-empty" role="alert">
          <div>{syncError ?? `The latest model could not be displayed. ${renderError}`}</div>
          {!syncError && <button onClick={() => setRetry((n) => n + 1)}>Reload model</button>}
        </div>
      ) : (
        <>
          {opening && !shown && <BrickLoader label={build ? "Loading the model…" : opening} />}
          {waiting &&
            (build.status === "building" ? (
              <BrickLoader label="Holo is planning the build…" />
            ) : (
              <BrickLoader idle label="Nothing built yet. Ask Holo in the chat." />
            ))}
        </>
      )}
      {!build && !opening && <BrickLoader idle label={empty} />}
    </div>
  );
}

/** The model's colors, most used first. */
function usedColors(pieces: Piece[]): number[] {
  const counts = new Map<number, number>();
  for (const p of pieces) counts.set(p.color, (counts.get(p.color) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([code]) => code);
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
