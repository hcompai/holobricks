import type { Page } from "@playwright/test";
import { gunzipSync } from "node:zlib";
import type { SavedFork } from "../src/forkModel";
import { createHash } from "node:crypto";
import type { Build, Piece } from "../src/model";

// Offline test geometry, deliberately independent of the LDraw install.
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
/** A box `w` x `d` studs and `h` LDraw units tall, its top at y 0, packed like the toolkit packs a part. */
export const boxPart = (name: string, title: string, w: number, d: number, h: number) => {
  const [x, z] = [w * 10, d * 10];
  return `0 FILE main.ldr
1 16 0 0 0 1 0 0 0 1 0 0 0 1 ${name}
0 FILE ${name}
0 ${title}
0 BFC CERTIFY CCW
4 16 -${x} 0 -${z} ${x} 0 -${z} ${x} 0 ${z} -${x} 0 ${z}
4 16 -${x} ${h} ${z} ${x} ${h} ${z} ${x} ${h} -${z} -${x} ${h} -${z}
4 16 -${x} 0 ${z} ${x} 0 ${z} ${x} ${h} ${z} -${x} ${h} ${z}
4 16 ${x} 0 -${z} -${x} 0 -${z} -${x} ${h} -${z} ${x} ${h} -${z}
4 16 ${x} 0 ${z} ${x} 0 -${z} ${x} ${h} -${z} ${x} ${h} ${z}
4 16 -${x} 0 -${z} -${x} 0 ${z} -${x} ${h} ${z} -${x} ${h} -${z}
0 NOFILE`;
};

/** The Replace picker's parts, as `scripts/pack-toolkit.py` writes them. */
export const partsCatalog = {
  parts: [
    { part: "test-plate.dat", title: "Test Plate 2 x 2", studs: [2, 2], plates: 1 },
    { part: "test-tile.dat", title: "Test Tile 1 x 1", studs: [1, 1], plates: 1 },
  ],
  packs: {
    "test-plate.dat": boxPart("test-plate.dat", "Test Plate 2 x 2", 2, 2, 8),
    "test-tile.dat": boxPart("test-tile.dat", "Test Tile 1 x 1", 1, 1, 8),
  },
};

export const colors = `0 !COLOUR Red CODE 4 VALUE #C91A09 EDGE #333333
0 !COLOUR Yellow CODE 14 VALUE #F2CD37 EDGE #333333
0 !COLOUR Blue CODE 1 VALUE #0055BF EDGE #333333
0 !COLOUR Green CODE 2 VALUE #237841 EDGE #333333
0 !COLOUR Main_Colour CODE 16 VALUE #FFFF80 EDGE #333333
0 !COLOUR Edge_Colour CODE 24 VALUE #333333 EDGE #333333`;

export const revision = (pieces: Piece[]) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        pieces.map((p) => [p.id, p.part, p.color, p.step, ...[...p.pos, ...p.rot].map((v) => Math.round(v * 1e6))]),
      ),
    )
    .digest("hex");

/** The build with its revision recomputed from its pieces. */
export const revised = (build: Build): Build => ({ ...build, revision: revision(build.pieces) });

export function fixture(): Build {
  // Eight pieces still exercise every color/step and the real GIF encoder, without making
  // CPU-only CI render two dozen full-size frames for each lifecycle assertion.
  const pieces: Piece[] = Array.from({ length: 8 }, (_, id) => ({
    id,
    part: "test-brick",
    color: [4, 14, 1, 2][Math.floor(id / 2)],
    step: Math.floor(id / 2),
    pos: [(id % 2) * 40, -Math.floor(id / 2) * 24, 0],
    rot: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  }));
  return {
    id: "export-test",
    name: "A little brick tower",
    builder: "holo",
    status: "done",
    open: false,
    updated: 1,
    width: 4,
    depth: 2,
    revision: revision(pieces),
    messages: [],
    steps: Array.from({ length: 4 }, (_, index) => ({ index, title: `Layer ${index + 1}` })),
    pieces,
    parts: { "test-brick": part },
    ldr: "0 FILE export-test.ldr\n",
    bom: { error: "The parts list was not checked." },
    shopping: { error: "The parts list was not checked." },
  };
}

