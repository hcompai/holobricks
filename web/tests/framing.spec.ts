import { expect, test } from "@playwright/test";
import { fixture, revised, site } from "./fixtures";
import { platform } from "./platform";

test("a live model stays framed when Reduce Motion skips the follow camera", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await site(page);
  const agp = await platform(page);
  const model = revised({ ...fixture(), pieces: fixture().pieces.map((p) => ({ ...p, color: 1 })) });
  agp.session("framing");
  agp.say("framing", "A blue tower");
  agp.share("framing", model);

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/?build=framing");
    await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model.revision);
    await expect(page.locator(".viewer")).toHaveAttribute("data-placing", "false");
    await expect(page.getByRole("button", { name: "Follow build", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Inspect actual rendered pixels: a valid revision can still be tiny and off centre.
    const png = await page.locator(".viewer-canvas canvas").screenshot();
    const bounds = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let left = canvas.width,
        right = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 2] > pixels[i] + 40 && pixels[i + 2] > pixels[i + 1] + 20) {
          left = Math.min(left, (i / 4) % canvas.width);
          right = Math.max(right, (i / 4) % canvas.width);
        }
      }
      return { width: (right - left) / canvas.width, center: (left + right) / 2 / canvas.width };
    }, png.toString("base64"));
    expect(bounds.width).toBeGreaterThan(0.3);
    expect(bounds.center).toBeGreaterThan(0.35);
    expect(bounds.center).toBeLessThan(0.65);
  }
});
