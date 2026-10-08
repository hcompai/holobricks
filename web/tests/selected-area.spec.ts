import { expect, test } from "@playwright/test";
import { fixture, site } from "./fixtures";
import { platform } from "./platform";
import { selectedArea } from "../src/selectedArea";

test("selection context is guidance and preserves the displayed model", async () => {
  const model = fixture();
  const files = selectedArea(model, [0, 1]);
  const area = JSON.parse(await files["selected-area.json"].text());
  expect(area.pieces).toEqual(JSON.parse(JSON.stringify(model.pieces.slice(0, 2))));
  expect(area.guidance).toContain("not a strict edit boundary");
  expect(await files["selected-area-model.py"].text()).toContain("place(");
});

test("Ask Holo sends the selected area through chat, including hand edits", async ({ page }, testInfo) => {
  await site(page);
  const agp = await platform(page);
  const model = fixture();
  agp.session("selected", "idle");
  agp.say("selected", "A tower");
  agp.share("selected", model);
  await page.goto("/?build=selected");
  await expect(page.locator(".viewer")).toHaveAttribute("data-render-state", "ready");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const box = (await page.locator(".viewer-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Shift");
  await page.mouse.click(box.x + box.width / 2 - 150, box.y + box.height / 2 + 150);
  await page.keyboard.up("Shift");
  const selection = page.getByRole("dialog", { name: "Selection", exact: true });
  await expect(selection).toContainText("2 pieces");
  await page.keyboard.press("PageUp");
  await selection.getByRole("button", { name: "Ask Holo" }).click();
  const prompt = page.getByRole("textbox", { name: "Prompt for selected area" });
  await expect(prompt).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Selected area", exact: true })).toContainText("2 bricks");
  await prompt.fill("Make this taller");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("toolbar", { name: "Edit mode" })).toContainText("1 change");
  await page.screenshot({ path: testInfo.outputPath("selected-area.png") });
  await prompt.press("Enter");
  await expect.poll(() => agp.posted("/messages")).toHaveLength(1);
  const sent = agp.posted("/messages")[0];
  expect(sent.message).toBe("Make this taller");
  const files = sent.files as { name: string; source: string }[];
  const area = JSON.parse(Buffer.from(files.find((f) => f.name === "selected-area.json")!.source, "base64").toString());
  expect(area.pieces).toHaveLength(2);
  for (const p of area.pieces) expect(p.pos[1]).toBe(model.pieces.find((b) => b.id === p.id)!.pos[1] - 8);
  expect(files.some((f) => f.name === "selected-area-model.py")).toBe(true);
  await expect(page.locator(".chat")).toContainText("Make this taller");
});

test("a failed send preserves the prompt and closing it preserves selection", async ({ page }, testInfo) => {
  await site(page);
  const agp = await platform(page);
  agp.session("retry-area", "idle");
  agp.share("retry-area", fixture());
  await page.goto("/?build=retry-area");
  await expect(page.locator(".viewer")).toHaveAttribute("data-render-state", "ready");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const box = (await page.locator(".viewer-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole("button", { name: "Ask Holo" }).click();
  const prompt = page.getByRole("textbox", { name: "Prompt for selected area" });
  await prompt.fill("Make this curved");
  await page.route("**/api/v2/sessions/retry-area/messages", (route) =>
    route.fulfill({ status: 503, json: { detail: "Unavailable" }, headers: { "access-control-allow-origin": "*" } }),
  );
  await page.getByRole("button", { name: "Send to Holo" }).click();
  await expect(page.getByRole("dialog", { name: "Selected area", exact: true }).getByRole("alert")).toBeVisible();
  await expect(prompt).toHaveValue("Make this curved");
  await page.getByRole("button", { name: "Close prompt" }).click();
  await expect(page.getByRole("dialog", { name: "Selection", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ask Holo" }).click();
  await expect(prompt).toHaveValue("Make this curved");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(prompt).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("selected-area-mobile.png") });
});

test("selection prompting starts a saved fork through its existing first-message flow", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("source-area", "idle");
  agp.share("source-area", fixture());
  await page.goto("/?build=source-area");
  await expect(page.locator(".viewer")).toHaveAttribute("data-render-state", "ready");
  await page.getByRole("button", { name: "Fork", exact: true }).click();
  await expect(page).toHaveURL(/fork=fork-/);
  await expect(page.locator(".viewer")).toHaveAttribute("data-render-state", "ready");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const box = (await page.locator(".viewer-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole("button", { name: "Ask Holo" }).click();
  await page.getByRole("textbox", { name: "Prompt for selected area" }).fill("Round this corner");
  await page.getByRole("button", { name: "Send to Holo" }).click();
  await expect.poll(() => agp.posted("/api/v2/sessions")).toHaveLength(1);
  const first = agp.posted("/api/v2/sessions")[0].messages[0];
  expect(first.message).toBe("Round this corner");
  expect(first.files.map((f: { name: string }) => f.name)).toEqual(
    expect.arrayContaining(["selected-area.json", "selected-area-model.py", "remix.py"]),
  );
});
