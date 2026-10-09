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
