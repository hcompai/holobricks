import { buildRevision } from "../src/buildRevision";
import { expect, test, type Page } from "@playwright/test";
import { fixture, site } from "./fixtures";
import { platform } from "./platform";

async function open(page: Page) {
  await site(page);
  const agp = await platform(page);
  agp.session("visual");
  agp.say("visual", "A tower");
  agp.share("visual", fixture());
  agp.hold = true;
  await page.goto("/?build=visual");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", fixture().revision);
  await page.getByRole("button", { name: "Annotate", exact: true }).click();
  await expect(page.getByRole("img", { name: "Frozen model view" })).toBeVisible();
  return agp;
}

async function mark(page: Page) {
  const surface = page.getByLabel("Draw directions on the model");
  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.up();
}

const context = (message: any) => {
  const file = message.files.find((f: any) => /^annotation-.*\.json$/.test(f.name));
  expect(file).toBeTruthy();
  return JSON.parse(Buffer.from(file.source, "base64").toString());
};

test("Draw and Erase direct a running session without editing or restarting its model", async ({ page }, testInfo) => {
  const agp = await open(page);
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeDisabled();
  await mark(page);
  await page.getByRole("button", { name: "Erase", exact: true }).click();
  await expect(page.getByText("Mark what to remove", { exact: true })).toBeVisible();
  await mark(page);
  await expect(page.getByLabel("Draw directions on the model").locator("path")).toHaveCount(2);
  await page.getByRole("button", { name: "Undo mark", exact: true }).click();
  await expect(page.getByLabel("Draw directions on the model").locator("path")).toHaveCount(1);
  await mark(page);
  await page.screenshot({ path: testInfo.outputPath("visual-directions.png") });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Annotate model" })).toHaveCount(0);
  const composer = page.getByPlaceholder("Ask for a change");
  await expect(composer).toBeFocused();
  await expect(page.locator(".composer img")).toHaveCount(1);
  await composer.fill("Higher here; remove the red area");
  await composer.press("Enter");
  await expect.poll(() => agp.posted("/messages").length).toBe(1);
  const sent = agp.posted("/messages")[0];
  expect(sent.message).toBe("Higher here; remove the red area");
  expect(sent.images).toHaveLength(1);
  expect(sent.images[0]).toMatch(/^data:image\/png;base64,/);
  const notes = context(sent);
  expect(notes).toMatchObject({ build: "visual", revision: fixture().revision });
  expect(notes.tools).toEqual(["draw", "erase"]);
  expect(JSON.stringify(notes).length).toBeLessThan(2048);
  expect(notes.instructions).toContain("not hidden objects");
  expect(agp.posted("/api/v2/sessions")).toHaveLength(0);
  expect(agp.posted("/force_answer")).toHaveLength(0);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", fixture().revision);
});

