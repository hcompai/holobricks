import { expect, test, type Page } from "@playwright/test";
import { fixture, revised, site } from "./fixtures";
import { platform } from "./platform";

const PHOTO = {
  name: "reference.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64",
  ),
};

const shown = (page: Page, revision: string) =>
  expect(page.locator(".viewer")).toHaveAttribute("data-revision", revision);

test("a live build shows each shared model and answers `look` with a render of that revision", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("live");
  agp.say("live", "A tower of **bricks**");
  agp.step("live", "The spire is **too thin**:\n\n- widen it\n- add `3942c` cones");
  agp.look("live", "early");
  await page.goto("/?build=live");

  await expect.poll(() => agp.posted("/tool_results")).toHaveLength(1);
  expect(agp.posted("/tool_results")[0]).toMatchObject({
    kind: "error_event",
    tool_req: { id: "early" },
    error: expect.stringContaining("Nothing is shared yet"),
  });
  const holo = page.locator(".msg.assistant").first();
  await expect(holo.locator("strong")).toHaveText("too thin");
  await expect(holo.locator("li")).toHaveCount(2);
  await expect(page.locator(".msg.user")).toHaveText("A tower of **bricks**");

  const model = fixture();
  agp.state("live", "running");
  agp.share("live", model);
  agp.look("live", "side", { angle: 90 });
  await shown(page, model.revision);
  await expect.poll(() => agp.posted("/tool_results")).toHaveLength(2);
  const [caption, image] = agp.posted("/tool_results")[1].result;
  expect(caption).toMatch(new RegExp(`^Revision ${model.revision.slice(0, 8)}, 8 pieces\\. The view from 90 degrees`));
  expect(image).toMatch(/^data:image\/png;base64,/);

  const recolored = revised({ ...model, pieces: model.pieces.map((p) => ({ ...p, color: 1 })) });
  agp.state("live", "running");
  agp.share("live", recolored);
  agp.look("live", "again");
  await shown(page, recolored.revision);
  await expect.poll(() => agp.posted("/tool_results")).toHaveLength(3);
  expect(agp.posted("/tool_results")[2].result[0]).toMatch(`Revision ${recolored.revision.slice(0, 8)}`);
});

test("a lost connection hides the model until the platform answers again", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  const model = fixture();
  agp.session("live");
  agp.share("live", model);
  await page.goto("/?build=live");
  await shown(page, model.revision);
  agp.offline = true;
  await expect(page.getByRole("alert")).toContainText("latest model cannot be confirmed");
  await expect(page.locator(".viewer-canvas")).toHaveCSS("visibility", "hidden");
  agp.offline = false;
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".viewer-canvas")).toHaveCSS("visibility", "visible");
});

test("a new build sends the toolkit and the photos; Stop makes Holo answer and the build takes follow-ups", async ({
  page,
}) => {
  await site(page);
  const agp = await platform(page);
  agp.refuse = [503];
  await page.goto("/");
  const composer = page.getByPlaceholder("Describe what to build…");
  const prompt = "Construis la Citadelle de Port-Louis à Lorient";
  await composer.fill(prompt);
  await page.locator('input[type="file"]').setInputFiles(PHOTO);
  const send = page.getByRole("button", { name: "Send", exact: true });
  await send.click();
  await expect(page.getByText("The platform is unavailable.")).toBeVisible();
  await expect(composer).toHaveValue(prompt);
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();

  await send.click();
  await expect(page).toHaveURL(/\?build=new-build$/);
  const [session] = agp.posted("/api/v2/sessions");
  expect(session.agent).toMatchObject({ name: "brickyard", environments: [{ kind: "workstation", id: "brickyard" }] });
  expect(session.agent.tools.map((t: { name: string }) => t.name)).toEqual(["look"]);
  const [first] = agp.posted("/messages");
  expect(first.message).toBe(prompt);
  expect(first.images).toEqual([expect.stringMatching(/^data:image\/jpeg;base64,/)]);
  expect(first.files.map((f: { name: string }) => f.name)).toEqual(["brickyard.tgz", "photo-1.jpg"]);
  await expect(page.locator(".msg.user")).toHaveText(prompt);

  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await stop.click();
  await expect(stop).toBeDisabled();
  await expect.poll(() => agp.posted("/force_answer")).toHaveLength(1);
  agp.answer("new-build", "Stopped here: the citadel's walls are up.");
  await expect(page.locator(".msg.assistant").last()).toHaveText("Stopped here: the citadel's walls are up.");

  await page.getByPlaceholder("Describe how to change it…").fill("Add the lighthouse");
  await send.click();
  await expect.poll(() => agp.posted("/messages")).toHaveLength(2);
  expect(agp.posted("/messages")[1]).toMatchObject({ message: "Add the lighthouse", files: [] });
});

test("the library lists my builds by the names Holo gave them, then the showcases", async ({ page }) => {
  const showcase = { ...fixture(), id: "paris", name: "Paris" };
  await site(page, [showcase]);
  const agp = await platform(page);
  agp.session("mine", "idle");
  await page.addInitScript(() =>
    localStorage.setItem(
      "brickyard.library",
      JSON.stringify({ mine: { name: "Hollowbough", prompt: "A treehouse", pieces: 42 } }),
    ),
  );
  await page.goto("/");
  await page.getByRole("tab", { name: "Library" }).click();
  const cards = page.locator(".library button");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Hollowbough");
  await expect(cards.nth(0)).toContainText("42 pieces");
  await expect(cards.nth(1)).toContainText("Showcase");
  await cards.nth(1).click();
  await expect(page).toHaveURL(/\?showcase=paris$/);
  await shown(page, showcase.revision);
  await expect(page.getByText("A showcase from the gallery.")).toBeVisible();
});

test("missing geometry fails closed; a lost WebGL context never leaves a trusted stale canvas", async ({ page }) => {
  const broken = { ...fixture(), id: "broken", parts: {} };
  const whole = fixture();
  await site(page, [broken, whole]);
  await page.goto("/?showcase=broken");
  await expect(page.getByRole("alert")).toContainText("Invalid render asset: test-brick");
  await expect(page.locator(".viewer")).not.toHaveAttribute("data-revision");
  await expect(page.locator(".viewer-canvas")).toHaveCSS("visibility", "hidden");

  await page.goto(`/?showcase=${whole.id}`);
  await shown(page, whole.revision);
  await page.locator(".viewer-canvas canvas").evaluate((canvas: HTMLCanvasElement) => {
    canvas.getContext("webgl2")!.getExtension("WEBGL_lose_context")!.loseContext();
  });
  await expect(page.getByRole("alert")).toContainText("3D connection was lost");
  await expect(page.locator(".viewer-canvas")).toHaveCSS("visibility", "hidden");
  await page.getByRole("button", { name: "Reload model" }).click();
  await shown(page, whole.revision);
});
