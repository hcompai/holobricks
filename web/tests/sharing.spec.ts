import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fixture, site } from "./fixtures";

test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

test("image sharing prepares a PNG, handles cancellation and retains a download fallback", async ({ page }, info) => {
  await page.addInitScript(() => {
    (window as any).shared = [];
    (window as any).shareFailure = "";
    Object.defineProperty(navigator, "canShare", { value: () => true });
    Object.defineProperty(navigator, "share", {
      value: async (data: ShareData) => {
        if ((window as any).shareFailure) throw new DOMException("Test", (window as any).shareFailure);
        (window as any).shared.push({
          name: data.files![0].name,
          type: data.files![0].type,
          size: data.files![0].size,
        });
      },
    });
  });
  const model = fixture();
  await site(page, [model]);
  await page.goto(`/?showcase=${model.id}`);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model.revision);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("menuitem").first()).toHaveText("GIF");
  await expect(page.getByRole("menuitem", { name: "Instructions (PDF)…", exact: true })).toBeEnabled();
  await page.getByRole("menuitem", { name: "Image", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share image", exact: true });
  await expect(dialog.getByRole("img", { name: model.name, exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Share…", exact: true }).click();
  expect(await page.evaluate(() => (window as any).shared[0])).toMatchObject({
    type: "image/png",
    name: `${model.name}.png`,
  });
  await page.evaluate(() => {
    (window as any).shareFailure = "AbortError";
  });
  await dialog.getByRole("button", { name: "Share…", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).shareFailure = "NotAllowedError";
  });
  await dialog.getByRole("button", { name: "Share…", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Save the image instead");
  const download = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Save image", exact: true }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe(`${model.name}.png`);
  expect((await readFile(await saved.path())).subarray(1, 4).toString()).toBe("PNG");
  await page.screenshot({ path: info.outputPath("mobile-share.png") });
});

test("phone GIF uses a square frame and the native sheet with a save fallback", async ({ page }, info) => {
  // Software WebGL renders the real 160-frame GIF, as in film.spec.ts.
  test.setTimeout(600000);
  await page.addInitScript(() => {
    (window as any).gifShare = null;
    Object.defineProperty(navigator, "canShare", { value: () => true });
    Object.defineProperty(navigator, "share", {
      value: async (data: ShareData) => {
        if ((window as any).shareFailure) throw new DOMException("Test", (window as any).shareFailure);
        (window as any).gifShare = { type: data.files![0].type, size: data.files![0].size };
      },
    });
  });
  const model = fixture();
  await site(page, [model]);
  await page.goto(`/?showcase=${model.id}`);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model.revision);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("menuitem", { name: "GIF", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share a GIF", exact: true });
  await dialog.getByText("Options", { exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Format", exact: true })).toHaveValue("1:1");
  await dialog.getByText("Options", { exact: true }).click();
  const share = dialog.getByRole("button", { name: "Share…", exact: true });
  await expect(share).toBeVisible({ timeout: 540000 });
  await expect(dialog.getByRole("button", { name: "Post on X", exact: true })).toHaveClass("primary");
  await expect(share).not.toHaveClass("primary");
  await share.click();
  expect(await page.evaluate(() => (window as any).gifShare)).toMatchObject({
    type: "image/gif",
    size: expect.any(Number),
  });
  await page.evaluate(() => {
    (window as any).shareFailure = "AbortError";
  });
  await share.click();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).shareFailure = "NotAllowedError";
  });
  await share.click();
  await expect(dialog.getByRole("status")).toContainText("Download the GIF");
  const download = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Download GIF", exact: true }).click();
  const bytes = await readFile(await (await download).path());
  expect(bytes.subarray(0, 6).toString()).toBe("GIF89a");
  expect(bytes.readUInt16LE(6)).toBe(640);
  expect(bytes.readUInt16LE(8)).toBe(640);
  await page.screenshot({ path: info.outputPath("mobile-gif.png") });
});

for (const support of ["no-files", "no-share"] as const) {
  test(`image sharing falls back to saving when the browser has ${support}`, async ({ page }) => {
    await page.addInitScript((support) => {
      Object.defineProperty(navigator, "canShare", { value: () => support !== "no-files" });
      Object.defineProperty(navigator, "share", { value: support === "no-share" ? undefined : async () => {} });
    }, support);
    const model = fixture();
    await site(page, [model]);
    await page.goto(`/?showcase=${model.id}`);
    await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model.revision);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByRole("menuitem", { name: "Image", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Share image", exact: true });
    await expect(dialog.getByRole("link", { name: "Save image", exact: true })).toHaveClass(/primary/);
    await expect(dialog.getByRole("button", { name: "Share…", exact: true })).toHaveCount(0);
  });
}
