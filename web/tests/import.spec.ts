import { expect, test } from "@playwright/test";
import { gunzipSync, gzipSync } from "node:zlib";
import { imported } from "../api/lib/imported";
import { Refusal } from "../api/lib/http";
import type { Build } from "../src/model";
import { ACCOUNT, fixture, revision, site } from "./fixtures";

const BLOB = "https://blob.test";

/** The model as `brickyard-gallery` exports it: with its chat, but its images point at the gallery. */
const exported = (): Build => ({
  ...fixture(),
  id: "007e8b1681",
  name: "Grand Rex",
  messages: [{ role: "user", text: "A diorama of the Grand Rex", images: ["/gallery/images/1.png"] }],
});

test("an import is checked and rebuilt: new id, recomputed revision and .ldr, unverified parts, no images", async () => {
  const model = exported();
  const build = await imported({ ...model, revision: "forged", ldr: "forged" }, "import-1");
  expect(build.id).toBe("import-1");
  expect(build.revision).toBe(revision(model.pieces));
  expect(build.ldr.split("\n").filter((l) => l.startsWith("1 "))).toHaveLength(model.pieces.length);
  expect(build.bom).toEqual({ error: expect.stringContaining("not verified") });
  expect(build.messages).toEqual([{ role: "user", text: "A diorama of the Grand Rex", images: [] }]);
  expect(build.steps.map((s) => s.title)).toEqual(model.steps.map((s) => s.title));
  expect(build).toMatchObject({ status: "done", open: false, parts: model.parts });
});

for (const [why, damage, message] of [
  ["no geometry", (m: any) => ({ ...m, parts: undefined }), /no part geometry/],
  ["a part without geometry", (m: any) => ({ ...m, parts: { "test-brick": "0 FILE x\n0 NOFILE" } }), /no geometry/],
  ["a malformed piece", (m: any) => ({ ...m, pieces: [{ ...m.pieces[0], pos: [0, "a", 0] }] }), /piece 1/],
  ["a path as a part", (m: any) => ({ ...m, pieces: [{ ...m.pieces[0], part: "../x" }] }), /piece 1/],
  ["shared ids", (m: any) => ({ ...m, pieces: [m.pieces[0], m.pieces[0]] }), /share an id/],
  ["no pieces", (m: any) => ({ ...m, pieces: [] }), /no pieces/],
] as const)
  test(`an import with ${why} is refused`, async () => {
    const attempt = imported(damage(exported()), "import-1");
    await expect(attempt).rejects.toBeInstanceOf(Refusal);
    await expect(attempt).rejects.toThrow(message);
  });

test("Import a build uploads the file as the signed-in user after a confirmation, then shows it under the user's builds", async ({
  page,
}) => {
  await site(page);
  const listed: object[] = [];
  const stored = new Map<string, Build>();
  const uploads: { headers: Record<string, string>; body: any }[] = [];
  await page.route(`${BLOB}/**`, (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[2];
    const build = stored.get(id);
    return build
      ? route.fulfill({ headers: { "access-control-allow-origin": "*" }, body: gzipSync(JSON.stringify(build)) })
      : route.fulfill({ status: 404 });
  });
  await page.route("**/api/imports", async (route) => {
    const body = JSON.parse(gunzipSync(route.request().postDataBuffer()!).toString());
    uploads.push({ headers: route.request().headers(), body });
    const build = await imported(body.model, "import-1");
    stored.set(build.id, build);
    const entry = {
      id: build.id,
      name: build.name,
      prompt: "",
      pieces: build.pieces.length,
      steps: build.steps.length,
      author: ACCOUNT.user.name,
      owner: ACCOUNT.user.id,
      published: 2,
      thumbnail: null,
      build: `${BLOB}/builds/${build.id}/build.json.gz`,
    };
    listed.unshift(entry);
    return route.fulfill({ status: 201, json: entry });
  });
  await page.route("**/api/builds*", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    return route.fulfill({ json: id ? listed.find((e: any) => e.id === id) : listed });
  });
  await page.goto("/");

  const mine = page.getByRole("region", { name: "Your builds" });
  const file = { name: "grand-rex.json", mimeType: "application/json" };
  await mine.getByLabel("Model file to import").setInputFiles({ ...file, buffer: Buffer.from("{}") });
  await expect(mine.getByRole("alert")).toContainText("not a HoloBricks model");

  await mine
    .getByLabel("Model file to import")
    .setInputFiles({ ...file, buffer: gzipSync(JSON.stringify(exported())), name: "grand-rex.json.gz" });
  const confirm = mine.getByRole("dialog", { name: "Import" });
  await expect(confirm).toContainText("Import Grand Rex?");
  await expect(confirm).toContainText("Its 8 pieces go public in the library");
  await confirm.getByRole("button", { name: "Import" }).click();

  await expect(page).toHaveURL(/\?public=import-1$/);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", revision(exported().pieces));
  expect(uploads).toHaveLength(1);
  expect(uploads[0].headers).toMatchObject({ authorization: `Bearer ${ACCOUNT.pass}`, "x-agents-key": ACCOUNT.key });
  expect(uploads[0].body.thumbnail).toMatch(/^data:image\/webp;base64,/);

  await page.getByRole("button", { name: "HoloBricks", exact: true }).click();
  await expect(mine.locator(".tile")).toContainText("Grand Rex");
  await expect(mine.locator(".tile")).toContainText("imported");
});
