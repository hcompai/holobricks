import { expect, test } from "@playwright/test";
import { gunzipSync, gzipSync } from "node:zlib";
import { GET, PATCH } from "../api/builds";
import { pass, type User } from "../api/lib/account";
import {
  enter,
  find,
  findOwn,
  migratePrivate,
  renamePublished,
  save,
  setPrivate,
  unlist,
  type Published,
} from "../api/lib/store";
import { privateEntry, privateFolder, privateUrl } from "../api/lib/privateStore";
import { blobStore } from "./blobStore";
import { fixture } from "./fixtures";

process.env.BRICKYARD_SECRET = "private-storage-test-secret";
const owner: User = { id: "private-owner", email: "owner@hcompany.ai", name: "Owner" };
const other: User = { id: "other", email: "other@hcompany.ai", name: "Other" };
const blob = blobStore();
const id = "import-private-test";
let published: Published;
let modelUrl = "",
  imageUrl = "",
  thumbnailUrl = "";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6RkAAAAASUVORK5CYII=",
  "base64",
);
const headers = (user: User) => ({
  Authorization: `Bearer ${pass(user, 4102444800, "synthetic-key")}`,
  "X-Agents-Key": "synthetic-key",
});
const request = (user: User, file?: string) =>
  new Request(`http://bricks.test${file ? privateUrl(id, file) : `/api/builds?id=${id}`}`, { headers: headers(user) });

test.beforeAll(() => blob.start());
test.afterAll(() => blob.stop());
test.beforeEach(async () => {
  blob.objects.clear();
  blob.privateObjects.clear();
  blob.failures.privateWrite = blob.failures.publicDelete = false;
  imageUrl = await save(id, "images/1.png", png, "image/png");
  thumbnailUrl = await save(id, "thumbnail.png", png, "image/png");
  const model = {
    ...fixture(),
    id,
    messages: [{ role: "user", text: "Keep this model", images: [imageUrl, "https://photos.example/reference.jpg"] }],
  };
  modelUrl = await save(id, "build.json.gz", gzipSync(JSON.stringify(model)), "application/gzip");
  published = {
    id,
    owner: owner.id,
    name: "Private house",
    prompt: "Keep this model",
    author: "Owner",
    pieces: model.pieces.length,
    steps: model.steps.length,
    published: 1,
    thumbnail: thumbnailUrl,
    build: modelUrl,
  };
  await enter(published, [], [modelUrl, imageUrl, thumbnailUrl]);
});

test("private models and images require their owner, with no public objects left", async () => {
  await setPrivate(published, true);
  expect(blob.objects.size).toBe(0);
  for (const url of [modelUrl, imageUrl, thumbnailUrl]) expect((await fetch(url)).status).toBe(404);
  expect(await find(id)).toBeNull();
  const own = await findOwn(owner.id, id);
  expect(own?.build).toBe(privateUrl(id, "build.json.gz"));
  expect((await GET(new Request(`http://bricks.test${own!.build}`))).status).toBe(401);
  for (const file of [undefined, "build.json.gz", "images/1.png", "thumbnail.png"])
    expect((await GET(request(other, file))).status).toBe(404);
  const response = await GET(request(owner, "build.json.gz"));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const model = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString());
  expect(model.messages[0].images).toEqual([privateUrl(id, "images/1.png"), "https://photos.example/reference.jpg"]);
  const image = await GET(request(owner, "images/1.png"));
  expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
  expect(image.headers.get("x-content-type-options")).toBe("nosniff");
  const mine = await GET(new Request("http://bricks.test/api/builds?mine=1", { headers: headers(owner) }));
  expect((await mine.json())[0].thumbnail).toBe(privateUrl(id, "thumbnail.png"));
  expect(Buffer.from(await (await GET(request(owner, "thumbnail.png"))).arrayBuffer())).toEqual(png);
  expect(
    (await fetch(`https://testprivate.private.blob.vercel-storage.com/${privateFolder(owner.id, id)}build.json.gz`))
      .status,
  ).toBe(404);
  expect((await GET(request(owner, "../other/model.gz"))).status).toBe(404);
});

