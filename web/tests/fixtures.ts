import type { Build } from "../src/api";

// Offline test geometry, deliberately independent of the LDraw install and inference server.
export const part = `0 FILE main.ldr
1 16 0 0 0 1 0 0 0 1 0 0 0 1 test-brick.dat
0 FILE test-brick.dat
0 BFC CERTIFY CCW
4 16 -20 0 -20 20 0 -20 20 0 20 -20 0 20
4 16 -20 24 20 20 24 20 20 24 -20 -20 24 -20
4 16 -20 0 20 20 0 20 20 24 20 -20 24 20
4 16 20 0 -20 -20 0 -20 -20 24 -20 20 24 -20
4 16 20 0 20 20 0 -20 20 24 -20 20 24 20
4 16 -20 0 -20 -20 0 20 -20 24 20 -20 24 -20
0 NOFILE`;
export const colors = `0 !COLOUR Red CODE 4 VALUE #C91A09 EDGE #333333
0 !COLOUR Yellow CODE 14 VALUE #F2CD37 EDGE #333333
0 !COLOUR Blue CODE 1 VALUE #0055BF EDGE #333333
0 !COLOUR Green CODE 2 VALUE #237841 EDGE #333333
0 !COLOUR Main_Colour CODE 16 VALUE #FFFF80 EDGE #333333
0 !COLOUR Edge_Colour CODE 24 VALUE #333333 EDGE #333333`;

export function fixture(): Build {
  return {
    id: "export-test",
    name: "A little LEGO tower",
    prompt: "A little LEGO tower",
    builder: "holo",
    status: "done",
    created: 1,
    updated: 1,
    width: 4,
    depth: 2,
    messages: [],
    steps: Array.from({ length: 4 }, (_, index) => ({ index, title: `Layer ${index + 1}` })),
    // Eight pieces still exercise every color/step and the real encoder, without making
    // CPU-only CI render two dozen full-size frames for each lifecycle assertion.
    pieces: Array.from({ length: 8 }, (_, id) => ({
      id,
      part: "test-brick",
      color: [4, 14, 1, 2][Math.floor(id / 2)],
      step: Math.floor(id / 2),
      pos: [(id % 2) * 40, -Math.floor(id / 2) * 24, 0],
      rot: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    })),
  };
}
