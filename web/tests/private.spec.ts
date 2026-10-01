import { expect, test } from "@playwright/test";
import { gzipSync } from "node:zlib";
import type { Build } from "../src/model";
import { ACCOUNT, fixture, site } from "./fixtures";

const BLOB = "https://blob.test";

interface Entry {
  id: string;
  name: string;
  prompt: string;
  pieces: number;
  steps: number;
  author: string;
  owner: string;
  published: number;
  thumbnail: null;
  build: string;
  private?: boolean;
}

/** The library API holding one imported build of the signed-in user's, with PATCH, ?mine=1 and DELETE. */
async function library(page: import("@playwright/test").Page, build: Build) {
  const entries: Entry[] = [
    {
      id: build.id,
      name: build.name,
      prompt: "",
      pieces: build.pieces.length,
      steps: build.steps.length,
      author: ACCOUNT.user.name,
      owner: ACCOUNT.user.id,
      published: 1,
      thumbnail: null,
      build: `${BLOB}/builds/${build.id}/build.json.gz`,
    },
  ];
  const calls: { method: string; search: string; body: unknown; auth: string | undefined }[] = [];
  await page.route(`${BLOB}/**`, (route) =>
    entries.length
      ? route.fulfill({ headers: { "access-control-allow-origin": "*" }, body: gzipSync(JSON.stringify(build)) })
      : route.fulfill({ status: 404 }),
  );
  await page.route("**/api/builds*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    calls.push({
      method,
      search: url.search.replace(/[?&]t=\d+/, ""),
      body: method === "PATCH" ? request.postDataJSON() : null,
      auth: request.headers().authorization,
    });
    if (method === "PATCH") {
      const { id, private: hidden } = request.postDataJSON();
      entries.find((e) => e.id === id)!.private = hidden;
      return route.fulfill({ status: 204 });
    }
    if (method === "DELETE") {
      entries.splice(0, entries.length);
      return route.fulfill({ status: 204 });
    }
    const id = url.searchParams.get("id");
    if (url.searchParams.has("mine")) return route.fulfill({ json: entries.filter((e) => e.private) });
    if (id) {
      const entry = entries.find((e) => e.id === id && (!e.private || request.headers().authorization));
      return entry ? route.fulfill({ json: entry }) : route.fulfill({ status: 404, json: { error: "Not public." } });
    }
    return route.fulfill({ json: entries.filter((e) => !e.private) });
  });
  return calls;
}

test("an imported build goes private and stays under the user's builds, goes public again, then is deleted after a confirmation", async ({
  page,
}) => {
  const build = { ...fixture(), id: "import-1", name: "Granite house" };
  await site(page);
  const calls = await library(page, build);
  await page.goto("/?public=import-1");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", build.revision);

  const share = page.getByRole("button", { name: "Share", exact: true });
  const menu = page.getByRole("menu");
  const copyLink = page.getByRole("menuitem", { name: "Copy link" });
  await share.click();
  await expect(menu).toContainText("In the public library: anyone at H can open it");
  await page.getByRole("menuitem", { name: "Make private…" }).click();
  const confirm = page.getByRole("dialog", { name: "Make private" });
  await expect(confirm).toContainText("stays under Your builds for you alone");
  await confirm.getByRole("button", { name: "Make private" }).click();
  await expect(confirm).toBeHidden();
  await share.click();
  await expect(menu).toContainText("Private: not in the public library");
  await expect(copyLink).toBeDisabled();
  await share.click();
  expect(calls.find((c) => c.method === "PATCH")).toMatchObject({
    body: { id: "import-1", private: true },
    auth: `Bearer ${ACCOUNT.pass}`,
  });
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);

  await page.getByRole("button", { name: "HoloBricks", exact: true }).click();
  await expect(page.getByRole("region", { name: "Your builds" }).locator(".tile")).toContainText("private");
  await expect(page.getByRole("region", { name: "Public builds" }).locator(".tile")).toHaveCount(0);
  await page.getByRole("region", { name: "Your builds" }).locator(".tile").click();
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", build.revision);

  await share.click();
  await page.getByRole("menuitem", { name: "Publish to the library…" }).click();
  await page.getByRole("dialog", { name: "Publish" }).getByRole("button", { name: "Publish" }).click();
  await share.click();
  await expect(copyLink).toBeEnabled();
  expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([
    { id: "import-1", private: true },
    { id: "import-1", private: false },
  ]);

  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const remove = page.getByRole("dialog", { name: "Delete" });
  await expect(remove).toContainText("Delete Granite house?");
  await remove.getByRole("button", { name: "Cancel" }).click();
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  await share.click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await remove.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(calls.find((c) => c.method === "DELETE")).toMatchObject({ search: "?id=import-1" });
  await expect(page.getByRole("region", { name: "Your builds" }).locator(".tile")).toHaveCount(0);
});
