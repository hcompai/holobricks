const MAX_SIDE = 1600;
const QUALITY = 0.9;

/** An image file as a JPEG data URL at most MAX_SIDE pixels on its long side, transparency on white. */
export async function reference(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", QUALITY);
}

/** The image files among dropped, pasted or picked files. */
export function imageFiles(files: FileList | null | undefined): File[] {
  return [...(files ?? [])].filter((f) => f.type.startsWith("image/"));
}
