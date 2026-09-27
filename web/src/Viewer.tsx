import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { api, GALLERY, type Build, type RenderRequest } from "./api";
import { BrickLoader } from "./BrickLoader";
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
  framing: Framing;
  spin: boolean;
  /** Whether the library's thumbnail shows the current pieces; undefined until the library loads. */
  thumbnailFresh: boolean | undefined;
  onThumbnail: () => void;
}

export function Viewer(props: Props) {
  const { ref, build, opening, step, renderRequest, framing, spin, thumbnailFresh, onThumbnail } = props;
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<BrickScene | null>(null);
  const framedBuild = useRef<string | null>(null);
  const thumbnailed = useRef(new Set<string>());
  const answered = useRef(new Set<string>());
  const [drawn, setDrawn] = useState<string | null>(null);
  const width = build?.width || 32;
  const depth = build?.depth || 32;

  useEffect(() => {
    const s = new BrickScene(container.current!);
    scene.current = s;
    return () => s.dispose();
  }, []);

  useImperativeHandle(ref, () => ({ image: () => scene.current?.image() ?? Promise.resolve(null) }), []);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    let current = true;
    if (!build) setDrawn(null);
    s.setPieces(build?.pieces ?? []).then(() => {
      if (!current || !build) return;
      setDrawn(build.id);
      if (!build.pieces.length) return;
      if (framedBuild.current !== build.id || !s.userMoved) {
        framedBuild.current = build.id;
        s.frameView(framing.view, width, depth);
      }
    });
    return () => {
      current = false;
    };
  }, [build?.id, build?.pieces, build?.status]);

  useEffect(() => {
    const s = scene.current;
    if (GALLERY || !s || !build?.pieces.length || build.status !== "done" || thumbnailFresh !== false) return;
    const version = `${build.id}:${build.updated}`;
    if (thumbnailed.current.has(version)) return;
    thumbnailed.current.add(version);
    s.setPieces(build.pieces)
      .then(() => s.thumbnail())
      .then(async (png) => {
        if (png && (await api.putThumbnail(build.id, png)).ok) onThumbnail();
      })
      .catch((error) => console.error("Could not save the thumbnail", error));
  }, [build?.id, build?.status, build?.updated, thumbnailFresh]);

  useEffect(() => {
    const s = scene.current;
    if (!s || !build || !renderRequest || answered.current.has(renderRequest.request)) return;
    const { request, camera, box, pieces, revision } = renderRequest;
    if (build.pieces.length !== pieces) return;
    s.renderBuild(build.pieces, revision, camera, box)
      .then(async (png) => {
        if (!png || answered.current.has(request)) return;
        const response = await api.putRender(build.id, request, png, pieces, revision);
        if (response.ok && (await response.json()).accepted) answered.current.add(request);
      })
      .catch((error) => {
        answered.current.delete(request);
        console.error("Could not answer a render request", error);
      });
  }, [renderRequest, build?.id, build?.pieces]);

  useEffect(() => scene.current?.setVisibleStep(step), [step]);
  useEffect(() => scene.current?.setSpin(spin), [spin]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.userMoved = false;
    s.frameView(framing.view, width, depth);
  }, [framing]);

  return (
    <div className="viewer">
      <div className="viewer-canvas" ref={container} />
      {opening && drawn !== build?.id && <BrickLoader label={opening} />}
      {!build && !opening && (
        <div className="viewer-empty">
          {GALLERY ? "Pick a build from the library." : "Describe a model in the chat to start building."}
        </div>
      )}
    </div>
  );
}
