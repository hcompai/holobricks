import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { GET, POST, PATCH } from "../api/forks";
import { pass, privateScope } from "../api/lib/account";
import { GET as namesGET, PATCH as namesPATCH } from "../api/names";
import { projectName } from "../api/lib/names";
import { linkFork } from "../api/lib/forks";
import { snapshot } from "../api/lib/snapshot";
import { forkSeed } from "../src/forkModel";
import { ACCOUNT, fixture } from "./fixtures";

// Exercise the actual Blob SDK against an isolated local transport. No production credentials or writes.
process.env.BRICKYARD_SECRET = "fork-test-secret";
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_teststore_testsecret";
process.env.VERCEL_BLOB_RETRIES = "0";
const objects = new Map<string, Buffer>();
const cachedObjects = new Map<string, Buffer>();
let base = "";
let writes = 0;
const metadata = (pathname: string) => ({
  pathname,
  url: `${base}/objects/${pathname}`,
  downloadUrl: `${base}/objects/${pathname}`,
  size: objects.get(pathname)?.length ?? 0,
  uploadedAt: new Date().toISOString(),
  contentType: pathname.endsWith(".gz") ? "application/gzip" : "application/json",
  etag: `etag-${writes}`,
});
const server = createServer(async (request, response) => {
  const url = new URL(request.url!, base);
  const send = (data: unknown, status = 200) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(data));
  };
  if (url.pathname.startsWith("/objects/")) {
    const path = url.pathname.slice(9);
    const data = cachedObjects.get(path) ?? objects.get(path);
    response.writeHead(data ? 200 : 404);
    response.end(data);
  } else if (request.method === "PUT") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const pathname = url.searchParams.get("pathname")!;
    if (request.headers["x-allow-overwrite"] === "0" && objects.has(pathname))
      return send({ error: { code: "bad_request", message: "Blob already exists" } }, 400);
    objects.set(pathname, Buffer.concat(chunks));
    writes++;
    send(metadata(pathname));
  } else if (url.searchParams.has("url")) {
    const pathname = url.searchParams.get("url")!;
    send(
      objects.has(pathname) ? metadata(pathname) : { error: { code: "not_found" } },
      objects.has(pathname) ? 200 : 404,
    );
  } else {
    const prefix = url.searchParams.get("prefix") ?? "";
    send({ blobs: [...objects.keys()].filter((p) => p.startsWith(prefix)).map(metadata), hasMore: false });
  }
});

const copy = "fork-11111111-1111-4111-8111-111111111111";
const original = fixture();
const seed = () =>
  forkSeed(
    original,
    { id: original.id, source: "session", name: original.name, version: 4, revision: original.revision },
    "Tower · Fork",
  );
function request(method = "GET", data?: unknown, owner = ACCOUNT.user, suffix = "") {
  return new Request(`http://bricks.test/api/forks${suffix}`, {
    method,
    headers: { Authorization: `Bearer ${pass(owner, 4102444800, "test-key")}`, "X-Agents-Key": "test-key" },
    ...(data === undefined
      ? {}
      : { body: method === "POST" ? new Uint8Array(gzipSync(JSON.stringify(data))) : JSON.stringify(data) }),
  });
}
const realFetch = globalThis.fetch;
let agentCalls: string[] = [];
let own = true;
let group = copy;

test.beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.VERCEL_BLOB_API_URL = base;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === base) return realFetch(input, init);
    if (url.hostname !== "agp.eu.hcompany.ai") throw new Error(`Unexpected test request: ${url.origin}`);
    agentCalls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    const item = { id: "own-run", agent: "brickyard", status: "idle", created_at: "2026-01-01T00:00:00Z" };
    if (url.pathname === "/api/v2/sessions")
      return Response.json({ items: own ? [item] : [], total: own ? 1 : 0, page: 1 });
    return Response.json({
      ...item,
      request: { agent: "brickyard", group_id: group, messages: [] },
      status: { status: "idle" },
    });
  };
});
test.beforeEach(() => {
  objects.clear();
  cachedObjects.clear();
  writes = 0;
  agentCalls = [];
  own = true;
  group = copy;
});
test.afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  delete process.env.VERCEL_BLOB_API_URL;
});

