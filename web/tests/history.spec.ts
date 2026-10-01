import { expect, test, type Page } from "@playwright/test";
import { gunzipSync } from "node:zlib";
import { fixture, revised, site } from "./fixtures";
import { platform } from "./platform";

const shown = (page: Page, revision: string) =>
  expect(page.locator(".viewer")).toHaveAttribute("data-revision", revision);
const versions = () =>
  [4, 14, 1, 2, 4, 14].map((color, n) =>
    revised({
      ...fixture(),
      name: "Panther",
      pieces: fixture().pieces.map((p) => ({ ...p, color, pos: [p.pos[0] + n * 20, p.pos[1], p.pos[2]] })),
    }),
  );

async function history(page: Page) {
  await site(page);
  const agp = await platform(page);
  const saved = versions();
  agp.session("panther", "idle");
  agp.say("panther", "A panther");
  for (const v of saved) {
    agp.share("panther", v);
    agp.now += 1000;
  }
  await page.goto("/?build=panther");
  await shown(page, saved[5].revision);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("button", { name: "V6 · Latest", exact: true })).toBeVisible();
  return { agp, saved };
}

test("preview is read-only, survives reload, preserves the latest draft and never creates a run", async ({ page }) => {
  const { agp, saved } = await history(page);
  await page.getByPlaceholder("Describe how to change it…").fill("Keep this draft");
  await page.getByRole("button", { name: "V4", exact: true }).click();
  await shown(page, saved[3].revision);
  await expect(page.locator(".preview-note")).toContainText("Preview · V4");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveAttribute("title", "Edit Latest or Fork");
  await page.locator(".preview-note").getByRole("button", { name: "Latest", exact: true }).click();
  await shown(page, saved[5].revision);
  await expect(page.getByRole("textbox")).toHaveValue("Keep this draft");
  await page.getByRole("button", { name: "V4", exact: true }).click();
  await page.reload();
  await shown(page, saved[3].revision);
  await expect(page.locator(".preview-note")).toContainText("Preview · V4");
  expect(agp.posted("/api/v2/sessions")).toHaveLength(0);
  expect(agp.posted("/messages")).toHaveLength(0);
  await page.screenshot({ path: "test-results/history-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "History", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/history-mobile.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect((await page.locator(".viewer").boundingBox())!.height).toBeGreaterThan(200);
});

test("fork V4 keeps V5/V6 in the original and starts its own V1, then V2 only when the design changes", async ({
  page,
}) => {
  const { agp, saved } = await history(page);
  await page.getByRole("button", { name: "V4", exact: true }).click();
  await page.locator(".history-tools").getByRole("button", { name: "Fork", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".fork-note")).toContainText("Fork · V4");
  await expect(page.getByRole("textbox")).toBeFocused();
  await expect(page.locator(".chat-log .msg")).toHaveCount(0);
  expect(agp.posted("/api/v2/sessions")).toHaveLength(0);
  await page.getByPlaceholder("Describe how to change it…").fill("Make it sit");
  await page.screenshot({ path: "test-results/fork-composer.png" });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/build=new-build$/);
  await shown(page, saved[3].revision);
  await expect(page.locator("header .title")).toHaveText("Panther · Fork");
  const [created] = agp.posted("/api/v2/sessions");
  expect(created.messages).toHaveLength(1);
  expect(created.messages[0].message).toBe("Make it sit");
  const seedFile = created.messages[0].files.find((f: any) => f.name === "brickyard-fork.json.gz");
  const seed = JSON.parse(gunzipSync(Buffer.from(seedFile.source, "base64")).toString());
  expect(seed.model.pieces).toEqual(JSON.parse(JSON.stringify(saved[3].pieces)));
  expect(seed.origin).toMatchObject({ id: "panther", version: 4, revision: saved[3].revision });
  expect(seed.model).not.toHaveProperty("messages");
  expect(seed.model).not.toHaveProperty("recovery");
  expect(agp.posted("/messages")).toHaveLength(0);
  await page.reload();
  await shown(page, saved[3].revision);
  await expect(page.locator("header .title")).toHaveText("Panther · Fork");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("button", { name: "V1 · Latest", exact: true })).toBeVisible();
  agp.share("new-build", saved[3]);
  agp.answer("new-build", "Starting model restored.");
  await expect(page.getByPlaceholder("Describe how to change it…")).toBeVisible();
  await expect(page.locator(".history-versions button")).toHaveCount(1);
  agp.share("new-build", saved[0]);
  await expect(page.getByRole("button", { name: "V2 · Latest", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Panther · V4", exact: true }).click();
  await shown(page, saved[3].revision);
  await expect(page.getByRole("button", { name: "V6 · Latest", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.getByRole("region", { name: "Mine", exact: true }).locator(".tile")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Mine", exact: true })).toContainText("Panther · Fork");
  expect(agp.sessions.get("panther")!.shared).toBe(6);
});

test("preview does not change Holo's live render or the chosen fork snapshot when a new version arrives", async ({
  page,
}) => {
  const { agp, saved } = await history(page);
  await page.getByRole("button", { name: "V4", exact: true }).click();
  agp.state("panther", "running");
  await page.locator(".history-tools").getByRole("button", { name: "Fork", exact: true }).click();
  const next = revised({ ...saved[5], pieces: saved[5].pieces.map((p) => ({ ...p, color: 2 })) });
  agp.share("panther", next);
  agp.look("panther", "live-look", { angle: 90 });
  await shown(page, saved[3].revision);
  await expect.poll(() => agp.posted("/tool_results")).toHaveLength(1);
  expect(agp.posted("/tool_results")[0].result[0]).toContain(`Revision ${next.revision.slice(0, 8)}`);
  await expect(page.locator(".fork-note")).toContainText("Fork · V4");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await page.getByRole("textbox").fill("Keep these proportions");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/build=new-build$/);
  await shown(page, saved[3].revision);
  expect(agp.sessions.get("panther")!.shared).toBe(7);
  expect(agp.posted("/force_answer")).toHaveLength(0);
  expect(agp.posted("/messages")).toHaveLength(0);
});

test("lost fork creation response reopens the accepted session, without a duplicate POST", async ({ page }) => {
  const { agp } = await history(page);
  agp.loseCreationResponse = true;
  await page.locator(".history-tools").getByRole("button", { name: "Fork", exact: true }).click();
  await page.getByPlaceholder("Describe how to change it…").fill("Add ears");
  await page.getByRole("button", { name: "Send", exact: true }).dblclick();
  await expect(page).toHaveURL(/build=new-build$/);
  expect(agp.posted("/api/v2/sessions")).toHaveLength(1);
});

test("a missing history attachment cannot shift version numbers; Retry restores the exact sequence", async ({
  page,
}) => {
  await site(page);
  const agp = await platform(page);
  const saved = versions();
  agp.session("panther", "idle");
  for (const v of saved) agp.share("panther", v);
  const url = "https://agp.eu.hcompany.ai/files/panther/3.gz";
  const data = agp.files.get(url)!;
  agp.files.delete(url);
  await page.goto("/?build=panther&version=4");
  await expect(page.locator(".history-error")).toContainText("History unavailable");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  expect(agp.posted("/messages")).toHaveLength(0);
  agp.files.set(url, data);
  await page.locator(".history-error").getByRole("button", { name: "Retry" }).click();
  await shown(page, saved[3].revision);
  await expect(page.locator(".preview-note")).toContainText("Preview · V4");
});

test("a fork whose setup failed before delivering files still shows its durable starting model after reload", async ({
  page,
}) => {
  const { agp, saved } = await history(page);
  await page.locator(".history-tools").getByRole("button", { name: "Fork", exact: true }).click();
  await page.getByPlaceholder("Describe how to change it…").fill("Add ears");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/build=new-build$/);
  const session = agp.sessions.get("new-build")!;
  session.events = [];
  session.status = "failed";
  await page.reload();
  await shown(page, saved[5].revision);
  await expect(page.locator("header .title")).toHaveText("Panther · Fork");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("button", { name: "V1 · Latest", exact: true })).toBeVisible();
});

test("identical shares keep their number, assembly changes get a version, and a saved preview stays visible offline", async ({
  page,
}) => {
  const { agp, saved } = await history(page);
  agp.share("panther", saved[5]);
  const assembled = { ...saved[5], steps: saved[5].steps.map((s) => ({ ...s, title: `Revised ${s.title}` })) };
  agp.share("panther", assembled);
  await expect(page.getByRole("button", { name: "V7 · Latest", exact: true })).toBeVisible();
  await expect(page.locator(".history-versions button")).toHaveCount(7);
  await page.getByRole("button", { name: "V4", exact: true }).click();
  agp.offline = true;
  await shown(page, saved[3].revision);
  await page.locator(".preview-note").getByRole("button", { name: "Latest", exact: true }).click();
  await expect(page.locator(".viewer").getByRole("alert")).toContainText("Connection lost");
  await page.getByRole("button", { name: "V4", exact: true }).click();
  await shown(page, saved[3].revision);
  await expect(page.locator(".viewer-canvas")).toBeVisible();
});

test("an unconfirmed fork can only check for acceptance, without posting again or losing the selected model", async ({
  page,
}) => {
  const { agp, saved } = await history(page);
  agp.refuse = [503];
  await page.locator(".history-tools").getByRole("button", { name: "Fork", exact: true }).click();
  await page.getByPlaceholder("Describe how to change it…").fill("Add ears");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".chat").getByRole("alert")).toContainText("Start unconfirmed");
  await expect(page.getByRole("textbox")).toBeDisabled();
  await page.route("**/api/v2/sessions?**", (route) =>
    new URL(route.request().url()).searchParams.has("group_id") ? route.abort("failed") : route.fallback(),
  );
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(page.locator(".chat").getByRole("alert")).toContainText("Start unconfirmed");
  await expect(page.getByRole("textbox")).toBeDisabled();
  expect(agp.posted("/api/v2/sessions")).toHaveLength(1);
  await shown(page, saved[5].revision);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await shown(page, saved[5].revision);
});

test("cancelling a fork preserves the original chat draft and selected version, including on mobile", async ({
  page,
}) => {
  const { agp, saved } = await history(page);
  await page.getByRole("textbox").fill("Keep this original draft");
  await page.getByRole("button", { name: "V4", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".history-tools").getByRole("button", { name: "Fork", exact: true }).click();
  await expect(page.getByRole("textbox")).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveValue("");
  await page.getByRole("textbox").fill("Different fork draft");
  await shown(page, saved[3].revision);
  await page.screenshot({ path: "test-results/fork-mobile.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await shown(page, saved[3].revision);
  await page.locator(".preview-note").getByRole("button", { name: "Latest", exact: true }).click();
  await expect(page.getByRole("textbox")).toHaveValue("Keep this original draft");
  expect(agp.posted("/api/v2/sessions")).toHaveLength(0);
  expect(agp.posted("/messages")).toHaveLength(0);
});
