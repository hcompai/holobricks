import { expect, test } from "@playwright/test";
import { fixture, site } from "./fixtures";
import { platform } from "./platform";

test("the close guard follows running builds through the library and stops when they finish", async ({ page }) => {
  await site(page, [{ ...fixture(), id: "paris", name: "Paris" }]);
  const agp = await platform(page);
  agp.session("live");
  agp.say("live", "Build a tower");
  agp.share("live", fixture());
  await page.addInitScript(() => {
    const w = window as unknown as { locks: { released: boolean }[] };
    w.locks = [];
    Object.defineProperty(navigator, "wakeLock", {
      value: {
        request: async () => {
          const lock = { released: false, release: async () => void (lock.released = true) };
          w.locks.push(lock);
          return lock;
        },
      },
    });
  });
  const awake = () =>
    page.evaluate(
      () => (window as unknown as { locks: { released: boolean }[] }).locks.filter((l) => !l.released).length,
    );
  await page.goto("/?build=live");
  const protectedTab = () =>
    page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  await expect.poll(protectedTab).toBe(true);
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("region", { name: "Public" }).locator(".tile").click();
  await expect(page).toHaveURL(/paris/);
  expect(await protectedTab()).toBe(true);
  expect(await awake()).toBe(1);
  agp.look("live", "away");
  await expect.poll(() => agp.posted("/tool_results").length).toBe(1);
  agp.answer("live", "Finished.");
  await expect.poll(protectedTab).toBe(false);
  expect(await awake()).toBe(0);
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
  await expect
    .poll(() =>
      page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
});
