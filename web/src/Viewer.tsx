import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowsClockwiseIcon, PencilSimpleIcon, PersonSimpleWalkIcon } from "@phosphor-icons/react";
import type { Build, Piece, RenderRequest } from "./model";
import { BrickLoader } from "./BrickLoader";
import { buildRevision } from "./buildRevision";
import { ACTION_KEYS, type Action, EditBar, EditPanel } from "./EditPanel";
import { type Edit, type Edits, PLATE, pivot, STUD } from "./edits";
import type { Color } from "./palette";
import { BrickScene, typing, type View } from "./scene";

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
        title={canEdit ? "Select pieces to move, turn or delete them" : "Pieces can be edited once the builder is done"}
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
    </div>
  );
}

export interface ViewerHandle {
  /** The current view as a PNG. */
  image: () => Promise<Blob | null>;
}

interface Props {
  ref?: Ref<ViewerHandle>;
  build: Build | null;
  /** What is opening, shown until its pieces are drawn; null when no build is open. */
  opening: string | null;
  step: number;
  renderRequest: RenderRequest | null;
  syncError?: string | null;
  framing: Framing;
  spin: boolean;
  /** Hand the builder a render it asked for; true once it has it. */
  onRender: (request: RenderRequest, png: Blob) => Promise<boolean>;
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
  const { ref, build, opening, step, renderRequest, framing, spin, onRender, onThumbnail, syncError, empty } = props;
  const { mode, edits, describe, palette, onMode } = props;
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<BrickScene | null>(null);
  const framedBuild = useRef<string | null>(null);
  const thumbnailed = useRef(new Set<string>());
  const answered = useRef(new Set<string>());
  const [drawn, setDrawn] = useState<{ key: string; pieces: Build["pieces"] } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [locked, setLocked] = useState(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const hoverFrame = useRef(0);
  const editing = mode === "edit";
  const selectedPieces = build?.pieces.filter((p) => selected.includes(p.id)) ?? [];
  const selectedColors = [...new Set(selectedPieces.map((p) => p.color))];
  const version = build ? `${build.id}:${build.revision}` : null;
  const ready = !!build && drawn?.key === version && drawn.pieces === build.pieces && !renderError;
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
      const s = new BrickScene(container.current!, { onError: failed, onWalkLock: setLocked });
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
    }),
    [ready, syncError],
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
          framedBuild.current = build.id;
          s.frameView(framing.view, width, depth);
        }
        s.drawCurrent();
        setDrawn({ key: version!, pieces: build.pieces });
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
    s.renderThumbnail(build.pieces)
      .then((png) => {
        if (!current || !png) return;
        thumbnailed.current.add(version!);
        onThumbnail(png);
      })
      .catch((error) => console.error("Could not make the thumbnail", error));
    return () => {
      current = false;
    };
  }, [ready, build?.status, version]);

  useEffect(() => {
    const s = scene.current;
    if (!s || !ready || syncError || !build || !renderRequest || answered.current.has(renderRequest.request)) return;
    const { request, camera, box, revision } = renderRequest;
    if (build.revision !== revision) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const answer = async () => {
      try {
        const png = await s.renderBuild(build.pieces, revision, camera, box);
        if (!active || !png || answered.current.has(request)) return;
        if (await onRender(renderRequest, png)) answered.current.add(request);
        else if (active) timer = setTimeout(answer, 2000);
      } catch (error) {
        console.error("Could not answer a render request", error);
        if (active) timer = setTimeout(answer, 2000);
      }
    };
    void answer();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [renderRequest, build?.id, build?.pieces, ready, syncError]);

  useEffect(() => scene.current?.setVisibleStep(step), [step, retry]);

  useEffect(() => {
    scene.current?.setWalk(mode === "walk");
    if (mode !== "walk") setLocked(false);
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

  const hovered = (event: React.PointerEvent) => {
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
          visibility: ready && !syncError ? "visible" : "hidden",
          cursor: (editing && hover !== null) || (mode === "walk" && !locked) ? "pointer" : undefined,
        }}
        onPointerDown={pointed}
        onPointerMove={hovered}
        onPointerLeave={() => setHover(null)}
        onClick={clicked}
      />
      {ready && (edits.stale > 0 || edits.hidden > 0) && (
        <div className="edit-notice" role="status">
          {edits.stale > 0 ? (
            <>
              {edits.stale} edit{edits.stale === 1 ? " was" : "s were"} made on an earlier revision of this model.
              <button onClick={edits.reset}>Discard</button>
            </>
          ) : (
            `Your ${edits.hidden} edit${edits.hidden === 1 ? " is" : "s are"} hidden while the builder works.`
          )}
        </div>
      )}
      {editing && ready && <EditBar edits={edits} />}
      {editing && ready && selectedPieces.length > 0 && (
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
      {mode === "walk" && ready && !locked && (
        <div className="walk-hint">
          <b>Click to walk</b>
          <span>WASD or arrows to move · mouse to look · Space/E up · C/Q down · Shift to run</span>
          <span>Esc releases the mouse; Esc again leaves walk mode</span>
        </div>
      )}
      {syncError || renderError ? (
        <div className="viewer-empty" role="alert">
          <div>{syncError ?? `The latest model could not be displayed. ${renderError}`}</div>
          {!syncError && <button onClick={() => setRetry((n) => n + 1)}>Reload model</button>}
        </div>
      ) : (
        opening && !ready && <BrickLoader label={build ? "Loading the latest model…" : opening} />
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