test("annotation zoom stays local and exported marks keep their original coordinates", async ({ page }, testInfo) => {
  const agp = await open(page);
  const layout = await page.evaluate(() => ({ width: innerWidth, scale: visualViewport!.scale }));
  const canvas = await page.locator(".viewer canvas").first().boundingBox();
  const surface = page.getByLabel("Draw directions on the model");
  const frame = page.locator(".annotation-frame");
  const box = (await frame.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -70);
  await page.keyboard.up("Control");
  await expect(page.getByRole("button", { name: "Zoom out", exact: true })).toBeEnabled();
  await expect
    .poll(() => page.locator(".annotation-content").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a))
    .toBeGreaterThan(1);
  expect(await page.evaluate(() => ({ width: innerWidth, scale: visualViewport!.scale }))).toEqual(layout);
  expect(await frame.boundingBox()).toEqual(box);
  // Ordinary trackpad scrolling pans the enlarged snapshot rather than scrolling the page.
  await page.mouse.wheel(35, 20);
  await expect
    .poll(() => page.locator(".annotation-content").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).e))
    .toBeLessThan(0);
  const points = await surface.evaluate((element) => {
    const svg = element as SVGSVGElement;
    const { width, height } = svg.viewBox.baseVal;
    return [0.5, 0.55].map((fraction) => {
      const p = new DOMPoint(width * fraction, height / 2).matrixTransform(svg.getScreenCTM()!);
      return { x: p.x, y: p.y };
    });
  });
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 5 });
  await page.mouse.up();
  await page.screenshot({ path: testInfo.outputPath("annotation-zoomed.png") });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByPlaceholder("Ask for a change").fill("Change this detail");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => agp.posted("/messages").length).toBe(1);
  const sent = agp.posted("/messages")[0];
  const notes = context(sent);
  const pixel = await page.evaluate(async (image) => {
    const bitmap = await createImageBitmap(await (await fetch(image)).blob());
    const output = document.createElement("canvas");
    output.width = bitmap.width;
    output.height = bitmap.height;
    const ctx = output.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    // The mark was made at 50–55% of the original image, despite zoom and pan.
    return Array.from(
      ctx.getImageData(Math.round(bitmap.width * 0.525), Math.round((bitmap.height - 44) / 2), 1, 1).data,
    );
  }, sent.images[0]);
  expect(pixel).toEqual([22, 139, 255, 255]);
  expect(sent.message).toBe("Change this detail");
  expect(notes.revision).toBe(fixture().revision);
  expect(await page.locator(".viewer canvas").first().boundingBox()).toEqual(canvas);
  expect(await page.evaluate(() => ({ width: innerWidth, scale: visualViewport!.scale }))).toEqual(layout);
  await page.getByRole("button", { name: "Annotate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Zoom out", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Fit annotation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Zoom out", exact: true })).toBeDisabled();
  await page.getByRole("dialog", { name: "Annotate model" }).focus();
  await page.keyboard.press("Control+=");
  await expect(page.getByRole("button", { name: "Zoom out", exact: true })).toBeEnabled();
  await page.keyboard.press("Control+0");
  await expect(page.getByRole("button", { name: "Zoom out", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", { key: "+", ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
});

test("Cancel and removal leave no hidden annotation instruction in the next message", async ({ page }) => {
  const agp = await open(page);
  await mark(page);
  await page.getByRole("button", { name: "Clear marks" }).click();
  await expect(page.getByLabel("Draw directions on the model").locator("path")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.locator(".composer img")).toHaveCount(0);
  await page.getByRole("button", { name: "Annotate", exact: true }).click();
  await mark(page);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Remove image" }).click();
  await page.getByPlaceholder("Ask for a change").fill("Just change the roof");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => agp.posted("/messages").length).toBe(1);
  expect(agp.posted("/messages")[0].files).toHaveLength(0);
  expect(agp.posted("/messages")[0].images).toHaveLength(0);
});

test("a refused send keeps the marked image and comment for retry", async ({ page }) => {
  const agp = await open(page);
  await mark(page);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const composer = page.getByPlaceholder("Ask for a change");
  await composer.fill("Change this roof");
  let refused: any;
  await page.route("**/api/v2/sessions/visual/messages", async (route) => {
    refused = route.request().postDataJSON();
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Try again" }),
    });
  });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(composer).toHaveValue("Change this roof");
  await expect(page.locator(".composer img")).toHaveCount(1);
  await page.unroute("**/api/v2/sessions/visual/messages");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => agp.posted("/messages").length).toBe(1);
  expect(context(agp.posted("/messages")[0])).toEqual(context(refused));
});

test("touch marks stay on the captured revision if the live model advances", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const agp = await open(page);
  const frozen = await page.getByRole("img", { name: "Frozen model view" }).getAttribute("src");
  // The snapshot is independent from updates to the live model under it.
  const next = fixture();
  next.pieces = next.pieces.slice(0, 1);
  next.revision = await buildRevision(next.pieces);
  agp.share("visual", next);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", next.revision);
  await expect(page.getByRole("img", { name: "Frozen model view" })).toHaveAttribute("src", frozen!);
  const surface = page.getByLabel("Draw directions on the model");
  const box = (await surface.boundingBox())!;
  const event = {
    pointerId: 9,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
  };
  // Dispatching synthetic touch pointers does not create browser capture; stub capture just for this dispatch.
  await surface.evaluate((el) => {
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};
  });
  await surface.dispatchEvent("pointerdown", event);
  await surface.dispatchEvent("pointermove", { ...event, clientX: event.clientX + 20 });
  await surface.dispatchEvent("pointerup", { ...event, buttons: 0 });
  await expect(page.getByLabel("Draw directions on the model").locator("path")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("visual-directions-phone.png") });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => agp.posted("/messages").length).toBe(1);
  expect(agp.posted("/messages")[0].message).toBe("Apply my marks.");
  expect(context(agp.posted("/messages")[0]).revision).toBe(fixture().revision);
});

test("attachment capacity keeps unfinished marks available", async ({ page }) => {
  const agp = await open(page);
  for (let i = 0; i < 2; i++) {
    await mark(page);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Annotate", exact: true }).click();
  }
  await mark(page);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Annotate model" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Remove an attachment first");
  await page.getByRole("button", { name: "Remove image" }).first().click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Annotate model" })).toHaveCount(0);
  await expect(page.locator(".composer img")).toHaveCount(2);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => agp.posted("/messages").length).toBe(1);
  expect(agp.posted("/messages")[0].files.filter((f: any) => /^annotation-/.test(f.name))).toHaveLength(2);
});

test("public previews require a copy before directing Holo", async ({ page }) => {
  await site(page, [fixture()]);
  await page.goto(`/?showcase=${fixture().id}`);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", fixture().revision);
  await expect(page.getByRole("button", { name: "Annotate", exact: true })).toHaveCount(0);
});
