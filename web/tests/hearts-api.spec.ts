import { expect, test } from "@playwright/test";
import { DELETE, GET, PUT } from "../api/hearts";
import { pass, type User } from "../api/lib/account";
import { enter, type Published, unlist } from "../api/lib/store";
import { blobStore } from "./blobStore";

// Hearts are one per user per public build: idempotent, counted for everyone, listed back to their giver only.
process.env.BRICKYARD_SECRET = "hearts-test-secret";
const blob = blobStore();

const JANE: User = { id: "u-jane", email: "jane@example.com", name: "Jane" };
const JOHN: User = { id: "u-john", email: "john@example.com", name: "John" };
const headers = (user: User) => ({
  Authorization: `Bearer ${pass(user, 4102444800, `key-${user.id}`)}`,
  "X-Agents-Key": `key-${user.id}`,
});
const API = "http://bricks.test/api/hearts";
const put = (user: User, id: string) =>
  PUT(
    new Request(API, {
      method: "PUT",
      headers: { ...headers(user), "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }),
  );
const take = (user: User, id: string) =>
  DELETE(new Request(`${API}?id=${id}`, { method: "DELETE", headers: headers(user) }));
const read = async (user?: User) => (await GET(new Request(API, { headers: user ? headers(user) : {} }))).json();

const published = (id: string): Published => ({
  id,
  name: id,
  pieces: 3,
  steps: 1,
  author: "Someone",
  owner: "u-someone",
  published: 1,
  thumbnail: null,
  build: `${blob.base}/objects/builds/${id}/build.json.gz`,
});

test.beforeAll(() => blob.start());
test.afterAll(() => blob.stop());
test.beforeEach(async () => {
  blob.objects.clear();
  await enter(published("hut"), [], []);
  await enter(published("boat"), [], []);
});

test("hearts count once per user, come back to their giver, and leave with the build", async () => {
  expect((await put(JANE, "hut")).status).toBe(204);
  expect((await put(JANE, "hut")).status).toBe(204);
  expect((await put(JOHN, "hut")).status).toBe(204);
  expect((await put(JOHN, "boat")).status).toBe(204);

  expect(await read()).toEqual({ counts: { hut: 2, boat: 1 }, mine: [] });
  expect(await read(JANE)).toEqual({ counts: { hut: 2, boat: 1 }, mine: ["hut"] });
  expect((await read(JOHN)).mine.sort()).toEqual(["boat", "hut"]);

  expect((await take(JANE, "hut")).status).toBe(204);
  expect(await read(JANE)).toEqual({ counts: { hut: 1, boat: 1 }, mine: [] });

  await unlist("hut");
  expect(await read()).toEqual({ counts: { boat: 1 }, mine: [] });
});

test("only public builds take hearts, and only from signed-in users", async () => {
  expect((await put(JANE, "nope")).status).toBe(404);
  expect((await put(JANE, "../etc")).status).toBe(400);
  const anonymous = await PUT(new Request(API, { method: "PUT", body: JSON.stringify({ id: "hut" }) }));
  expect(anonymous.status).toBe(401);
  expect(await read()).toEqual({ counts: {}, mine: [] });
});
