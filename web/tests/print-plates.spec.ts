import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import type { PriceTable } from "../src/pickabrick";
import { colors, fixture, site } from "./fixtures";

const TABLE: PriceTable = {
  source: "LEGO Pick a Brick",
  locale: "en-US",
  currency: "USD",
  fetched_at: Date.UTC(2026, 8, 30) / 1000,
  prices: { "test-brick:4": [125, 1, "300121"] },
};

/** The files of a zip archive, by name. */
function unzip(archive: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = archive.readUInt32LE(end + 16);
  for (let n = archive.readUInt16LE(end + 10); n > 0; n--) {
    const [size, nameLength, extra, comment, offset] = [
      archive.readUInt32LE(at + 20),
      archive.readUInt16LE(at + 28),
      archive.readUInt16LE(at + 30),
      archive.readUInt16LE(at + 32),
      archive.readUInt32LE(at + 42),
    ];
    const name = archive.toString("utf8", at + 46, at + 46 + nameLength);
    const start = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28);
    files.set(name, inflateRawSync(archive.subarray(start, start + size)).toString("utf8"));
    at += 46 + nameLength + extra + comment;
  }
  return files;
}

async function open(page: Page, table: PriceTable | null) {
  const build = fixture();
  await site(page, [build]);
  await page.route("**/pick-a-brick.json", (route) =>
    table ? route.fulfill({ json: table }) : route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.route("**/LDConfig.ldr", (route) => route.fulfill({ body: colors }));
  await page.goto(`/?showcase=${build.id}`);
  await expect(page.locator(".viewer")).toHaveAttribute("data-render-state", "ready");
  await page.getByRole("button", { name: /^Get the bricks/ }).click();
  return page.getByRole("dialog", { name: "Build it for real" });
}

test("the print plates sit next to the Pick a Brick list: one plate a color, every brick at real size", async ({
  page,
}) => {
  const sheet = await open(page, TABLE);
  const store = sheet.getByRole("region", { name: "Pick a Brick" });
  await expect(store.getByRole("button", { name: "Download Pick a Brick list" })).toBeVisible();

  const download = page.waitForEvent("download");
  await store.getByRole("button", { name: "Download 3MF plates" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("A little LEGO tower print plates.3mf");
  await expect(store.getByRole("status")).toHaveText("4 plates of 200 × 200 mm, one color each.");

  const parts = unzip(await readFile(await file.path()));
  expect([...parts.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"]);
  const model = parts.get("3D/3dmodel.model")!;
  expect(model).toContain('unit="millimeter"');
  expect([...model.matchAll(/<base name="([^"]+)" displaycolor="([^"]+)"/g)].map((m) => [m[1], m[2]])).toEqual([
    ["Red", "#C91A09FF"],
    ["Yellow", "#F2CD37FF"],
    ["Blue", "#0055BFFF"],
    ["Green", "#237841FF"],
  ]);
  expect([...model.matchAll(/<object [^>]*name="(Plate [^"]+)"/g)].map((m) => m[1])).toEqual([
    "Plate 1 · Red",
    "Plate 2 · Yellow",
    "Plate 3 · Blue",
    "Plate 4 · Green",
  ]);
  // The fixture's brick is 2 x 2 studs and 24 LDraw units tall: 16 x 16 x 9.6 mm, side by side, flat on the bed.
  const plate = model.slice(model.indexOf('name="Plate 1'), model.indexOf('name="Plate 2'));
  expect([...plate.matchAll(/<component [^>]*transform="1 0 0 0 1 0 0 0 1 ([^"]+)"/g)].map((m) => m[1])).toEqual([
    "8 8 9.6",
    "27 8 9.6",
  ]);
  const zs = [...model.matchAll(/<vertex x="[^"]+" y="[^"]+" z="([^"]+)"/g)].map((m) => +m[1]);
  expect([Math.min(...zs), Math.max(...zs)]).toEqual([-9.6, 0]);
  expect(model.match(/<triangle /g)).toHaveLength(4 * 12);
});

test("without Pick a Brick prices, the print plates still have their own place", async ({ page }) => {
  const sheet = await open(page, null);
  await expect(sheet.getByRole("region", { name: "Pick a Brick" })).toHaveCount(0);
  const printing = sheet.getByRole("region", { name: "3D printing" });
  const download = page.waitForEvent("download");
  await printing.getByRole("button", { name: "Download 3MF plates" }).click();
  expect((await download).suggestedFilename()).toBe("A little LEGO tower print plates.3mf");
});