test("a copy persists without an agent, retries once under the same identity, and lists only its owner", async () => {
  expect((await POST(request("POST", { id: copy, seed: seed() }))).status).toBe(201);
  const changed = seed();
  changed.model.name = "Must not replace the saved copy";
  expect((await POST(request("POST", { id: copy, seed: changed }))).status).toBe(201);
  expect(writes).toBe(2); // one seed and one metadata record, not a second copy
  const saved = await GET(request("GET", undefined, ACCOUNT.user, `?id=${copy}`));
  expect(saved.headers.get("cache-control")).toBe("private, no-store");
  expect(await saved.json()).toMatchObject({
    id: copy,
    name: "Tower · Fork",
    sessionId: null,
    seed: JSON.parse(JSON.stringify(seed())),
  });
  const listed = await (await GET(request())).json();
  expect(listed).toHaveLength(1);
  expect(listed[0]).not.toHaveProperty("seed");
  expect(JSON.stringify(listed)).not.toContain("/models/");
  const other = { ...ACCOUNT.user, id: "another-user" };
  expect(await (await GET(request("GET", undefined, other))).json()).toEqual([]);
  expect((await GET(request("GET", undefined, other, `?id=${copy}`))).status).toBe(404);
  expect(agentCalls).toEqual([]);
});

test("authentication and geometry validation reject invalid copies before storing anything", async () => {
  expect((await GET(new Request("http://bricks.test/api/forks"))).status).toBe(401);
  const invalid = seed();
  invalid.model.pieces[0].color++;
  expect((await POST(request("POST", { id: copy, seed: invalid }))).status).toBe(400);
  const incomplete = seed();
  incomplete.model.parts = {};
  expect((await POST(request("POST", { id: copy, seed: incomplete }))).status).toBe(400);
  expect((await POST(request("POST", { id: "../elsewhere", seed: seed() }))).status).toBe(400);
  expect(objects.size).toBe(0);
  expect(agentCalls).toEqual([]);
});

test("publishing a saved copy includes its model and hand edits without private chat or ancestry", async () => {
  const given = {
    ...seed(),
    model: {
      ...seed().model,
      messages: [{ text: "private chat" }],
      recovery: { source: "private source" },
      work: "private work",
    },
  };
  await POST(request("POST", { id: copy, seed: given }));
  const published = await snapshot(
    copy,
    "test-key",
    null,
    async () => {
      throw new Error("No images expected");
    },
    ACCOUNT.user.id,
  );
  expect(published).toMatchObject({
    id: copy,
    name: "Tower · Fork",
    revision: original.revision,
    messages: [],
    open: false,
  });
  for (const field of ["seed", "origin", "recovery", "work"]) expect(published).not.toHaveProperty(field);
  const edited = await snapshot(
    copy,
    "test-key",
    { revision: original.revision, edits: [{ kind: "delete", ids: [0] }] },
    async () => "",
    ACCOUNT.user.id,
  );
  expect(edited.pieces).toHaveLength(original.pieces.length - 1);
  expect(edited.revision).not.toBe(original.revision);
  await expect(snapshot(copy, "test-key", null, async () => "", "another-user")).rejects.toMatchObject({ status: 404 });
  expect(agentCalls).toEqual([]);
});

test("attaching Holo requires both session ownership and the same copy operation", async () => {
  await POST(request("POST", { id: copy, seed: seed() }));
  own = false;
  expect((await PATCH(request("PATCH", { id: copy, sessionId: "own-run" }))).status).toBe(403);
  own = true;
  group = "other-copy";
  expect((await PATCH(request("PATCH", { id: copy, sessionId: "own-run" }))).status).toBe(400);
  group = copy;
  expect((await PATCH(request("PATCH", { id: copy, sessionId: "own-run" }))).status).toBe(204);
  expect((await PATCH(request("PATCH", { id: copy, sessionId: "own-run" }))).status).toBe(204);
  expect(await (await GET(request("GET", undefined, ACCOUNT.user, `?id=${copy}`))).json()).toMatchObject({
    id: copy,
    sessionId: "own-run",
  });
  expect(agentCalls.every((call) => call.startsWith("GET "))).toBe(true);
});

test("missing storage configuration reports an unavailable service without losing or starting a model", async () => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const response = await POST(request("POST", { id: copy, seed: seed() }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Saving is not configured on this server." });
    expect(objects.size).toBe(0);
    expect(agentCalls).toEqual([]);
  } finally {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_teststore_testsecret";
  }
});

test("rename persists for a saved fork without modifying geometry, history, links or starting Holo", async () => {
  await POST(request("POST", { id: copy, seed: seed() }));
  const before = await (await GET(request("GET", undefined, ACCOUNT.user, `?id=${copy}`))).json();
  for (const name of ["Red lighthouse", "  Port light  "]) {
    const response = await namesPATCH(request("PATCH", { id: copy, source: "fork", name }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: copy, name: name.trim() });
  }
  expect(await (await namesGET(request())).json()).toEqual([
    { id: copy, name: "Port light", updated: expect.any(Number) },
  ]);
  expect(await projectName(ACCOUNT.user.id, copy)).toMatchObject({ name: "Port light" });
  expect(await (await GET(request("GET", undefined, ACCOUNT.user, `?id=${copy}`))).json()).toEqual(before);
  expect(agentCalls).toEqual([]);
});

