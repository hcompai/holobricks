import { useEffect, useRef, useState } from "react";
import { api, type Build } from "./api";
import { BrickScene, type View } from "./scene";

const VIEWS: { id: View; label: string }[] = [
  { id: "iso", label: "3/4" },
  { id: "front", label: "Front" },
  { id: "top", label: "Top" },
];

interface Props {
  build: Build | null;
  step: number;
  renderRequest: string | null;
}

export function Viewer({ build, step, renderRequest }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<BrickScene | null>(null);
  const framedBuild = useRef<string | null>(null);
  const thumbnailed = useRef(new Set<string>());
  const answered = useRef(new Set<string>());
  const [view, setView] = useState<View>("iso");
  const [spin, setSpin] = useState(false);
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
    s.setPieces(build?.pieces ?? []).then(async () => {
      if (!build || !build.pieces.length) return;
      if (framedBuild.current !== build.id) {
        framedBuild.current = build.id;
        s.frameView(view, width, depth);
      }
      if (build.status === "done" && !thumbnailed.current.has(build.id)) {
        thumbnailed.current.add(build.id);
        const png = await s.thumbnail();
        if (png) await api.putThumbnail(build.id, png);
      }
    });
  }, [build?.id, build?.pieces, build?.status]);

  useEffect(() => {
    const s = scene.current;
    if (!s || !build || !renderRequest || answered.current.has(renderRequest)) return;
    answered.current.add(renderRequest);
    s.setPieces(build.pieces)
      .then(() => s.sheet())
      .then((png) => png && api.putRender(build.id, renderRequest, png));
  }, [renderRequest, build?.id, build?.pieces]);

  useEffect(() => scene.current?.setVisibleStep(step), [step]);
  useEffect(() => scene.current?.setSpin(spin), [spin]);

  const choose = (v: View) => {
    setView(v);
    scene.current?.frameView(v, width, depth);
  };

  return (
    <div className="viewer">
      <div className="viewer-canvas" ref={container} />
      <div className="toolbar">
        {VIEWS.map((v) => (
          <button key={v.id} className={view === v.id ? "active" : ""} onClick={() => choose(v.id)}>
            {v.label}
          </button>
        ))}
        <span className="toolbar-sep" />
        <button className={spin ? "active accent" : ""} onClick={() => setSpin(!spin)}>
          Spin
        </button>
      </div>
      {!build && <div className="viewer-empty">Describe a model in the chat to start building.</div>}
    </div>
  );
}
