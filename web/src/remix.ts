import type { Build, Matrix } from "./model";

const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** A build script placing every piece of `build` exactly where it is, one `step` per step of it. */
export function script(build: Build): string {
  const lines: string[] = [];
  for (const step of build.steps) {
    lines.push(`step(${JSON.stringify(step.title)})`);
    for (const p of build.pieces.filter((p) => p.step === step.index)) {
      const turned = p.rot.some((v, i) => v !== IDENTITY[i]) ? `, (${p.rot.join(", ")})` : "";
      lines.push(`place(${JSON.stringify(p.part.replace(/\.dat$/, ""))}, ${p.color}, (${p.pos.join(", ")})${turned})`);
    }
  }
  return lines.join("\n") + "\n";
}
