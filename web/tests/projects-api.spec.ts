import { expect, test } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { POST as forkPOST } from "../api/forks";
import { POST as importPOST } from "../api/imports";
import { pass } from "../api/lib/account";
import { linkFork } from "../api/lib/forks";
import { projectName, saveProjectName } from "../api/lib/names";
import { enter, find } from "../api/lib/store";
import { DELETE, GET } from "../api/projects";
import { forkSeed } from "../src/forkModel";
import { blobStore } from "./blobStore";
import { ACCOUNT, fixture } from "./fixtures";

process.env.BRICKYARD_SECRET = "projects-test-secret";
const blob = blobStore();
const objects = blob.objects;

const OTHER = { ...ACCOUNT.user, id: "u-other", email: "other.person@hcompany.ai", name: "Other Person" };
const auth = (user = ACCOUNT.user) => ({
  Authorization: `Bearer ${pass(user, 4102444800, "test-key")}`,
  "X-Agents-Key": "test-key",
});
const del = (id: string, source: string, user = ACCOUNT.user) =>
  DELETE(
    new Request(`http://bricks.test/api/projects?id=${id}&source=${source}`, { method: "DELETE", headers: auth(user) }),
  );
const removed = async (user = ACCOUNT.user) =>
  (await GET(new Request("http://bricks.test/api/projects", { headers: auth(user) }))).json();
const files = (id: string) => [...objects.keys()].filter((p) => p.includes(id));

const realFetch = globalThis.fetch;
/** Whether the Agents API says the caller owns the session they name. */
let own = true;

test.beforeAll(async () => {
  await blob.start();
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === blob.base) return realFetch(input, init);
    if (url.hostname !== "agp.eu.hcompany.ai") throw new Error(`Unexpected test request: ${url.origin}`);
    const item = { id: "own-run", agent: "brickyard", status: "idle", created_at: "2026-01-01T00:00:00Z" };
    if (url.pathname === "/api/v2/sessions")
      return Response.json({ items: own ? [item] : [], total: own ? 1 : 0, page: 1 });
    return Response.json({ ...item, request: { agent: "brickyard", messages: [] }, status: { status: "idle" } });
  };
});
test.beforeEach(() => {
  objects.clear();
  own = true;
});
test.afterAll(async () => {
  globalThis.fetch = realFetch;
  await blob.stop();
});

test("deleting a session removes it from its owner's library and unpublishes it; others cannot", async () => {
  await enter(
    {
      id: "own-run",
      name: "Tower",
      pieces: 8,
      steps: 4,
      author: ACCOUNT.user.name,
      owner: ACCOUNT.user.id,
      published: 1,
      thumbnail: null,
      build: `${blob.base}/objects/builds/own-run/build.json.gz`,
    },
    [],
    [],
  );
  await saveProjectName(ACCOUNT.user.id, "own-run", "My tower");

  own = false;
  expect((await del("own-run", "session")).status).toBe(403);
  expect(await find("own-run")).not.toBeNull();
  own = true;

  expect((await del("own-run", "session")).status).toBe(204);
  expect(await removed()).toEqual(["own-run"]);
  expect(await removed(OTHER)).toEqual([]);
  expect(await find("own-run")).toBeNull();
  expect(await projectName(ACCOUNT.user.id, "own-run")).toBeNull();
});

test("deleting a fork deletes its files and name and removes the session it started", async () => {
  const id = "fork-22222222-2222-4222-8222-222222222222";
  const original = fixture();
  const seed = forkSeed(
    original,
    { id: original.id, source: "session", name: original.name, version: 1, revision: original.revision },
    "Tower · Fork",
  );
  const post = new Request("http://bricks.test/api/forks", {
    method: "POST",
    headers: auth(),
    body: new Uint8Array(gzipSync(JSON.stringify({ id, seed }))),
  });
  expect((await forkPOST(post)).status).toBe(201);
  await linkFork(ACCOUNT.user.id, id, "own-run");
  await saveProjectName(ACCOUNT.user.id, id, "Red tower");
  expect(files(id).length).toBeGreaterThan(2);

  expect((await del(id, "fork", OTHER)).status).toBe(404);
  expect((await del(id, "fork")).status).toBe(204);
  expect(files(id)).toEqual([`fork-owners/${id}.json`]);
  expect(await removed()).toEqual(["own-run"]);
});

test("deleting an imported build deletes its entry and files, for its owner only", async () => {
  const upload = new Request("http://bricks.test/api/imports", {
    method: "POST",
    headers: auth(),
    body: new Uint8Array(gzipSync(JSON.stringify({ model: fixture() }))),
  });
  const imported = (await (await importPOST(upload)).json()) as { id: string };
  expect(files(imported.id).length).toBeGreaterThan(0);

  expect((await del(imported.id, "public", OTHER)).status).toBe(404);
  expect((await del(imported.id, "public")).status).toBe(204);
  expect(files(imported.id)).toEqual([]);
  expect(await removed()).toEqual([]); // nothing left to hide: it is gone
});

test("a malformed request is refused before anything changes", async () => {
  expect((await del("../x", "session")).status).toBe(400);
  expect((await del("own-run", "showcase")).status).toBe(400);
  expect((await GET(new Request("http://bricks.test/api/projects"))).status).toBe(401);
});
