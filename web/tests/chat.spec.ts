import { expect, test } from "@playwright/test";
import { colors, fixture, part } from "./fixtures";

test("Holo's messages render as markdown; the user's stay as typed", async ({ page }) => {
  const build = fixture();
  build.messages = [
    { role: "user", text: "a **tower**", images: [], at: 1 },
    { role: "assistant", text: "The spire is **too thin**:\n\n- widen it\n- add `3942c` cones", images: [], at: 2 },
  ];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/builds") return route.fulfill({ json: [] });
    if (path.endsWith("/state")) return route.fulfill({ json: { token: "t", build, renders: [] } });
    if (path === "/api/ldconfig") return route.fulfill({ body: colors });
    if (path.startsWith("/api/parts/")) return route.fulfill({ body: part });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/?build=export-test");
  const holo = page.locator(".msg.assistant").first();
  await expect(holo.locator("strong")).toHaveText("too thin");
  await expect(holo.locator("li")).toHaveCount(2);
  await expect(holo.locator("code")).toHaveText("3942c");
  await expect(page.locator(".msg.user")).toHaveText("a **tower**");
});
