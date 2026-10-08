import { expect, test } from "@playwright/test";
import { fixture, site } from "./fixtures";
import { platform } from "./platform";

const NOW = new Date("2026-01-01T00:02:00Z");

test("an unknown phase start does not show a clock counting from 1970", async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.clock.setFixedTime(NOW);
  await site(page);
  const agp = await platform(page);
  agp.session("timer");
  agp.share("timer", fixture());
  await page.goto("/?build=timer");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", fixture().revision);
  await expect(page.locator(".live-head")).toContainText("Reading your idea");
  await page.clock.runFor(10000);
  await expect(page.locator(".live-clock")).toHaveCount(0);
});

test("a valid phase start shows a human-readable duration", async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.clock.setFixedTime(NOW);
  await site(page);
  const agp = await platform(page);
  agp.now = NOW.getTime() - 74000;
  agp.session("timer");
  agp.say("timer", "A tower");
  agp.share("timer", fixture());
  await page.goto("/?build=timer");
  await expect(page.locator(".live-clock")).toHaveText("1m 14s");
});

test("home offers the correct public GitHub repository without leaving the app", async ({ page }, testInfo) => {
  await site(page);
  await page.goto("/");
  const star = page.getByRole("link", { name: "Star on GitHub", exact: true });
  await expect(star).toHaveAttribute("href", "https://github.com/hcompai/holobricks");
  await expect(star).toHaveAttribute("target", "_blank");
  await expect(star).toHaveAttribute("rel", "noopener noreferrer");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(star).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("github-star-phone.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
