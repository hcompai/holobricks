import { expect, test } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { DELETE as buildsDELETE, GET as buildsGET, PATCH as buildsPATCH, POST as buildsPOST } from "../api/builds";
import { POST as forkPOST } from "../api/forks";
import { POST as importPOST } from "../api/imports";
import { pass, type User } from "../api/lib/account";
import { projectName } from "../api/lib/names";
import { enter, find, findOwn } from "../api/lib/store";
import { PATCH as namesPATCH } from "../api/names";
import { DELETE as projectsDELETE } from "../api/projects";
import { forkSeed } from "../src/forkModel";
import { blobStore } from "./blobStore";
import { fixture } from "./fixtures";

// Only a build's owner renames, publishes, makes private or deletes it; an admin can only hide someone else's.
process.env.BRICKYARD_SECRET = "ownership-test-secret";
process.env.BRICKYARD_ADMINS = "ada.admin@hcompany.ai";
const blob = blobStore();

const OWNER: User = { id: "u-owner", email: "olive.owner@hcompany.ai", name: "Olive Owner" };
const OTHER: User = { id: "u-other", email: "otto.other@hcompany.ai", name: "Otto Other" };
const ADMIN: User = { id: "u-admin", email: "ada.admin@hcompany.ai", name: "Ada Admin" };
/** The session the owner's Agents API key lists as theirs; nobody else's key does. */
const RUN = "own-run";
const keys = new Map([
  [OWNER.id, "key-owner"],
  [OTHER.id, "key-other"],
  [ADMIN.id, "key-admin"],
]);
const headers = (user: User) => ({
  Authorization: `Bearer ${pass(user, 4102444800, keys.get(user.id)!)}`,
  "X-Agents-Key": keys.get(user.id)!,
});
const json = (user: User, method: string, body: unknown, url = "http://bricks.test/api/builds") =>
  new Request(url, {
    method,
    headers: { ...headers(user), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const as = (user: User, method: string, url: string) => new Request(url, { method, headers: headers(user) });

const realFetch = globalThis.fetch;
let imported = "";
const fork = "fork-33333333-3333-4333-8333-333333333333";

test.beforeAll(async () => {
  await blob.start();
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === blob.base) return realFetch(input, init);
    if (url.hostname !== "agp.eu.hcompany.ai") throw new Error(`Unexpected test request: ${url.origin}`);
    const key = new Headers(input instanceof Request ? input.headers : init?.headers).get("authorization");
    const theirs = key === `Bearer ${keys.get(OWNER.id)}`;
    const item = { id: RUN, agent: "brickyard", status: "idle", created_at: "2026-01-01T00:00:00Z" };
    if (url.pathname === "/api/v2/sessions")
      return Response.json({ items: theirs ? [item] : [], total: theirs ? 1 : 0, page: 1 });
    return Response.json({ ...item, request: { agent: "brickyard", messages: [] }, status: { status: "idle" } });
  };
});
test.beforeEach(async () => {
  blob.objects.clear();
  const upload = new Request("http://bricks.test/api/imports", {
    method: "POST",
    headers: headers(OWNER),
    body: new Uint8Array(gzipSync(JSON.stringify({ model: { ...fixture(), name: "Olive's house" } }))),
  });
  imported = ((await (await importPOST(upload)).json()) as { id: string }).id;
  const original = fixture();
  const seed = forkSeed(
    original,
    { id: original.id, source: "session", name: original.name, version: 1, revision: original.revision },
    "Olive's fork",
  );
  const copy = new Request("http://bricks.test/api/forks", {
    method: "POST",
    headers: headers(OWNER),
    body: new Uint8Array(gzipSync(JSON.stringify({ id: fork, seed }))),
  });
  expect((await forkPOST(copy)).status).toBe(201);
  await enter(
    {
      id: RUN,
      name: "Olive's tower",
      prompt: "",
      pieces: 8,
      steps: 4,
      author: OWNER.name,
      owner: OWNER.id,
      published: 1,
      thumbnail: null,
      build: `${blob.base}/objects/builds/${RUN}/build.json.gz`,
    },
    [],
    [],
  );
});
test.afterAll(async () => {
  globalThis.fetch = realFetch;
  await blob.stop();
});

for (const intruder of [OTHER, ADMIN])
  test(`${intruder.name} cannot rename, publish, change the visibility of or delete Olive's builds`, async () => {
    const untouched = blob.objects.size;

    // Rename: each kind of build, and nothing is written.
    for (const [id, source] of [
      [imported, "public"],
      [fork, "fork"],
      [RUN, "session"],
    ])
      expect(
        (await namesPATCH(json(intruder, "PATCH", { id, source, name: "Taken" }, "http://bricks.test/api/names")))
          .status,
      ).toBeGreaterThanOrEqual(403);
    expect((await find(imported))?.name).toBe("Olive's house");
    expect(await projectName(intruder.id, imported)).toBeNull();

    // Publish again over Olive's entry, or publish her fork.
    expect((await buildsPOST(json(intruder, "POST", { id: RUN, thumbnail: null, edits: null }))).status).toBe(403);
    expect((await buildsPOST(json(intruder, "POST", { id: fork, thumbnail: null, edits: null }))).status).toBe(404);

    // Make private or public.
    expect((await buildsPATCH(json(intruder, "PATCH", { id: imported, private: true }))).status).toBe(404);

    // Delete, whatever the kind.
    for (const [id, source] of [
      [imported, "public"],
      [fork, "fork"],
      [RUN, "session"],
    ])
      expect(
        (await projectsDELETE(as(intruder, "DELETE", `http://bricks.test/api/projects?id=${id}&source=${source}`)))
          .status,
      ).toBeGreaterThanOrEqual(403);

    expect(blob.objects.size).toBe(untouched);
    expect(await find(imported)).not.toBeNull();
    expect(await find(RUN)).not.toBeNull();
  });

test("only the owner unpublishes; another user is refused and an admin only hides the build, for its owner to keep", async () => {
  const unpublish = (user: User, id: string) =>
    buildsDELETE(as(user, "DELETE", `http://bricks.test/api/builds?id=${id}`));
  const files = () =>
    [...blob.objects.keys()].filter(
      (p) => p.includes(imported) && !p.startsWith("library/") && !p.startsWith("private/"),
    );
  const before = files();

  expect((await unpublish(OTHER, imported)).status).toBe(403);
  expect(await find(imported)).not.toBeNull();

  // Moderation: out of the public library, still Olive's, files intact.
  expect((await unpublish(ADMIN, imported)).status).toBe(204);
  expect(await find(imported)).toBeNull();
  expect(await findOwn(OWNER.id, imported)).toMatchObject({ owner: OWNER.id });
  expect(files()).toEqual(before);
  const mine = await buildsGET(as(OWNER, "GET", "http://bricks.test/api/builds?mine=1"));
  expect((await mine.json()).map((p: { id: string }) => p.id)).toEqual([imported]);
  // Nothing more an admin can do to it: it is private.
  expect((await unpublish(ADMIN, imported)).status).toBe(404);

  // Olive publishes it again; then only she can delete it.
  expect((await buildsPATCH(json(OWNER, "PATCH", { id: imported, private: false }))).status).toBe(204);
  expect((await unpublish(OWNER, imported)).status).toBe(204);
  expect(await findOwn(OWNER.id, imported)).toBeNull();
  expect(files()).toEqual([]);
});
