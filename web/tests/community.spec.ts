import { expect, test, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import type { Build } from "../src/model";
import { ACCOUNT, fixture, site } from "./fixtures";
import { platform } from "./platform";

const BLOB = "https://blob.test";

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

test("anyone can open a public build from the library, shown under its author's name", async ({ page }) => {
  const tower = { ...fixture(), id: "tower", name: "Ada's tower" };
  await site(page);
  await library(page, [entry(tower, "Ada Lovelace", "u-ada")], [tower]);
  await page.goto("/");
  await expect(page.locator(".gallery-note")).toContainText("Sign in with your H account to build with Holo.");

  await page.getByRole("tab", { name: "Library" }).click();
  await expect(page.getByRole("region", { name: "Your builds" })).toHaveCount(0);
  const card = page.getByRole("region", { name: "Community" }).locator(".card");
  await expect(card).toContainText("by Ada Lovelace");
  await card.click();
  await expect(page).toHaveURL(/\?public=tower$/);
  await shown(page, tower.revision);
  await expect(page.locator(".gallery-note")).toHaveText(/^Shared by Ada Lovelace\./);
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
});

test("the author publishes a build with its render and the signed-in key, then takes it out", async ({ page }) => {
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

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const unpublish = page.getByRole("button", { name: "Public", exact: true });
  await expect(unpublish).toHaveAttribute("aria-pressed", "true");
  const post = calls.find((c) => c.method === "POST")!;
  expect(post.headers).toMatchObject({ authorization: `Bearer ${ACCOUNT.pass}`, "x-agents-key": ACCOUNT.key });
  expect(post.body).toEqual({ id: "mine", thumbnail: expect.stringMatching(/^data:image\/webp;base64,/), edits: null });

  await page.getByRole("tab", { name: "Library" }).click();
  await expect(page.getByRole("region", { name: "Your builds" }).locator(".card")).toContainText("public");
  await expect(page.getByRole("region", { name: "Community" }).locator(".card")).toContainText(
    `by ${ACCOUNT.user.name}`,
  );

  await unpublish.click();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
  expect(calls.find((c) => c.method === "DELETE")).toMatchObject({
    search: "?id=mine",
    headers: { authorization: `Bearer ${ACCOUNT.pass}`, "x-agents-key": ACCOUNT.key },
  });
  await expect(page.getByRole("region", { name: "Community" })).toHaveCount(0);
});

test("signing in goes through the H portal's window, and the next sign-in revokes the last key", async ({
  page,
  context,
}) => {
  await site(page);
  await context.route("https://portal.hcompany.ai/login*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<script>opener.postMessage({ type: "H_PORTAL_AUTH_SUCCESS", accessToken: "portal-token" }, "*")</script>`,
    }),
  );
  const signIns: unknown[] = [];
  await page.route("**/api/session", (route) => {
    signIns.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...ACCOUNT, keyId: `key-${signIns.length}` } });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  await expect(page.getByPlaceholder("Describe what to build…")).toBeVisible();
  expect(signIns).toEqual([{ accessToken: "portal-token", previousKey: null }]);

  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByRole("menu")).toContainText(ACCOUNT.user.email);
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.locator(".gallery-note")).toContainText("Sign in with your H account");

  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
  expect(signIns[1]).toEqual({ accessToken: "portal-token", previousKey: "key-1" });
});