export const ACCOUNT = {
  user: { id: "u-jane", email: "jane.doe@hcompany.ai", name: "Jane Doe" },
  key: "hk-test",
  keyId: "key-1",
  expires: 4102444800,
  pass: "pass-jane",
};

export async function signedIn(page: Page, account = ACCOUNT) {
  await page.addInitScript((a) => localStorage.setItem("brickyard.account", JSON.stringify(a)), account);
}

/** Serve the static files the app reads: the palette, the toolkit and these showcases; the Agents API has no sessions and the public library is empty. `account` is signed in, if any. */
export async function site(page: Page, showcases: Build[] = [], account: typeof ACCOUNT | null = ACCOUNT) {
  if (account) await signedIn(page, account);
  const names = new Map<string, { id: string; name: string; updated: number }>();
  await page.route("**/api/names", async (route) => {
    if (route.request().method() === "PATCH") {
      const { id, name } = route.request().postDataJSON();
      const entry = { id, name: name.trim(), updated: Date.now() };
      names.set(id, entry);
      return route.fulfill({ json: entry });
    }
    return route.fulfill({ json: [...names.values()] });
  });
  const copies = new Map<string, SavedFork>();
  const copyRequests: any[] = [];
  const copying = { loseResponse: false, fail: false };
  await page.route("**/api/forks*", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const { id, seed } = JSON.parse(gunzipSync(request.postDataBuffer()!).toString());
      copyRequests.push({ id, seed });
      if (copying.fail) return route.fulfill({ status: 503, json: { error: "Unavailable" } });
      if (!copies.has(id))
        copies.set(id, {
          id,
          seed,
          name: seed.model.name,
          pieces: seed.model.pieces.length,
          created: 2,
          sessionId: null,
        });
      if (copying.loseResponse) {
        copying.loseResponse = false;
        return route.abort("failed");
      }
      return route.fulfill({ status: 201, json: copies.get(id) });
    }
    if (request.method() === "PATCH") {
      const { id, sessionId } = request.postDataJSON();
      copies.get(id)!.sessionId = sessionId;
      return route.fulfill({ status: 204 });
    }
    const id = new URL(request.url()).searchParams.get("id");
    return route.fulfill({ json: id ? copies.get(id) : [...copies.values()].map(({ seed, ...info }) => info) });
  });
  await page.route("https://agp.eu.hcompany.ai/**", (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
      json: { items: [], total: 0, page: 1 },
    }),
  );
  await page.route("**/api/builds*", (route) =>
    new URL(route.request().url()).searchParams.has("id")
      ? route.fulfill({ status: 404, json: { error: "This build is not public." } })
      : route.fulfill({ json: [] }),
  );
  /** The ids of the builds the user deleted, as `/api/projects` lists them. */
  const deleted: string[] = [];
  await page.route("**/api/projects*", (route) => {
    if (route.request().method() !== "DELETE") return route.fulfill({ json: deleted });
    deleted.push(new URL(route.request().url()).searchParams.get("id")!);
    return route.fulfill({ status: 204 });
  });
  await page.route("**/LDConfig.ldr", (route) => route.fulfill({ body: colors }));
  await page.route("**/parts.json", (route) => route.fulfill({ json: partsCatalog }));
  await page.route("**/brickyard.tgz", (route) => route.fulfill({ body: Buffer.from("toolkit") }));
  await page.route("**/gallery/builds.json", (route) =>
    route.fulfill({
      json: showcases.map((b) => ({
        id: b.id,
        name: b.name,
        prompt: b.messages[0]?.text ?? b.name,
        status: b.status,
        created: 1,
        pieces: b.pieces.length,
        thumbnail: null,
      })),
    }),
  );
  await page.route("**/gallery/builds/*.json", (route) => {
    const id = decodeURIComponent(
      new URL(route.request().url()).pathname
        .split("/")
        .pop()!
        .replace(/\.json$/, ""),
    );
    const shown = showcases.find((b) => b.id === id);
    return shown ? route.fulfill({ json: shown }) : route.fulfill({ status: 404 });
  });
  return { copies, copyRequests, copying, names, deleted };
}
