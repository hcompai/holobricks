// Draw each showcase's library tile from its model, as the app draws a build's: node scripts/thumbnails.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const GALLERY = "public/gallery";

const summaries = JSON.parse(await readFile(`${GALLERY}/builds.json`, "utf8"));
await mkdir(`${GALLERY}/thumbnails`, { recursive: true });
const server = await createServer({ logLevel: "warn" });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  for (const summary of summaries) {
    const url = await page.evaluate(async (id) => {
      const { BrickScene, provideParts } = await import("/src/scene.ts");
      const { showcase, thumbnail } = await import("/src/library.ts");
      const build = await showcase(id);
      provideParts(build.parts);
      const scene = new BrickScene(document.createElement("div"), { interactive: false });
      try {
        const png = (await scene.setPieces(build.pieces)) && (await scene.thumbnail());
        if (!png) throw new Error(`The showcase ${id} did not draw`);
        return await thumbnail(png);
      } finally {
        scene.dispose();
      }
    }, summary.id);
    const [, type, data] = url.match(/^data:image\/(\w+);base64,(.+)$/);
    if (type !== "webp") throw new Error(`This browser writes ${type}, not WebP`);
    await writeFile(`${GALLERY}/thumbnails/${summary.id}.webp`, Buffer.from(data, "base64"));
    summary.thumbnail = Date.now();
    console.log(`${GALLERY}/thumbnails/${summary.id}.webp`);
  }
  await writeFile(`${GALLERY}/builds.json`, JSON.stringify(summaries));
} finally {
  await browser.close();
  await server.close();
}
