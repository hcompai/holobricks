import { expect, test } from "@playwright/test";
import { pass, type User } from "../api/lib/account";
import { enter, find } from "../api/lib/store";
import { GET, PUT } from "../api/profile";
import { blobStore } from "./blobStore";

process.env.BRICKYARD_SECRET = "profile-test-secret";
const blob = blobStore();
const JANE: User = { id: "u-jane", email: "jane.doe@gmail.com", name: "Jane D." };
const OTHER: User = { id: "u-other", email: "jd1987@gmail.com", name: "" };

const headers = (user: User) => ({ Authorization: `Bearer ${pass(user, 4102444800, "key")}`, "X-Agents-Key": "key" });
const read = async (user: User) =>
  (await GET(new Request("http://bricks.test/api/profile", { headers: headers(user) }))).json();
const save = (user: User, name: string) =>
  PUT(
    new Request("http://bricks.test/api/profile", {
      method: "PUT",
      headers: headers(user),
      body: JSON.stringify({ name }),
    }),
  );

const published = (id: string, user: User) => ({
  id,
  name: id,
  pieces: 8,
  steps: 4,
  author: user.name,
  owner: user.id,
  published: 1,
  thumbnail: null,
  build: `${blob.base}/objects/builds/${id}/build.json.gz`,
});

test.beforeAll(() => blob.start());
test.afterAll(() => blob.stop());

test("a display name defaults from the email, then signs every public build of its owner's, and only theirs", async () => {
  await enter(published("tower", JANE), [], []);
  await enter(published("castle", OTHER), [], []);
  expect(await read(JANE)).toEqual({ name: "Jane D." });
  expect(await read(OTHER)).toEqual({ name: "" });

  const saved = await save(JANE, "  Jane   the  Builder ");
  expect(await saved.json()).toEqual({ name: "Jane the Builder" });
  expect(await read(JANE)).toEqual({ name: "Jane the Builder" });
  expect((await find("tower"))?.author).toBe("Jane the Builder");
  expect((await find("castle"))?.author).toBe("");

  for (const name of ["jane@gmail.com", "https://jane.test", "www.jane.test", "Holo fan", "J"]) {
    const refused = await save(JANE, name);
    expect(refused.status, name).toBe(400);
    expect((await refused.json()).error).toMatch(/\.$/);
  }
  expect((await find("tower"))?.author).toBe("Jane the Builder");

  expect(await (await save(JANE, "")).json()).toEqual({ name: "Jane D." });
  expect((await find("tower"))?.author).toBe("Jane D.");
});
