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

/** Short, quiet synthesized pops: part family sets the timbre, part number varies the pitch. */
export function placementPop(part: string) {
  if (!enabled || !context || !output || context.state !== "running" || document.hidden) return;
  const now = context.currentTime;
  // At high placement speeds, one pop per audible beat keeps thousands of parts from becoming noise.
  if (now - last < 0.055) return;
  last = now;
  let hash = 0;
  for (const character of part) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const plate = /^(302|303|379|383)|plate/i.test(part);
  const tile = /^(3068|3070|4150|6636)|tile/i.test(part);
  const slope = /^(304|3039|3298|3660|4286)|slope/i.test(part);
  const frequency = (tile ? 620 : slope ? 290 : plate ? 390 : 210) * 2 ** ((hash % 7) / 12);
  const voice = context.createOscillator();
  const envelope = context.createGain();
  voice.type = slope ? "triangle" : "sine";
  voice.frequency.setValueAtTime(frequency * 1.65, now);
  voice.frequency.exponentialRampToValueAtTime(frequency, now + 0.035);
  envelope.gain.setValueAtTime(0.001, now);
  envelope.gain.exponentialRampToValueAtTime(0.18, now + 0.004);
  envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
  voice.connect(envelope).connect(output);
  voice.start(now);
  voice.stop(now + 0.08);
  voice.onended = () => {
    voice.disconnect();
    envelope.disconnect();
  };
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
    void context?.close();
  });
