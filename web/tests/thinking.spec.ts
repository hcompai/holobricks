import { expect, test } from "@playwright/test";
import { fixture, site } from "./fixtures";
import { platform } from "./platform";
import { readFileSync } from "node:fs";

test("the thinking illustration follows real activity, then gives way to the shared model", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("thinking");
  agp.say("thinking", "A tower with a garden");
  await page.goto("/?build=thinking");

  const thinking = page.locator(".thinking");
  const status = thinking.getByRole("status");
  await expect(status).toContainText("Reading your idea");
  await expect(thinking.locator(".thinking-art-idea")).toBeVisible();
  await expect(thinking.locator(".thinking-brief")).toHaveCount(0);
  await expect(thinking).not.toContainText("Design study");
  await expect(thinking).not.toContainText("Your brief");
  await expect(page.locator(".live-clock")).toHaveCount(0);

  await thinking.getByRole("button", { name: "Pause animation", exact: true }).click();
  await expect(thinking.locator(".thinking-outline")).toHaveCSS("animation-play-state", "paused");
  await thinking.getByRole("button", { name: "Resume animation", exact: true }).click();
  await expect(thinking.locator(".thinking-outline")).toHaveCSS("animation-play-state", "running");

  const stages = [
    { tool_name: "shell", args: { command: ".brickyard/setup.sh" }, label: "Getting its bricks ready", art: "setup" },
    { tool_name: "web_search", args: { query: "garden tower" }, label: "Finding photos", art: "photos" },
    { tool_name: "shell", args: { command: 'bricks name "Garden Tower"' }, label: "Naming it", art: "naming" },
  ];
  for (const { tool_name, args, label, art } of stages) {
    agp.step("thinking", "", "", [{ tool_name, args, id: art }]);
    await expect(status).toContainText(label);
    await expect(thinking.locator(`.thinking-stage-${art}`)).toBeVisible();
  }

  await expect(thinking.locator(".thinking-card")).toHaveAttribute("data-subject", "tower");
  agp.step("thinking", "", "", [{ tool_name: "write_file", args: { path: "/workspace/build.py" }, id: "script" }]);
  await expect(thinking).toHaveCount(0);
  await expect(page.locator(".msg.live")).toContainText("Placing bricks");
  agp.step("thinking", "", "", [{ tool_name: "look", args: {}, id: "check" }]);
  await expect(thinking).toHaveCount(0);
  await expect(page.locator(".msg.live")).toContainText("Checking every side");

  agp.share("thinking", fixture());
  await expect(thinking).toHaveCount(0);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", fixture().revision);
  await expect(page.locator(".msg.live .thinking-icon")).toBeVisible();
  await expect(page.locator(".msg.live")).toContainText("Checking every side");

  agp.answer("thinking", "Built your garden tower.");
  await expect(page.locator(".msg.live")).toHaveCount(0);
  await expect(page.locator(".msg.assistant").last()).toContainText("Built your garden tower.");
});

test("thinking respects reduced motion and fits a narrower viewer", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.setViewportSize({ width: 860, height: 640 });
  await site(page);
  const agp = await platform(page);
  agp.session("quiet");
  agp.say("quiet", "A small castle");
  agp.step("quiet", "", "", [{ tool_name: "shell", args: { command: "setup.sh" }, id: "setup" }]);
  await page.goto("/?build=quiet");

  const thinking = page.locator(".thinking");
  await expect(thinking.getByRole("status")).toContainText("Getting its bricks ready");
  await expect(thinking.locator(".thinking-material").first()).toHaveCSS("animation-name", "none");
  await expect(thinking.locator(".thinking-material").first()).toHaveCSS("opacity", "1");
  await expect(thinking.getByRole("button", { name: "Pause animation", includeHidden: true })).toBeHidden();
  const card = await thinking.locator(".thinking-card").boundingBox();
  const pane = await thinking.boundingBox();
  expect(card).not.toBeNull();
  expect(pane).not.toBeNull();
  expect(card!.x).toBeGreaterThanOrEqual(pane!.x);
  expect(card!.y).toBeGreaterThanOrEqual(pane!.y);
  expect(card!.x + card!.width).toBeLessThanOrEqual(pane!.x + pane!.width);
  expect(card!.y + card!.height).toBeLessThanOrEqual(pane!.y + pane!.height);
});

