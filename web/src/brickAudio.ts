import { plasticClick } from "./plasticClick";

/** The audio engine is separate from React and the renderer's off-screen work. */
const KEY = "brickyard.placement-sound";
const listeners = new Set<() => void>();
const preference = () => {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
};
let enabled = preference();
let context: AudioContext | null = null;
let output: GainNode | null = null;
let last = -Infinity;
const clicks = new Map<string, AudioBuffer>();

/** Short plastic seating clicks, with subtle differences between part families. */
export function placementPop(part: string) {
  if (!enabled || !context || !output || context.state !== "running" || document.hidden) return;
  const now = context.currentTime;
  // At high placement speeds, one click per audible beat keeps thousands of parts from becoming noise.
  if (now - last < 0.055) return;
  last = now;
  let buffer = clicks.get(part);
  if (!buffer) {
    const samples = plasticClick(part, context.sampleRate);
    buffer = context.createBuffer(1, samples.length, context.sampleRate);
    buffer.copyToChannel(samples, 0);
    if (clicks.size >= 32) clicks.delete(clicks.keys().next().value!);
    clicks.set(part, buffer);
  }
  const voice = context.createBufferSource();
  voice.buffer = buffer;
  voice.connect(output);
  voice.start(now);
  voice.onended = () => voice.disconnect();
}

export const placementSoundEnabled = () => enabled;
export function subscribePlacementSound(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function togglePlacementSound() {
  enabled = !enabled;
  try {
    localStorage.setItem(KEY, enabled ? "on" : "off");
  } catch {
    /* Keep the in-memory preference. */
  }
  for (const listener of listeners) listener();
  if (enabled) await unlockPlacementSound();
  else if (output && context) output.gain.setValueAtTime(0, context.currentTime);
}

async function unlockPlacementSound() {
  if (!enabled || typeof AudioContext === "undefined") return;
  context ??= new AudioContext();
  if (!output) {
    output = context.createGain();
    output.connect(context.destination);
  }
  output.gain.value = 0.35;
  await context.resume().catch(() => {});
}

if (enabled && typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => void unlockPlacementSound(), { once: true });
  window.addEventListener("keydown", () => void unlockPlacementSound(), { once: true });
}
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    clicks.clear();
    void context?.close();
  });
