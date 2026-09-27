declare module "gifenc" {
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, colors: number): number[][];
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][]): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(
      indices: Uint8Array,
      width: number,
      height: number,
      options: { palette: number[][]; delay: number; repeat: number; dispose: number },
    ): void;
    finish(): void;
    bytesView(): Uint8Array<ArrayBuffer>;
  };
}
