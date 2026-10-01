import { expect, test } from "@playwright/test";
import { fixture, site } from "./fixtures";
import { platform } from "./platform";

test("the tab notice and close guard follow running builds through the library and stop when they finish", async ({
  page,
}) => {
  await site(page, [{ ...fixture(), id: "paris", name: "Paris" }]);
  const agp = await platform(page);
  agp.session("live");
  agp.say("live", "Build a tower");
  agp.share("live", fixture());
  await page.goto("/?build=live");
  const note = page.getByRole("note", { name: "Keep HoloBricks open" });
  await expect(note).toContainText("it looks at your model through it");
  await page.getByRole("button", { name: "Library" }).click();
  await expect(note).toBeVisible();
  await page.getByRole("region", { name: "Public" }).locator(".tile").click();
  await expect(note).toBeVisible();
  const protectedTab = () =>
    page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(await protectedTab()).toBe(true);
  agp.look("live", "away");
  await expect.poll(() => agp.posted("/tool_results").length).toBe(1);
  await page.screenshot({ path: "test-results/running-tab-notice.png" });
  agp.answer("live", "Finished.");
  await expect(note).toHaveCount(0);
  expect(await protectedTab()).toBe(false);
});

test("a failed workstation shows a recovery explanation; raw diagnostics are collapsed", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  const saved = fixture();
  saved.recovery = { version: 1, revision: saved.revision, script: 'step("Tower")' };
  agp.session("failed", "failed");
  agp.sessions.get("failed")!.error = "CodeSandboxGoneError: Session example is not running (status: failed)";
  agp.say("failed", "A little tower");
  agp.share("failed", saved);
  await page.goto("/?build=failed");
  await expect(page.locator(".msg.system")).toHaveText(
    "The building service stopped unexpectedly. You can try continuing below.",
  );
  await expect(page.getByRole("button", { name: "Continue from saved version" })).toBeVisible();
  await expect(page.getByText(/CodeSandboxGoneError/)).toBeHidden();
  await page.screenshot({ path: "test-results/recovery-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = page.getByRole("region", { name: "Build recovery" });
  await expect(page.getByRole("button", { name: "Remix a copy" })).toBeVisible();
  expect((await panel.boundingBox())!.width).toBeGreaterThan(300);
  await page.screenshot({ path: "test-results/recovery-mobile.png" });
  await page.getByText("Technical details", { exact: true }).click();
  await expect(page.getByText(/CodeSandboxGoneError/)).toBeVisible();
});

test("signing out during a build requires an explicit choice", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("live");
  await page.goto("/?build=live");
  await expect(page.getByRole("note", { name: "Keep HoloBricks open" })).toBeVisible();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
});
