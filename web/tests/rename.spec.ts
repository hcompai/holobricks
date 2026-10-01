import { expect, test } from "@playwright/test";
import { ACCOUNT, fixture, revised, site } from "./fixtures";
import { platform } from "./platform";

async function project(page: import("@playwright/test").Page) {
  const store = await site(page);
  const agp = await platform(page);
  const model = { ...fixture(), name: "Lighthouse" };
  agp.session("light", "idle");
  agp.say("light", "Build a lighthouse");
  agp.share("light", model);
  await page.goto("/?build=light");
  await expect(page.getByRole("button", { name: "Rename", exact: true })).toBeVisible();
  await expect(page.locator(".aside-title")).toHaveText("Lighthouse");
  return { agp, model, ...store };
}

test("rename saves in place, survives a fresh read and stays through new Holo versions", async ({ page }) => {
  const { agp, model, names } = await project(page);
  await page.getByPlaceholder("Ask for a change").fill("Keep my chat draft");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("  Harbour light  ");
  await page.getByRole("textbox", { name: "Project name" }).press("Enter");
  await expect(page.locator(".aside-title")).toHaveText("Harbour light");
  await expect(page.getByPlaceholder("Ask for a change")).toHaveValue("Keep my chat draft");
  expect(names.get("light")?.name).toBe("Harbour light");
  expect(agp.posted("/api/v2/sessions")).toHaveLength(0);
  expect(agp.posted("/messages")).toHaveLength(0);
  await expect(page).toHaveURL(/\?build=light$/);
  const changed = revised({
    ...model,
    name: "Holo renamed this",
    pieces: model.pieces.map((p) => ({ ...p, color: 14 })),
  });
  agp.share("light", changed);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", changed.revision);
  await expect(page.locator(".aside-title")).toHaveText("Harbour light");
  await page.evaluate((owner) => localStorage.removeItem(`brickyard.names.${owner}`), ACCOUNT.user.id);
  await page.reload();
  await expect(page.locator(".aside-title")).toHaveText("Harbour light");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.getByRole("region", { name: "Mine", exact: true }).locator(".tile")).toContainText("Harbour light");
});

test("a fork has its own name on mobile; Escape cancels and failed saves preserve the input", async ({ page }) => {
  const { agp, names } = await project(page);
  await page.getByRole("button", { name: "Fork", exact: true }).click();
  await expect(page).toHaveURL(/\?fork=fork-/);
  const url = page.url();
  const id = new URL(url).searchParams.get("fork")!;
  await page.setViewportSize({ width: 390, height: 844 });
  const rename = page.getByRole("button", { name: "Rename", exact: true });
  await rename.click();
  const input = page.getByRole("textbox", { name: "Project name", exact: true });
  await input.fill("Discard this");
  await input.press("Escape");
  expect(names.size).toBe(0);
  await expect(page.locator("header .title")).toHaveText("Lighthouse · Fork");
  await rename.click();
  await input.fill("Red light");
  await page.route("**/api/names", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { error: "Saving unavailable." } })
      : route.fallback(),
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Saving unavailable.");
  await expect(input).toHaveValue("Red light");
  await page.screenshot({ path: "test-results/rename-mobile-error.png" });
  await page.unroute("**/api/names");
  // Restore the endpoint after removing the failure route.
  await page.route("**/api/names", async (route) => {
    if (route.request().method() === "PATCH") {
      const { id, name } = route.request().postDataJSON();
      names.set(id, { id, name, updated: Date.now() });
      return route.fulfill({ json: names.get(id) });
    }
    return route.fulfill({ json: [...names.values()] });
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("header .title")).toHaveText("Red light");
  await page.screenshot({ path: "test-results/rename-mobile.png" });
  expect(names.get(id)?.name).toBe("Red light");
  expect(names.has("light")).toBe(false);
  await page.reload();
  await expect(page.locator("header .title")).toHaveText("Red light");
  await expect(page.getByRole("link", { name: "Lighthouse", exact: true })).toBeVisible();
  expect(agp.posted("/api/v2/sessions")).toHaveLength(0);
});

test("showcases and a teammate's session cannot be renamed", async ({ page }) => {
  const model = fixture();
  await site(page, [model]);
  const agp = await platform(page);
  agp.session("theirs", "idle");
  agp.share("theirs", model);
  await page.route("https://agp.eu.hcompany.ai/api/v2/sessions?**", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1 } }),
  );
  await page.goto("/?build=theirs");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model.revision);
  await expect(page.getByRole("button", { name: "Rename", exact: true })).toHaveCount(0);
  await page.goto(`/?showcase=${model.id}`);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model.revision);
  await expect(page.getByRole("button", { name: "Rename", exact: true })).toHaveCount(0);
});
