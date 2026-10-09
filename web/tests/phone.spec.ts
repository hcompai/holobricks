import { expect, test } from "@playwright/test";
import { fixture, site } from "./fixtures";
import { platform } from "./platform";

test.use({ viewport: { width: 390, height: 844 } });

test("on a phone the model fills the screen under a chat sheet that peeks, expands and drags back", async ({
  page,
}, testInfo) => {
  await site(page);
  const agp = await platform(page);
  const model = fixture();
  agp.session("phone", "idle");
  agp.say("phone", "A tower");
  agp.share("phone", model);
  agp.answer("phone", "The tower is ready.");
  await page.goto("/?build=phone");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model.revision);

  const sheet = page.locator("aside.sheet");
  const log = page.locator(".chat-log");
  expect((await page.locator(".viewer").boundingBox())!.height).toBeGreaterThan(844 * 0.75);
  await expect(page.getByPlaceholder("Ask for a change")).toBeInViewport();
  await expect(log).toBeHidden();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: /^Buy bricks/ })).toBeInViewport();
  await expect(page.locator(".timeline")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const spin = page.getByRole("button", { name: "Spin", exact: true });
  await expect(spin).toBeHidden();
  await page.getByRole("button", { name: "View controls" }).click();
  await expect(spin).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("phone-peek.png") });

  await page.locator(".sheet-handle").click();
  await expect(sheet).toHaveAttribute("data-detent", "half");
  await expect(log).toContainText("The tower is ready.");
  await page.getByRole("button", { name: "Parts", exact: true }).click();
  await expect(sheet.locator(".parts")).toContainText("8 pieces");
  await expect(page.locator(".viewer canvas")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("phone-parts.png") });

  const handle = (await page.locator(".sheet-handle").boundingBox())!;
  const x = handle.x + handle.width / 2;
  await page.mouse.move(x, handle.y + 10);
  await page.mouse.down();
  await page.mouse.move(x, 820, { steps: 6 });
  await page.mouse.up();
  await expect(sheet).toHaveAttribute("data-detent", "peek");
  await expect(page.getByPlaceholder("Ask for a change")).toBeInViewport();
});

test.describe("on a short touch screen", () => {
  test.use({ viewport: { width: 375, height: 500 }, hasTouch: true });

  test("every view control stays tappable", async ({ page }) => {
    await site(page);
    const agp = await platform(page);
    agp.session("short", "idle");
    agp.say("short", "A tower");
    agp.share("short", fixture());
    agp.answer("short", "The tower is ready.");
    await page.goto("/?build=short");
    await page.getByRole("button", { name: "View controls" }).tap();
    await page.getByRole("button", { name: "Edit", exact: true }).tap();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
});
