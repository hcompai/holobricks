import { buildRevision } from "../src/buildRevision";
import { EMPTY_MODEL, type Build, type Piece } from "../src/model";

// Self-contained illustrative geometry; the live app continues to use the model's real packed LDraw parts.
function brick(part: string, width: number, depth: number, height: number, studs: boolean): string {
  const lines = [
    `0 FILE main.ldr`,
    `1 16 0 0 0 1 0 0 0 1 0 0 0 1 ${part}.dat`,
    `0 FILE ${part}.dat`,
    "0 BFC CERTIFY CCW",
  ];
  const x = width / 2,
    z = depth / 2;
  const quad = (...coords: number[]) => lines.push(`4 16 ${coords.join(" ")}`);
  quad(-x, 0, -z, x, 0, -z, x, 0, z, -x, 0, z);
  quad(-x, height, z, x, height, z, x, height, -z, -x, height, -z);
  quad(-x, 0, z, x, 0, z, x, height, z, -x, height, z);
  quad(x, 0, -z, -x, 0, -z, -x, height, -z, x, height, -z);
  quad(x, 0, z, x, 0, -z, x, height, -z, x, height, z);
  quad(-x, 0, -z, -x, 0, z, -x, height, z, -x, height, -z);
  if (studs)
    for (let sx = -x + 10; sx < x; sx += 20)
      for (let sz = -z + 10; sz < z; sz += 20) {
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * 2 * Math.PI,
            b = ((i + 1) / 16) * 2 * Math.PI;
          const ax = sx + Math.cos(a) * 6,
            az = sz + Math.sin(a) * 6;
          const bx = sx + Math.cos(b) * 6,
            bz = sz + Math.sin(b) * 6;
          quad(ax, -4, az, bx, -4, bz, bx, 0, bz, ax, 0, az);
          lines.push(`3 16 ${sx} -4 ${sz} ${ax} -4 ${az} ${bx} -4 ${bz}`);
        }
      }
  return [...lines, "0 NOFILE"].join("\n");
}

export const COLORS = `0 !COLOUR Black CODE 0 VALUE #05131D EDGE #333333
0 !COLOUR Blue CODE 1 VALUE #0055BF EDGE #333333
0 !COLOUR Green CODE 2 VALUE #237841 EDGE #333333
0 !COLOUR Red CODE 4 VALUE #C91A09 EDGE #333333
0 !COLOUR Yellow CODE 14 VALUE #F2CD37 EDGE #333333
0 !COLOUR White CODE 15 VALUE #FFFFFF EDGE #333333
0 !COLOUR Tan CODE 19 VALUE #E4CD9E EDGE #333333
0 !COLOUR Dark_Tan CODE 28 VALUE #958A73 EDGE #333333
0 !COLOUR Reddish_Brown CODE 70 VALUE #582A12 EDGE #333333
0 !COLOUR Light_Bluish_Grey CODE 71 VALUE #A0A5A9 EDGE #333333
0 !COLOUR Dark_Bluish_Grey CODE 72 VALUE #6C6E68 EDGE #333333
0 !COLOUR Main_Colour CODE 16 VALUE #FFFF80 EDGE #333333
0 !COLOUR Edge_Colour CODE 24 VALUE #333333 EDGE #333333`;

export async function previewModel(): Promise<Build> {
  const pieces: Piece[] = [];
  const add = (part: string, color: number, pos: Piece["pos"], step: number, turn = false) =>
    pieces.push({
      id: pieces.length,
      part,
      color,
      pos,
      step,
      rot: turn ? [0, 0, 1, 0, 1, 0, -1, 0, 0] : [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });
  for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) add("preview-plate", 71, [x * 80, 0, z * 80], 0);
  for (let layer = 0; layer < 12; layer++) {
    const color = Math.floor(layer / 2) % 2 ? 4 : 15;
    const y = -24 - layer * 24;
    add("preview-brick", color, [100, y, 80], 1);
    add("preview-brick", color, [160, y, 100], 1, true);
    add("preview-brick", color, [140, y, 160], 1);
    add("preview-brick", color, [80, y, 140], 1, true);
  }
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) add("preview-tile", 0, [80 + x * 40, -296, 80 + z * 40], 2);
  return {
    ...EMPTY_MODEL,
    id: "preview",
    status: "building",
    open: true,
    name: "The Last Light",
    width: 16,
    depth: 16,
    pieces,
    revision: await buildRevision(pieces),
    steps: [
      { index: 0, title: "Rocky headland" },
      { index: 1, title: "Striped tower" },
      { index: 2, title: "Roof" },
    ],
    parts: {
      "preview-brick": brick("preview-brick", 80, 40, 24, true),
      "preview-plate": brick("preview-plate", 80, 80, 8, true),
      "preview-tile": brick("preview-tile", 40, 40, 8, false),
    },
    messages: [],
  };
}
