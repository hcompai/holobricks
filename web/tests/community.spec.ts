import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { Build } from "../src/model";
import { cookie, HANDOFF, PENDING, setCookie } from "../src/signin";
import { ACCOUNT, fixture, site } from "./fixtures";
import { platform } from "./platform";

const BLOB = "https://blob.test";
const PORTAL = "https://portal.api.eu.hcompany.ai/api";

const shown = (page: Page, revision: string) =>
  expect(page.locator(".viewer")).toHaveAttribute("data-revision", revision);

const entry = (build: Build, author: string, owner: string) => ({
  id: build.id,
  name: build.name,
  prompt: build.name,
  pieces: build.pieces.length,
  steps: build.steps.length,
  author,
  owner,
  published: 1,
  thumbnail: null,
  build: `${BLOB}/builds/${build.id}/build.json.gz`,
});

interface Call {
  method: string;
  search: string;
  headers: Record<string, string>;
  body: any;
}

/** The public library API, holding `published`; publishing adds the signed-in user's build to it. */
async function library(page: Page, published: ReturnType<typeof entry>[], builds: Build[] = []) {
  const calls: Call[] = [];
  await page.route(`${BLOB}/**`, (route) => {
    const build = builds.find((b) => route.request().url() === `${BLOB}/builds/${b.id}/build.json.gz`);
    return build
      ? route.fulfill({ headers: { "access-control-allow-origin": "*" }, body: gzipSync(JSON.stringify(build)) })
      : route.fulfill({ status: 404 });
  });
  await page.route("**/api/builds*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    calls.push({
      method,
      search: url.search,
      headers: request.headers(),
      body: method === "POST" ? request.postDataJSON() : null,
    });
    const id = url.searchParams.get("id");
    if (method === "POST") {
      const build = builds.find((b) => b.id === request.postDataJSON().id)!;
      published.unshift(entry(build, ACCOUNT.user.name, ACCOUNT.user.id));
      return route.fulfill({ status: 201, json: published[0] });
    }
    if (method === "DELETE") {
      published.splice(
        published.findIndex((p) => p.id === id),
        1,
      );
      return route.fulfill({ status: 204 });
    }
    const one = published.find((p) => p.id === id);
    if (id) return one ? route.fulfill({ json: one }) : route.fulfill({ status: 404, json: { error: "Not public." } });
    return route.fulfill({ json: published });
  });
  return calls;
}

test("a colleague's public build opens from the library's Public section, under its author's name", async ({
  page,
}) => {
  const tower = { ...fixture(), id: "tower", name: "Ada's tower" };
  await site(page);
  await library(page, [entry(tower, "Ada Lovelace", "u-ada")], [tower]);
  await page.goto("/");

  await page.getByRole("button", { name: "Library" }).click();
  await expect(page).toHaveURL(/\?library$/);
  const tile = page.getByRole("region", { name: "Public" }).locator(".tile");
  await expect(tile).toContainText("by Ada Lovelace");
  await tile.click();
  await expect(page).toHaveURL(/\?public=tower$/);
  await shown(page, tower.revision);
  await expect(page.locator(".gallery-note")).toHaveText(/^By Ada Lovelace · Fork to edit/);
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
});

test("a fork of a public build starts a private session from a script placing each of its pieces, step by step", async ({
  page,
}) => {
  const tower = { ...fixture(), id: "tower", name: "Ada's tower" };
  await site(page);
  const agp = await platform(page);
  await library(page, [entry(tower, "Ada Lovelace", "u-ada")], [tower]);
  await page.goto("/?public=tower");
  await shown(page, tower.revision);

  await page.locator(".gallery-note").getByRole("button", { name: "Fork" }).click();
  await page.getByPlaceholder("Describe how to change it…").fill("Make it twice as tall");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\?build=new-build$/);
  await expect(page.locator("header .title")).toHaveText("Ada's tower · Fork");
  const first = agp.posted("/api/v2/sessions")[0].messages[0];
  expect(first.message).toBe("Make it twice as tall");
  expect(first.files.map((f: { name: string }) => f.name)).toEqual([
    "brickyard.tgz",
    "brickyard-fork.json.gz",
    "remix.py",
  ]);
  const script = Buffer.from(first.files[2].source, "base64").toString();
  expect(script.match(/^place\(/gm)).toHaveLength(tower.pieces.length);
  expect(script.match(/^step\(.*\)$/gm)).toEqual(tower.steps.map((s) => `step("${s.title}")`));
  expect(script).toMatch(
    /^step\("Layer 1"\)\nplace\("test-brick", 4, \(0, 0, 0\)\)\nplace\("test-brick", 4, \(40, 0, 0\)\)\n/,
  );
});

