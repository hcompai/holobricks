import { useEffect, useState } from "react";
import { PHASES, THINKING_PHASES } from "../src/activity";
import { useEdits } from "../src/edits";
import { EMPTY_MODEL, type Build } from "../src/model";
import { providePalette, usePalette } from "../src/palette";
import { PlacementSoundToggle } from "../src/PlacementSound";
import { provideParts } from "../src/scene";
import type { Activity, Reference } from "../src/session";
import { Viewer, type Framing } from "../src/Viewer";
import { COLORS, previewModel } from "./model";

providePalette(COLORS);
const PHOTOS: Reference[] = [
  { id: "walls", src: "/dev/references/harlech-walls.jpg", caption: "Harlech · stone towers", kind: "photo" },
  { id: "gate", src: "/dev/references/harlech-gatehouse.jpg", caption: "Harlech · archway", kind: "photo" },
  { id: "stairs", src: "/dev/references/harlech-stairwell.jpg", caption: "Harlech · stairwell", kind: "photo" },
];

export default function Preview() {
  const [prompt, setPrompt] = useState("A red and white lighthouse on a rocky headland");
  const [phase, setPhase] = useState(0);
  const [automatic, setAutomatic] = useState(true);
  const [model, setModel] = useState<Build | null>(null);
  const [showModel, setShowModel] = useState(false);
  const [references, setReferences] = useState<Reference[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [step, setStep] = useState(Infinity);
  const [speed, setSpeed] = useState(1);
  const [framing, setFraming] = useState<Framing>({ view: "iso" });
  const [replay, setReplay] = useState(0);
  const palette = usePalette();
  useEffect(() => {
    void previewModel().then((next) => {
      provideParts(next.parts);
      setModel(next);
    });
  }, []);
  useEffect(() => {
    if (!automatic || showModel) return;
    const timer = setInterval(() => setPhase((p) => (p + 1) % 4), 8000);
    return () => clearInterval(timer);
  }, [automatic, showModel]);
  useEffect(() => {
    if (phase !== 2) return;
    setReferences([]);
    const timers = PHOTOS.map((photo, i) => setTimeout(() => setReferences((old) => [...old, photo]), 800 + i * 900));
    return () => timers.forEach(clearTimeout);
  }, [phase]);
  useEffect(() => {
    if (phase !== 3) return;
    setTitle(null);
    const timer = setTimeout(() => setTitle("The Last Light"), 1300);
    return () => clearTimeout(timer);
  }, [phase]);
  const build: Build =
    showModel && model
      ? { ...model, id: `preview-${replay}`, messages: [{ role: "user", text: prompt, images: [] }] }
      : {
          ...EMPTY_MODEL,
          id: "planning",
          status: "building",
          open: true,
          messages: [{ role: "user", text: prompt, images: [] }],
        };
  const edits = useEdits(build);
  const activity: Activity = {
    label: showModel ? PHASES.bricks : THINKING_PHASES[phase],
    since: Date.now(),
    work: null,
    references,
    title,
  };
  return (
    <div className="thinking-preview" style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      <header>
        <strong>HoloBricks</strong>
        <span className="muted">Animation preview</span>
        {!showModel && <PlacementSoundToggle />}
      </header>
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <Viewer
          build={edits.build}
          opening={null}
          step={step}
          framing={framing}
          spin={false}
          thinking={!showModel ? activity : null}
          placementSpeed={speed}
          mode="view"
          edits={edits}
          describe={(p) => p.part}
          palette={palette}
          onMode={() => {}}
        />
      </div>
      <div className="preview-controls">
        <div className="preview-subject">
          <label htmlFor="preview-request">What are we building?</label>
          <input id="preview-request" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        <div className="preview-phases">
          {THINKING_PHASES.map((label, index) => (
            <button
              key={label}
              aria-pressed={phase === index && !showModel}
              onClick={() => {
                setPhase(index);
                setAutomatic(false);
                setShowModel(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="preview-actions">
          <button aria-pressed={automatic} onClick={() => setAutomatic(!automatic)}>
            Auto-cycle: {automatic ? "on" : "off"}
          </button>
          <button
            onClick={() => {
              setShowModel(!showModel);
              setStep(Infinity);
            }}
          >
            {showModel ? "Hide model" : "Show first model"}
          </button>
          {showModel && (
            <>
              <button onClick={() => setReplay((n) => n + 1)}>Replay placement</button>
              {model?.steps.map((s) => (
                <button key={s.index} onClick={() => setStep(s.index)}>
                  {s.title}
                </button>
              ))}
              <button onClick={() => setStep(Infinity)}>All steps</button>
            </>
          )}
          <button onClick={() => setFraming({ view: framing.view === "iso" ? "front" : "iso" })}>Change view</button>
          <label>
            Speed{" "}
            <select aria-label="Placement speed" value={speed} onChange={(e) => setSpeed(+e.target.value)}>
              {[0.5, 1, 2, 4].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="preview-credit">
          Illustrative geometry and sample activity; the live app uses Holo’s shared parts and photos.
          {references.length > 0 && (
            <>
              {" "}
              Photos:{" "}
              <a href="https://commons.wikimedia.org/wiki/File:Harlech_Castle_(1).jpg">
                GeraintTudur2 / Wikimedia Commons
              </a>{" "}
              · CC BY-SA 3.0.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
