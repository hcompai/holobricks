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

test("a live build shows the loader until its first model, each shared model, and answers `look` with a render of that revision", async ({
  page,
}) => {
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
  const planning = page.getByText("Holo is planning the build…");
  await expect(planning).toBeVisible();

  const model = fixture();
  agp.state("live", "running");
  agp.share("live", model);
  agp.look("live", "side", { angle: 90 });
  await shown(page, model.revision);
  await expect(planning).toHaveCount(0);
  await expect.poll(() => agp.posted("/tool_results")).toHaveLength(2);
  const [caption, image] = agp.posted("/tool_results")[1].result;
  expect(caption).toMatch(new RegExp(`^Revision ${model.revision.slice(0, 8)}, 8 pieces\\. The view from 90 degrees`));
  expect(image).toMatch(/^data:image\/jpeg;base64,/);

  const recolored = revised({ ...model, pieces: model.pieces.map((p) => ({ ...p, color: 1 })) });
  agp.state("live", "running");
  agp.share("live", recolored);
  agp.look("live", "again");
  await shown(page, recolored.revision);
  await expect.poll(() => agp.posted("/tool_results")).toHaveLength(3);
  expect(agp.posted("/tool_results")[2].result[0]).toMatch(`Revision ${recolored.revision.slice(0, 8)}`);
});

test("Holo's work shows as what it does now, then folds under its message; a repeated answer shows once", async ({
  page,
}) => {
  await site(page);
  const agp = await platform(page);
  const run = { tool_name: "shell", args: { command: "bricks run" }, id: "run" };
  agp.session("work");
  agp.say("work", "A tower");
  agp.now += 1000;
  agp.step("work", "", "The walls need a first course.", [run]);
  await page.goto("/?build=work");
  const live = page.locator(".msg.live");
  await expect(live).toContainText("Building the model");

  agp.result("work", run);
  await expect(live).toContainText("Thinking");

  agp.now += 95_000;
  agp.step("work", "\n\nBuilt a tower.", "It stands.");
  agp.answer("work", "Built a tower.");
  const holo = page.locator(".msg.assistant");
  await expect(holo).toHaveCount(1);
  await expect(live).toHaveCount(0);
  await expect(holo.locator("summary")).toHaveText("Worked for 1m 36s");
  await expect(holo.locator(".work-steps")).toHaveCount(0);
  await holo.locator("summary").click();
  await expect(holo.locator(".work-steps")).toContainText("The walls need a first course.");
  await expect(holo.locator(".work-action")).toHaveText(["Building the model"]);
});

test("Holo keeps getting its renders while the user browses other builds", async ({ page }) => {
  const showcase = { ...fixture(), id: "paris", name: "Paris" };
  await site(page, [showcase]);
  const agp = await platform(page);
  const model = fixture();
  agp.session("live");
  agp.share("live", model);
  await page.goto("/?build=live");
  await shown(page, model.revision);
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("region", { name: "Public" }).locator(".tile").click();
  await shown(page, showcase.revision);

  agp.look("live", "away", { angle: 180 });
  await expect.poll(() => agp.posted("/tool_results")).toHaveLength(1);
  const [caption, image] = agp.posted("/tool_results")[0].result;
  expect(caption).toMatch(`Revision ${model.revision.slice(0, 8)}`);
  expect(image).toMatch(/^data:image\/jpeg;base64,/);
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
  expect(session.agent).toMatchObject({
    name: "brickyard",
    model: "holo4-27b",
    environments: [{ kind: "workstation", id: "brickyard" }],
  });
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

test("the library shows my builds by the names Holo gave them; showcases under Public", async ({ page }) => {
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
  await page.getByRole("button", { name: "Library" }).click();
  await expect(page).toHaveURL(/\?library$/);
  const mine = page.getByRole("region", { name: "Mine" }).locator(".tile");
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText("Hollowbough");
  await expect(mine).toContainText("42 pieces");
  const everyone = page.getByRole("region", { name: "Public" }).locator(".tile");
  await expect(everyone).toHaveCount(1);
  await expect(everyone).toContainText("Showcase");
  await everyone.click();
  await expect(page).toHaveURL(/\?showcase=paris$/);
  await expect(page.locator(".library-page")).toHaveCount(0);
  await shown(page, showcase.revision);
  await expect(page.getByText("Showcase · Fork to edit")).toBeVisible();
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
