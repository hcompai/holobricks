import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import type { Build, RenderRequest } from "./model";
import { BrickLoader } from "./BrickLoader";
import { buildRevision } from "./buildRevision";
import { BrickScene, type View } from "./scene";

const VIEWS: { id: View; label: string }[] = [
  { id: "iso", label: "3/4" },
  { id: "front", label: "Front" },
  { id: "top", label: "Top" },
];

/** A camera choice; a fresh object reframes even when the view is unchanged. */
export interface Framing {
  view: View;
}

export function ViewControls({
  framing,
  spin,
  onFrame,
  onSpin,
}: {
  framing: Framing;
  spin: boolean;
  onFrame: (framing: Framing) => void;
  onSpin: (spin: boolean) => void;
}) {
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
}

export function Viewer(props: Props) {
  const { ref, build, opening, step, renderRequest, framing, spin, onRender, onThumbnail, syncError, empty } = props;
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<BrickScene | null>(null);
  const framedBuild = useRef<string | null>(null);
  const thumbnailed = useRef(new Set<string>());
  const answered = useRef(new Set<string>());
  const [drawn, setDrawn] = useState<{ key: string; pieces: Build["pieces"] } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
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
      const s = new BrickScene(container.current!, { onError: failed });
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
        style={{ visibility: ready && !syncError ? "visible" : "hidden" }}
      />
      {syncError || renderError ? (
        <div className="viewer-empty" role="alert">
          <div>{syncError ?? `The latest model could not be displayed. ${renderError}`}</div>
          {!syncError && <button onClick={() => setRetry((n) => n + 1)}>Reload model</button>}
        </div>
      ) : (
        opening && !ready && <BrickLoader label={build ? "Loading the latest model…" : opening} />
      )}
      {!build && !opening && <div className="viewer-empty">{empty}</div>}
    </div>
  );
}