test("a public build's link copies to the clipboard", async ({ page, context }) => {
  const tower = { ...fixture(), id: "tower", name: "Ada's tower" };
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await site(page);
  await library(page, [entry(tower, "Ada Lovelace", "u-ada")], [tower]);
  await page.goto("/?public=tower");
  await shown(page, tower.revision);

  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/?public=tower`);
});

test("the author publishes a build after a confirmation, stays on it, then makes it private after another", async ({
  page,
}) => {
  const model = fixture();
  await site(page);
  const agp = await platform(page);
  agp.session("mine");
  agp.say("mine", "A little tower");
  agp.share("mine", model);
  agp.answer("mine", "Built.");
  const calls = await library(page, [], [{ ...model, id: "mine" }]);
  await page.goto("/?build=mine");
  await shown(page, model.revision);
  const copyLink = page.getByRole("button", { name: "Copy link" });
  await expect(copyLink).toHaveCount(0);

  const publishing = page.getByRole("dialog", { name: "Publish" });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(publishing).toContainText("the chat, and the photos you attached");
  await publishing.getByRole("button", { name: "Publish" }).click();
  await expect(publishing).toBeHidden();
  await expect(page).toHaveURL(/\?build=mine$/);
  const unpublish = page.getByRole("button", { name: "Public", exact: true });
  await expect(unpublish).toBeVisible();
  await expect(copyLink).toBeVisible();
  const post = calls.find((c) => c.method === "POST")!;
  expect(post.headers).toMatchObject({ authorization: `Bearer ${ACCOUNT.pass}`, "x-agents-key": ACCOUNT.key });
  expect(post.body).toEqual({ id: "mine", thumbnail: expect.stringMatching(/^data:image\/webp;base64,/), edits: null });

  const shelf = page.getByRole("button", { name: "Library" });
  const mine = page.getByRole("region", { name: "Mine" }).locator(".tile");
  const everyone = page.getByRole("region", { name: "Public" }).locator(".tile");
  await shelf.click();
  await expect(mine).toContainText("public");
  await expect(everyone).toContainText(`by ${ACCOUNT.user.name}`);
  await shelf.click();

  const confirm = page.getByRole("dialog", { name: "Make private" });
  await unpublish.click();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  await unpublish.click();
  await confirm.getByRole("button", { name: "Make private" }).click();
  await expect(page).toHaveURL(/\?build=mine$/);
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
  await expect(copyLink).toHaveCount(0);
  expect(calls.find((c) => c.method === "DELETE")).toMatchObject({
    search: "?id=mine",
    headers: { authorization: `Bearer ${ACCOUNT.pass}`, "x-agents-key": ACCOUNT.key },
  });
  await shelf.click();
  await expect(everyone).toHaveCount(0);
  await expect(mine).not.toContainText("public");
});

test("signed out, only the sign-in page shows; Google brings the user back signed in where they left", async ({
  page,
  context,
}) => {
  const tower = fixture();
  await site(page, [tower], null);
  let handoff: object = { error: "Brickyard is open to H Company accounts." };
  const pending: { verifier: string }[] = [];
  const challenges: (string | null)[] = [];
  await page.route(`${PORTAL}/auth/authorize?*`, (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    challenges.push(url.searchParams.get("code_challenge"));
    // Playwright routes no request that follows a redirect, so this portal navigates on instead.
    const next = JSON.stringify(url.searchParams.get("redirect_uri"));
    return route.fulfill({ contentType: "text/html", body: `<script>location.replace(${next})</script>` });
  });
  await page.route("**/api/session", async (route) => {
    const back = JSON.parse(cookie(await route.request().headerValue("cookie"), PENDING)!);
    pending.push(back);
    return route.fulfill({
      status: 303,
      headers: { location: back.back, "set-cookie": setCookie(HANDOFF, JSON.stringify(handoff), 60) },
    });
  });
  const google = page.getByRole("button", { name: "Continue with Google" });

  await page.goto(`/?showcase=${tower.id}`);
  await expect(page.getByRole("heading", { name: "Brickyard" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Library" })).toHaveCount(0);
  await google.click();
  await expect(page.getByRole("alert")).toHaveText("Brickyard is open to H Company accounts.");

  handoff = ACCOUNT;
  await google.click();
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`\\?showcase=${tower.id}$`));
  expect((await context.cookies()).map((c) => c.name)).not.toContain(HANDOFF);

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await google.click();
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
  const verifier = expect.stringMatching(/^[\w-]{43}$/);
  expect(pending).toEqual([
    { previous: null, back: `/?showcase=${tower.id}`, verifier },
    { previous: null, back: `/?showcase=${tower.id}`, verifier },
    { previous: ACCOUNT.keyId, back: `/?showcase=${tower.id}`, verifier },
  ]);
  expect(challenges).toEqual(pending.map((p) => createHash("sha256").update(p.verifier).digest("base64url")));
});
