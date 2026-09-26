import { useEffect, useRef } from "react";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { api, GALLERY, type Build, type RenderRequest } from "./api";
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
        <button key={v.id} className={framing.view === v.id ? "active" : ""} onClick={() => onFrame({ view: v.id })}>
          {v.label}
        </button>
      ))}
      <span className="tabs-sep" />
      <button className={spin ? "active" : ""} onClick={() => onSpin(!spin)}>
        <ArrowsClockwiseIcon size={14} weight="bold" />
        Spin
      </button>
    </div>
  );
}

interface Props {
  build: Build | null;
  step: number;
  renderRequest: RenderRequest | null;
  framing: Framing;
  spin: boolean;
}

export function Viewer({ build, step, renderRequest, framing, spin }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<BrickScene | null>(null);
  const framedBuild = useRef<string | null>(null);
  const thumbnailed = useRef(new Set<string>());
  const answered = useRef(new Set<string>());
  const width = build?.width ?? 32;
  const depth = build?.depth ?? 32;

  useEffect(() => {
    const s = new BrickScene(container.current!);
    scene.current = s;
    return () => s.dispose();
  }, []);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    let current = true;
    s.setPieces(build?.pieces ?? []).then(async () => {
      if (!current || !build || !build.pieces.length) return;
      if (framedBuild.current !== build.id || !s.userMoved) {
        framedBuild.current = build.id;
        s.frameView(framing.view, width, depth);
      }
      if (!GALLERY && build.status === "done" && !thumbnailed.current.has(build.id)) {
        thumbnailed.current.add(build.id);
        const png = await s.thumbnail();
        if (png) await api.putThumbnail(build.id, png);
      }
    });
    return () => {
      current = false;
    };
  }, [build?.id, build?.pieces, build?.status]);

  useEffect(() => {
    const s = scene.current;
    if (!s || !build || !renderRequest || answered.current.has(renderRequest.request)) return;
    const { request, camera, pieces } = renderRequest;
    if (build.pieces.length !== pieces) return;
    answered.current.add(request);
    s.setPieces(build.pieces)
      .then(() => (camera ? s.view(camera) : s.sheet()))
      .then((png) => png && api.putRender(build.id, request, png, pieces))
      .catch((error) => console.error("Could not answer a render request", error));
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
      {!build && (
        <div className="viewer-empty">
          {GALLERY ? "Pick a build from the library." : "Describe a model in the chat to start building."}
        </div>
      )}
    </div>
  );
}