test("rename enforces authentication, ownership and short non-empty names", async () => {
  expect((await namesGET(new Request("http://bricks.test/api/names"))).status).toBe(401);
  await POST(request("POST", { id: copy, seed: seed() }));
  const other = { ...ACCOUNT.user, id: "another-user" };
  expect((await namesPATCH(request("PATCH", { id: copy, source: "fork", name: "Not mine" }, other))).status).toBe(404);
  own = false;
  expect((await namesPATCH(request("PATCH", { id: "own-run", source: "session", name: "Not mine" }))).status).toBe(403);
  own = true;
  expect((await namesPATCH(request("PATCH", { id: "own-run", source: "session", name: "My project" }))).status).toBe(
    200,
  );
  for (const name of ["", "   ", "x".repeat(81), "bad\nname"])
    expect((await namesPATCH(request("PATCH", { id: copy, source: "fork", name }))).status).toBe(400);
  expect((await namesPATCH(request("PATCH", { id: "../path", source: "session", name: "X" }))).status).toBe(400);
  expect((await namesPATCH(request("PATCH", { id: "showcase", source: "showcase", name: "X" }))).status).toBe(400);
  expect(await (await namesGET(request("GET", undefined, other))).json()).toEqual([]);
  expect(agentCalls.every((call) => call.startsWith("GET "))).toBe(true);
});

test("an imported or published project's rename retains its link and visibility", async () => {
  const published = { id: "import-test", owner: ACCOUNT.user.id, name: "Old name", build: "unchanged-model-url" };
  objects.set("library/import-test.json", Buffer.from(JSON.stringify(published)));
  const response = await namesPATCH(request("PATCH", { id: "import-test", source: "public", name: "New name" }));
  expect(response.status).toBe(200);
  expect(JSON.parse(objects.get("library/import-test.json")!.toString())).toEqual({ ...published, name: "New name" });
  expect(objects.has(`private/${ACCOUNT.user.id}/import-test.json`)).toBe(false);
  expect(await projectName(ACCOUNT.user.id, "import-test")).toMatchObject({ name: "New name" });
  const other = { ...ACCOUNT.user, id: "another-user" };
  expect((await namesPATCH(request("PATCH", { id: "import-test", source: "public", name: "No" }, other))).status).toBe(
    404,
  );
  expect([...objects.keys()].filter((key) => key.startsWith(`names/${privateScope(other.id)}/`))).toEqual([]);
});

test("a stale pre-start record cannot hide the session from reload or Library", async () => {
  await POST(request("POST", { id: copy, seed: seed() }));
  const path = `models/${privateScope(ACCOUNT.user.id)}/${copy}.json`;
  const before = objects.get(path)!;
  cachedObjects.set(path, before);
  expect((await PATCH(request("PATCH", { id: copy, sessionId: "own-run" }))).status).toBe(204);
  expect((await PATCH(request("PATCH", { id: copy, sessionId: "own-run" }))).status).toBe(204);
  expect(objects.get(path)).toEqual(before);
  expect(writes).toBe(3); // Seed, metadata and one immutable session link.
  expect(await (await GET(request("GET", undefined, ACCOUNT.user, `?id=${copy}`))).json()).toMatchObject({
    sessionId: "own-run",
    seed: { model: { revision: original.revision } },
  });
  expect(await (await GET(request())).json()).toEqual([expect.objectContaining({ id: copy, sessionId: "own-run" })]);
  expect((await PATCH(request("PATCH", { id: copy, sessionId: "different-run" }))).status).toBe(403);
  await expect(linkFork(ACCOUNT.user.id, copy, "different-run")).rejects.toMatchObject({ status: 409 });
  expect(agentCalls.every((call) => call.startsWith("GET "))).toBe(true);
});

test("concurrent links cannot replace the winning session and legacy links still load", async () => {
  await POST(request("POST", { id: copy, seed: seed() }));
  const attempts = await Promise.allSettled([
    linkFork(ACCOUNT.user.id, copy, "first"),
    linkFork(ACCOUNT.user.id, copy, "second"),
  ]);
  expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(attempts.find((r) => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  const winner = await (await GET(request("GET", undefined, ACCOUNT.user, `?id=${copy}`))).json();
  await expect(linkFork(ACCOUNT.user.id, copy, winner.sessionId)).resolves.toBeUndefined();
  const path = `models/${privateScope(ACCOUNT.user.id)}/${copy}`;
  objects.delete(`${path}.session.json`);
  objects.set(
    `${path}.json`,
    Buffer.from(JSON.stringify({ ...JSON.parse(objects.get(`${path}.json`)!.toString()), sessionId: "legacy" })),
  );
  expect(await (await GET(request("GET", undefined, ACCOUNT.user, `?id=${copy}`))).json()).toMatchObject({
    sessionId: "legacy",
  });
});
