import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import "@fontsource-variable/fira-code";
import "@fontsource-variable/plus-jakarta-sans";
import "../src/styles.css";
import "./camera.css";
import { replayDelay } from "../src/buildTiming";
import { useEdits } from "../src/edits";
import { FilmExport } from "../src/FilmExport";
import type { Build } from "../src/model";
import { providePalette, usePalette } from "../src/palette";
import { provideParts } from "../src/scene";
import { Timeline } from "../src/Timeline";
import { Viewer, ViewControls, type Framing, type Mode } from "../src/Viewer";
import { COLORS, previewModel } from "./model";

providePalette(COLORS);

function CameraPreview() {
  const [build, setBuild] = useState<Build | null>(null);
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [follow, setFollow] = useState(true);
  const [spin, setSpin] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [framing, setFraming] = useState<Framing>({ view: "iso" });
  const [exporting, setExporting] = useState(false);
  const palette = usePalette();
  const edits = useEdits(build);
  useEffect(() => {
    void previewModel().then((model) => {
      provideParts(model.parts);
      setBuild({ ...model, status: "done" });
    });
  }, []);
  useEffect(() => {
    if (!build || !playing || placing || exporting || mode !== "view") return;
    if (step >= build.steps.length - 1) return setPlaying(false);
    const timer = setTimeout(() => setStep((s) => s + 1), replayDelay(step, speed));
    return () => clearTimeout(timer);
  }, [build, playing, placing, exporting, mode, step, speed]);
  const replay = () => {
    setStep(-1);
    setPlaying(true);
    setFollow(true);
    setSpin(false);
  };
  return (
    <div className="camera-preview">
      <header>
        <strong>HoloBricks</strong>
        <span>Camera preview</span>
        <button onClick={replay}>Replay</button>
        <button
          onClick={() => {
            setPlaying(false);
            setExporting(true);
          }}
        >
          Share a GIF
        </button>
      </header>
      <ViewControls
        framing={framing}
        spin={spin}
        followCamera={follow && mode === "view"}
        onFollowCamera={(next) => {
          setFollow(next);
          if (next) setSpin(false);
        }}
        mode={mode}
        built={!!build?.pieces.length}
        canEdit={!!build}
        onFrame={(next) => {
          setFollow(false);
          setFraming(next);
        }}
        onSpin={(next) => {
          setFollow(false);
          setSpin(next);
        }}
        onMode={(next) => {
          if (next !== "view") setFollow(false);
          setMode(next);
        }}
      />
      <Viewer
        build={build}
        opening={build ? null : "Loading…"}
        step={step}
        placementSpeed={speed}
        onPlacing={setPlacing}
        framing={framing}
        spin={spin}
        followCamera={follow}
        onFollowCamera={setFollow}
        mode={mode}
        edits={edits}
        describe={(piece) => piece.part}
        palette={palette}
        onMode={setMode}
      />
      <Timeline
        build={build}
        loading={!build}
        step={step}
        playing={playing}
        speed={speed}
        onStep={(next) => {
          setPlaying(false);
          setStep(next);
        }}
        onPlay={setPlaying}
        onSpeed={setSpeed}
        spaceKey={mode === "view"}
      />
      {build && exporting && <FilmExport build={build} onClose={() => setExporting(false)} />}
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<CameraPreview />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
