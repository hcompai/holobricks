import type { Message, Box, Camera, Model, RenderRequest } from "./model";

const numbers = (value: unknown, n: number): number[] | null =>
  Array.isArray(value) && value.length === n && value.every(Number.isFinite) ? value : null;

/** The view a `look` call asks for, or why it cannot be drawn. */
export function view(args: Record<string, unknown> = {}): { camera: Camera | null; box: Box | null } | string {
  const { angle, elevation, zoom, at, box } = args;
  const b = box === undefined ? null : numbers(box, 6);
  const center = at === undefined ? null : numbers(at, 3);
  if (box !== undefined && !b) return "`box` is six numbers: [x0, y0, z0, x1, y1, z1].";
  if (at !== undefined && !center) return "`at` is three numbers: [x, y, z].";
  const framed = [angle, elevation, zoom, at].some((v) => v !== undefined);
  const camera: Camera = {
    angle: typeof angle === "number" ? angle : 40,
    elevation: Math.min(90, Math.max(0, typeof elevation === "number" ? elevation : 30)),
    zoom: Math.min(16, Math.max(1, typeof zoom === "number" ? zoom : 1)),
    at: center as Camera["at"],
  };
  const [x0, y0, z0, x1, y1, z1] = b ?? [];
  return {
    camera: framed ? camera : null,
    box: b
      ? {
          x0: Math.min(x0, x1),
          y0: Math.min(y0, y1),
          z0: Math.min(z0, z1),
          x1: Math.max(x0, x1),
          y1: Math.max(y0, y1),
          z1: Math.max(z0, z1),
        }
      : null,
  };
}

/** The text beside a render, naming what it shows. */
export function caption(model: Model, { camera, box }: RenderRequest): string {
  let text = "The render: 3/4 front-right, 3/4 back-left, front, and top (back at the top).";
  if (camera) {
    const center = camera.at ? `, centered on x ${camera.at[0]}, y ${camera.at[1]}, z ${camera.at[2]}` : "";
    text = `The view from ${camera.angle} degrees, ${camera.elevation} up, zoom ${camera.zoom}${center}.`;
  }
  if (box)
    text = `Only the pieces in the box [${box.x0}, ${box.y0}, ${box.z0}, ${box.x1}, ${box.y1}, ${box.z1}]. ${text}`;
  return `Revision ${model.revision.slice(0, 8)}, ${model.pieces.length} pieces. ${text}`;
}

export const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Recover a completed inspection from its public tool result; the follower resolves its revision prefix. */
export function inspected(
  request: string | null | undefined,
  args: Record<string, unknown> | undefined,
  result: Message,
): RenderRequest | null {
  const revision = result.text.match(/^Revision ([a-f0-9]{8}),/)?.[1];
  const wanted = view(args);
  return request && revision && result.images.length && typeof wanted !== "string"
    ? { request, revision, ...wanted }
    : null;
}
