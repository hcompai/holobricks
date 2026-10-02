/** A dry ABS-style click: a light contact followed by the sharper snap of studs seating. */
export function plasticClick(part: string, sampleRate: number): Float32Array<ArrayBuffer> {
  let hash = 0;
  for (const character of part) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  const tile = /^(3068|3070|4150|6636)|tile/i.test(part);
  const slope = /^(304|3039|3298|3660|4286)|slope/i.test(part);
  const plate = /^(302|303|379|383)|plate/i.test(part);
  // Small differences in size/timbre, rather than musical notes or pitch sweeps.
  const variation = 1 + (((hash >>> 16) % 9) - 4) * 0.013;
  const body = (tile ? 2350 : slope ? 1700 : plate ? 2050 : 1550) * variation;
  const snap = tile ? 0.0038 : plate ? 0.0044 : 0.0062;
  const duration = 0.04;
  const samples = new Float32Array(Math.ceil(sampleRate * duration));
  let seed = hash || 1;
  let previous = 0;
  for (let i = 0; i < samples.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 0x100000000) * 2 - 1;
    const bright = (noise - previous) * 0.5;
    previous = noise;
    const time = i / sampleRate;
    const hit = (age: number, strength: number) => {
      if (age < 0) return 0;
      const attack = Math.min(1, age / 0.00015);
      const transient = 0.62 * bright * Math.exp(-age / 0.0011);
      const shell = 0.2 * Math.sin(2 * Math.PI * body * age) * Math.exp(-age / 0.0035);
      const edge = 0.12 * Math.sin(2 * Math.PI * body * 2.37 * age) * Math.exp(-age / 0.0018);
      return strength * attack * (transient + shell + edge);
    };
    const fade = Math.min(1, (samples.length - 1 - i) / (sampleRate * 0.004));
    samples[i] = (hit(time, 0.55) + hit(time - snap, 1)) * fade;
  }
  return samples;
}