test("real reference photos arrive from image tools and shared files, including while paused", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("references");
  const photo = readFileSync(new URL("../dev/references/harlech-gatehouse.jpg", import.meta.url));
  agp.say("references", "A castle with two stone towers");
  agp.step("references", "", "", [{ tool_name: "web_search", args: { query: "stone castle towers" }, id: "search" }]);
  await page.goto("/?build=references");
  const thinking = page.locator(".thinking");
  await expect(thinking.locator(".thinking-search-study")).toContainText("stone castle towers");
  await thinking.getByRole("button", { name: "Pause animation", exact: true }).click();
  const opened = { tool_name: "view_image", args: { path: "/workspace/reference-1.jpg" }, id: "photo-1" };
  agp.step("references", "The paired round towers will define the silhouette.", "", [opened]);
  agp.result("references", opened, {
    content: [{ type: "base64", source: photo.toString("base64"), media_type: "image/jpeg" }],
  });
  await expect(thinking.locator(".thinking-reference img")).toBeVisible();
  await expect(thinking.locator(".thinking-reference")).toHaveCSS("opacity", "1");
  await expect(thinking.locator(".thinking-reference-thumb")).toHaveCount(1);
  await expect(page.locator(".msg.assistant:not(.live)").last()).toContainText("paired round towers");
  await expect(thinking.locator(".thinking-search-study")).toHaveCount(0);
  await expect
    .poll(() => thinking.locator(".thinking-reference img").evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  // Reopening a file and then sharing it should update one card, not append duplicates.
  agp.result("references", opened, [{ type: "image", data: photo.toString("base64"), mimeType: "image/jpeg" }]);
  agp.attach("references", "reference-1.jpg", photo, "agent");
  const second = readFileSync(new URL("../dev/references/harlech-walls.jpg", import.meta.url));
  agp.attach("references", "reference-2.jpg", second, "agent");
  await expect(thinking.locator(".thinking-reference-thumb")).toHaveCount(2);
  await expect(thinking.locator(".thinking-reference figcaption")).toContainText("reference-2.jpg");
  await thinking.getByRole("button", { name: "View reference-1.jpg", exact: true }).click();
  await expect(thinking.locator(".thinking-reference figcaption")).toContainText("reference-1.jpg");
  expect(agp.requests.filter((request) => request.path.endsWith("/tool_results"))).toHaveLength(0);

  agp.result("references", { tool_name: "look", args: {}, id: "render" }, [
    "A model render",
    `data:image/jpeg;base64,${photo.toString("base64")}`,
  ]);
  await expect(page.locator(".msg.tool")).toContainText("A model render");
  await expect(thinking.locator(".thinking-reference-thumb")).toHaveCount(2);
  agp.step("references", "", "", [
    { tool_name: "share_files", args: { paths: ["reference-2.jpg"] }, id: "share-photo" },
  ]);
  await expect(thinking).toBeVisible();
  agp.share("references", fixture());
  await expect(thinking).toHaveCount(0);
});

test("part searches and successful naming supply concrete part and title studies", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("study");
  agp.say("study", "A red and white lighthouse");
  agp.step("study", "", "", [{ tool_name: "shell", args: { command: "setup.sh" }, id: "setup" }]);
  await page.goto("/?build=study");
  const thinking = page.locator(".thinking");
  await expect(thinking.locator(".thinking-material")).toHaveCount(6);
  const parts = { tool_name: "shell", args: { command: 'bricks parts "3001,3020"' }, id: "parts" };
  agp.step("study", "", "", [parts]);
  agp.result("study", parts, {
    stdout:
      "3001: Brick 2 x 4 | W=4 along x, D=2 along y | 3 plates tall\n3020: Plate 2 x 4 | W=4 along x, D=2 along y | 1 plate tall",
  });
  await expect(thinking.locator(".thinking-material")).toHaveCount(2);
  await thinking.getByRole("button", { name: "Plate 2 x 4", exact: true }).click();
  await expect(thinking.getByRole("button", { name: "Plate 2 x 4", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const name = { tool_name: "shell", args: { command: 'bricks name "The Last Light"' }, id: "name" };
  agp.step("study", "", "", [name]);
  await expect(thinking.locator(".thinking-name-title")).toHaveAttribute("aria-label", "A name is on its way");
  agp.result("study", name, { stdout: "Build is now called 'The Last Light'." });
  await expect(thinking.locator(".thinking-name-title")).toHaveAttribute("aria-label", "The Last Light");
});

test("public search image URLs load without platform credentials and broken photos are skipped", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("public-photos");
  agp.say("public-photos", "A castle");
  const search = { tool_name: "web_search", args: { query: "castle" }, id: "search" };
  agp.step("public-photos", "", "", [search]);
  const photo = readFileSync(new URL("../dev/references/harlech-gatehouse.jpg", import.meta.url));
  let authorization: string | undefined;
  await page.route("https://images.example.org/castle.jpg", (route) => {
    authorization = route.request().headers().authorization;
    return route.fulfill({ contentType: "image/jpeg", body: photo });
  });
  await page.route("https://images.example.org/missing.jpg", (route) => route.fulfill({ status: 404 }));
  agp.result("public-photos", search, [
    { type: "url", source: "https://images.example.org/castle.jpg" },
    { type: "url", source: "https://images.example.org/missing.jpg" },
  ]);
  await page.goto("/?build=public-photos");
  const board = page.locator(".thinking-references");
  await expect(board.locator(".thinking-reference-thumb")).toHaveCount(1);
  await expect
    .poll(() => board.locator(".thinking-reference img").evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  expect(authorization).toBeUndefined();
  await page.route("https://images.example.org/also-missing.jpg", (route) => route.fulfill({ status: 404 }));
  agp.result("public-photos", search, [{ type: "url", source: "https://images.example.org/also-missing.jpg" }]);
  await expect(page.locator(".thinking-search-study")).toBeVisible();
  await expect(board).toHaveCount(0);
});

test("thinking ends when a build fails before sharing any pieces", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("failed");
  agp.say("failed", "A lighthouse");
  await page.goto("/?build=failed");
  await expect(page.locator(".thinking")).toBeVisible();
  agp.sessions.get("failed")!.status = "failed";
  await expect(page.locator(".thinking")).toHaveCount(0);
  await expect(page.locator(".msg.live")).toHaveCount(0);
});
