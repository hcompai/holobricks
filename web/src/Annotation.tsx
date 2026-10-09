import {
  ArrowCounterClockwiseIcon,
  ArrowsInIcon,
  EraserIcon,
  MinusIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type PointerEvent } from "react";

export interface AnnotationContext {
  build: string;
  revision: string;
  step: number;
}
export interface VisualInstruction {
  image: string;
  context: AnnotationContext;
  marks: Stroke[];
  size: [number, number];
}
type Point = [number, number];
type Stroke = { tool: "draw" | "erase"; points: Point[] };
type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };
const BLUE = "#168bff";
const RED = "#f04452";
const weight = (tool: Stroke["tool"], width: number) => width * (tool === "erase" ? 0.035 : 0.006);
const path = (points: Point[]) => points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");

/** Mark a frozen view; Erase is a removal instruction, never a local model edit. */
export function Annotation({
  image,
  context,
  onDone,
  onClose,
}: {
  image: Blob;
  context: AnnotationContext;
  onDone: (instruction: VisualInstruction) => Promise<void>;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(FIT);
  const viewRef = useRef(FIT);
  const move = (next: View) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box) return;
    const maxX = (box.width * (next.scale - 1)) / 2;
    const maxY = (box.height * (next.scale - 1)) / 2;
    const bounded = {
      ...next,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
    viewRef.current = bounded;
    setView(bounded);
  };
  const zoom = (factor: number, x = 0, y = 0) => {
    const previous = viewRef.current;
    const scale = Math.max(1, Math.min(6, previous.scale * factor));
    const ratio = scale / previous.scale;
    move({ scale, x: x - (x - previous.x) * ratio, y: y - (y - previous.y) * ratio });
  };
  const [source, setSource] = useState("");
  const [size, setSize] = useState<[number, number]>([1, 1]);
  const [tool, setTool] = useState<Stroke["tool"]>("draw");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<Stroke | null>(null);
  const active = useRef<{ id: number; stroke: Stroke } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  busy.current = saving;
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const url = URL.createObjectURL(image);
    setSource(url);
    move(FIT);
    root.current?.focus({ preventScroll: true });
    // Native, non-passive handling keeps trackpad pinch inside the frozen image.
    const element = root.current!;
    const wheel = (event: WheelEvent) => {
      const box = frame.current?.getBoundingClientRect();
      const pinch = event.ctrlKey || event.metaKey;
      if (!box || (!pinch && !frame.current?.contains(event.target as Node))) return;
      event.preventDefault();
      event.stopPropagation();
      if (busy.current || active.current) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.height : 1;
      if (pinch) {
        zoom(
          Math.exp(-event.deltaY * unit * 0.01),
          event.clientX - box.left - box.width / 2,
          event.clientY - box.top - box.height / 2,
        );
      } else {
        const previous = viewRef.current;
        move({ ...previous, x: previous.x - event.deltaX * unit, y: previous.y - event.deltaY * unit });
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        element.contains(document.activeElement) &&
        ["+", "=", "-", "0"].includes(event.key)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (busy.current || active.current) return;
        if (event.key === "0") move(FIT);
        else zoom(event.key === "-" ? 1 / 1.25 : 1.25);
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", escape, true);
    return () => {
      URL.revokeObjectURL(url);
      element.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", escape, true);
    };
  }, [image]);
  const point = (event: PointerEvent<SVGSVGElement>): Point => {
    const svg = event.currentTarget;
    const matrix = svg.getScreenCTM();
    if (!matrix) return [0, 0];
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [Math.max(0, Math.min(size[0], local.x)), Math.max(0, Math.min(size[1], local.y))];
  };
  const done = async () => {
    if (!source || !strokes.length || saving) return;
    setSaving(true);
    setError("");
    try {
      const bitmap = await createImageBitmap(image);
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1500 / bitmap.width, 1400 / bitmap.height);
      const width = (canvas.width = Math.round(bitmap.width * scale));
      const height = Math.round(bitmap.height * scale);
      const legend = 44;
      canvas.height = height + legend;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      for (const stroke of strokes) {
        ctx.strokeStyle = stroke.tool === "erase" ? RED : BLUE;
        ctx.globalAlpha = stroke.tool === "erase" ? 0.4 : 1;
        ctx.lineWidth = weight(stroke.tool, width);
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.beginPath();
        stroke.points.forEach(([x, y], i) => {
          const px = (x * width) / size[0],
            py = (y * height) / size[1];
          if (i) ctx.lineTo(px, py);
          else {
            ctx.moveTo(px, py);
            ctx.lineTo(px + 0.01, py);
          }
        });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#101010";
      ctx.fillRect(0, height, width, legend);
      ctx.font = "600 14px system-ui";
      ctx.fillStyle = BLUE;
      ctx.fillText("Draw: change / add", 12, height + 27);
      ctx.fillStyle = RED;
      ctx.fillText("Erase: remove", Math.max(170, width / 2), height + 27);
      await onDone({ image: canvas.toDataURL("image/png"), context, marks: strokes, size });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not attach the annotation. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div ref={root} className="annotation" role="dialog" aria-label="Annotate model" aria-modal="false" tabIndex={-1}>
      <div className="annotation-tools" role="toolbar" aria-label="Annotation tools">
        <button
          className={tool === "draw" ? "active" : ""}
          aria-pressed={tool === "draw"}
          onClick={() => setTool("draw")}
          disabled={saving}
        >
          <PencilSimpleIcon size={16} /> Draw
        </button>
        <button
          className={tool === "erase" ? "active" : ""}
          aria-pressed={tool === "erase"}
          onClick={() => setTool("erase")}
          disabled={saving}
        >
          <EraserIcon size={16} /> Erase
        </button>
        <button
          title="Undo mark"
          aria-label="Undo mark"
          disabled={!strokes.length || saving}
          onClick={() => setStrokes((list) => list.slice(0, -1))}
        >
          <ArrowCounterClockwiseIcon size={16} />
        </button>
        <button
          title="Clear marks"
          aria-label="Clear marks"
          disabled={!strokes.length || saving}
          onClick={() => setStrokes([])}
        >
          <TrashIcon size={16} />
        </button>
        <span className="spacer" />
        <button className="primary" onClick={done} disabled={!strokes.length || !!current || saving}>
          {saving ? "Attaching…" : "Done"}
        </button>
        <button title="Cancel annotation" aria-label="Cancel annotation" onClick={onClose} disabled={saving}>
          <XIcon size={16} />
        </button>
      </div>
      <p className="annotation-hint">{tool === "draw" ? "Sketch a change" : "Mark what to remove"}</p>
      <div ref={frame} className="annotation-frame">
        <div
          className="annotation-content"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          <img
            src={source}
            alt="Frozen model view"
            draggable={false}
            onLoad={(e) => setSize([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])}
          />
          <svg
            viewBox={`0 0 ${size[0]} ${size[1]}`}
            aria-label="Draw directions on the model"
            style={{ touchAction: "none" }}
            onPointerDown={(e) => {
              if (saving || e.button !== 0 || active.current || size[0] === 1) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              const stroke = { tool, points: [point(e)] };
              active.current = { id: e.pointerId, stroke };
              setCurrent(stroke);
            }}
            onPointerMove={(e) => {
              if (active.current?.id !== e.pointerId) return;
              const stroke = { ...active.current.stroke, points: [...active.current.stroke.points, point(e)] };
              active.current.stroke = stroke;
              setCurrent(stroke);
            }}
            onPointerUp={(e) => {
              if (active.current?.id !== e.pointerId) return;
              const stroke = active.current.stroke;
              setStrokes((list) => [...list, stroke]);
              active.current = null;
              setCurrent(null);
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              active.current = null;
              setCurrent(null);
            }}
          >
            {[...strokes, ...(current ? [current] : [])].map((s, i) => (
              <path
                key={i}
                d={`${path(s.points)}${s.points.length === 1 ? "l0.01,0" : ""}`}
                fill="none"
                stroke={s.tool === "erase" ? RED : BLUE}
                strokeOpacity={s.tool === "erase" ? 0.4 : 1}
                strokeWidth={weight(s.tool, size[0])}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>
        </div>
        <div className="annotation-zoom" role="group" aria-label="Annotation zoom">
          <button
            title="Zoom out"
            aria-label="Zoom out"
            disabled={view.scale === 1 || saving || !!current}
            onClick={() => zoom(1 / 1.25)}
          >
            <MinusIcon size={16} />
          </button>
          <button
            title="Zoom in"
            aria-label="Zoom in"
            disabled={view.scale === 6 || saving || !!current}
            onClick={() => zoom(1.25)}
          >
            <PlusIcon size={16} />
          </button>
          <button
            title="Fit annotation"
            aria-label="Fit annotation"
            disabled={view.scale === 1 || saving || !!current}
            onClick={() => move(FIT)}
          >
            <ArrowsInIcon size={16} />
          </button>
        </div>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Sidecar travels with the image, including the revision even if Holo has advanced since it was captured. */
export function annotationFile(instruction: VisualInstruction): Record<string, Blob> {
  return {
    [`annotation-${crypto.randomUUID()}.json`]: new Blob(
      [
        JSON.stringify({
          ...instruction.context,
          instructions:
            "User visual directions on a frozen view. Blue Draw marks request additions or changes. Red Erase marks request removal of the visible area, not hidden objects behind it. Marks are instructions, not model edits. Respect the accompanying user comment. Compare this revision/step with the current model before acting; if the region cannot be mapped confidently, ask for clarification. Preserve unmarked areas.",
          coordinateSize: instruction.size,
          tools: [...new Set(instruction.marks.map((mark) => mark.tool))],
        }),
      ],
      { type: "application/json" },
    ),
  };
}