test("rename, republish and delete retain the model and restore public image references", async () => {
  await setPrivate(published, true);
  await renamePublished(owner.id, id, "Renamed house");
  await setPrivate((await findOwn(owner.id, id))!, false);
  const restored = (await find(id))!;
  expect(restored.name).toBe("Renamed house");
  expect(blob.privateObjects.size).toBe(0);
  const model = JSON.parse(gunzipSync(Buffer.from(await (await fetch(restored.build)).arrayBuffer())).toString());
  expect(model.messages[0].images).toEqual([imageUrl, "https://photos.example/reference.jpg"]);
  expect(Buffer.from(await (await fetch(restored.thumbnail!)).arrayBuffer())).toEqual(png);
  await setPrivate(restored, true);
  await unlist(id, owner.id);
  expect(blob.objects.size + blob.privateObjects.size).toBe(0);
});

test("failed copy preserves public files; missing configuration fails closed", async () => {
  blob.failures.privateWrite = true;
  await expect(setPrivate(published, true)).rejects.toThrow();
  expect(await find(id)).not.toBeNull();
  expect((await fetch(modelUrl)).ok).toBe(true);
  blob.failures.privateWrite = false;
  const token = process.env.BRICKYARD_PRIVATE_BLOB_TOKEN;
  delete process.env.BRICKYARD_PRIVATE_BLOB_TOKEN;
  try {
    const response = await PATCH(
      new Request("http://bricks.test/api/builds", {
        method: "PATCH",
        headers: { ...headers(owner), "Content-Type": "application/json" },
        body: JSON.stringify({ id, private: true }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await find(id)).not.toBeNull();
  } finally {
    process.env.BRICKYARD_PRIVATE_BLOB_TOKEN = token;
  }
});

test("cleanup failures are not acknowledged as private; owner access completes a retry", async () => {
  blob.failures.publicDelete = true;
  await expect(setPrivate(published, true)).rejects.toThrow();
  expect(JSON.parse(blob.privateObjects.get(privateEntry(owner.id, id))!.toString()).pending).toBe(true);
  await expect(findOwn(owner.id, id)).rejects.toThrow();
  blob.failures.publicDelete = false;
  expect((await findOwn(owner.id, id))?.owner).toBe(owner.id);
  expect(blob.objects.size).toBe(0);
  expect(JSON.parse(blob.privateObjects.get(privateEntry(owner.id, id))!.toString()).pending).toBeUndefined();
});

test("legacy entries migrate with all files and retries do not re-expose data", async () => {
  blob.objects.delete(`library/${id}.json`);
  blob.objects.set(privateEntry(owner.id, id), Buffer.from(JSON.stringify(published)));
  expect(await migratePrivate()).toBe(1);
  expect(await migratePrivate()).toBe(0);
  expect(blob.objects.size).toBe(0);
  expect((await GET(request(owner, "build.json.gz"))).status).toBe(200);
});

test("the operator command runs the same migration against isolated stores", async () => {
  blob.objects.delete(`library/${id}.json`);
  blob.objects.set(privateEntry(owner.id, id), Buffer.from(JSON.stringify(published)));
  await import("../scripts/migrate-private.mjs");
  expect(blob.objects.size).toBe(0);
  expect((await GET(request(owner, "build.json.gz"))).status).toBe(200);
});

test("Vercel's generated variable works without inferring the store id from its token", async () => {
  const token = process.env.BRICKYARD_PRIVATE_BLOB_TOKEN;
  delete process.env.BRICKYARD_PRIVATE_BLOB_TOKEN;
  process.env.BRICKYARD_PRIVATE_BLOB_READ_WRITE_TOKEN = token;
  try {
    await setPrivate(published, true);
    expect((await GET(request(owner, "build.json.gz"))).status).toBe(200);
  } finally {
    process.env.BRICKYARD_PRIVATE_BLOB_TOKEN = token;
    delete process.env.BRICKYARD_PRIVATE_BLOB_READ_WRITE_TOKEN;
  }
});
