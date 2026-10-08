import { useEffect, useState } from "react";
import { loadAsset } from "./loadAsset";

/** An LDraw color a piece can take. */
export interface Color {
  code: number;
  name: string;
  hex: string;
  family: "solid" | "transparent" | "metallic";
}

const PALETTE = "/LDConfig.ldr";
const COLOUR = /^0\s+!COLOUR\s+(\S+)\s+CODE\s+(\d+)\s+VALUE\s+(#[0-9a-f]{6})(.*)$/gim;
/** Main and edge colors are placeholders, and rubber, glow and material entries are not brick finishes. */
const PLACEHOLDERS = new Set([16, 24]);
const NOT_BRICKS = /\b(RUBBER|MATERIAL|LUMINANCE)\b/;

let source: Promise<string> | null = null;
let colors: Promise<Color[]> | null = null;

/** Supply the palette alongside packed parts in a standalone preview, before any scene loads. */
export function providePalette(text: string) {
  source = Promise.resolve(text);
  colors = null;
}

/** The LDraw palette file, read once and shared by every scene. */
export function paletteFile(): Promise<string> {
  if (!source) {
    const pending = loadAsset(PALETTE);
    source = pending;
    void pending.catch(() => {
      if (source === pending) source = null;
    });
  }
  return source;
}

/** The palette's brick colors, in its order; read once and shared. */
export function palette(): Promise<Color[]> {
  colors ??= paletteFile().then((text) =>
    [...text.matchAll(COLOUR)].flatMap(([, name, code, hex, rest]) => {
      if (PLACEHOLDERS.has(+code) || NOT_BRICKS.test(rest)) return [];
      const family = /\bALPHA\b/.test(rest)
        ? "transparent"
        : /\b(CHROME|METAL|PEARLESCENT)\b/.test(rest)
          ? "metallic"
          : "solid";
      return [{ code: +code, name: name.replaceAll("_", " "), hex, family } satisfies Color];
    }),
  );
  void colors.catch(() => (colors = null));
  return colors;
}

/** The palette once it has loaded, empty until then or if it cannot load. */
export function usePalette(): Color[] {
  const [loaded, setLoaded] = useState<Color[]>([]);
  useEffect(() => {
    let current = true;
    palette().then(
      (c) => current && setLoaded(c),
      (e) => console.error("Could not read the color palette", e),
    );
    return () => {
      current = false;
    };
  }, []);
  return loaded;
}
