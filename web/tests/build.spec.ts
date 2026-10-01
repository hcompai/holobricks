import { expect, test, type Locator, type Page } from "@playwright/test";
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
  const planning = page.locator(".thinking");
  await expect(planning).toBeVisible();
  const walk = page.getByRole("button", { name: "Walk", exact: true });
  await expect(page.locator(".timeline")).toHaveCount(0);
  await expect(walk).toHaveCount(0);

  const model = fixture();
  agp.state("live", "running");
  agp.share("live", model);
  agp.look("live", "side", { angle: 90 });
  await shown(page, model.revision);
  await expect(planning).toHaveCount(0);
  await expect(page.locator(".timeline")).toBeVisible();
  await expect(walk).toBeVisible();
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

test("a message sent while Holo builds reaches it without stopping, and shows as sent until Holo reads it", async ({
  page,
}) => {
  await site(page);
  const agp = await platform(page);
  agp.session("live");
  agp.say("live", "A tower");
  await page.goto("/?build=live");
  const composer = page.getByPlaceholder("Ask for a change");
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(stop).toBeVisible();

  agp.hold = true;
  await composer.fill("Make it taller");
  await expect(stop).toHaveCount(0);
  await send.click();
  await expect(composer).toHaveValue("");
  await expect(stop).toBeVisible();
  const sent = page.locator(".msg.user.queued");
  await expect(sent).toHaveText("Make it taller");
  expect(agp.posted("/messages")).toMatchObject([{ message: "Make it taller" }]);
  expect(agp.posted("/force_answer")).toHaveLength(0);
  await expect(page.locator(".msg.live")).toBeVisible();

  agp.say("live", "Make it taller");
  await expect(sent).toHaveCount(0);
  await expect(page.locator(".msg.user")).toHaveText(["A tower", "Make it taller"]);
  await expect(page.locator(".msg.live")).toContainText("Reading your message");
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
  await expect(live).toContainText("Placing bricks");

  agp.result("work", run);
  await expect(live).toContainText("Placing bricks");

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
  await page.getByRole("button", { name: "HoloBricks", exact: true }).click();
  await page.getByRole("region", { name: "Public builds" }).locator(".tile").click();
  await shown(page, showcase.revision);

  agp.look("live", "away", { angle: 180 });
  await expect.poll(() => agp.posted("/tool_results")).toHaveLength(1);
  const [caption, image] = agp.posted("/tool_results")[0].result;
  expect(caption).toMatch(`Revision ${model.revision.slice(0, 8)}`);
  expect(image).toMatch(/^data:image\/jpeg;base64,/);
});

test("a build running in the background outlives a failed first poll: Holo still gets its render", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  const model = fixture();
  agp.session("away");
  agp.share("away", model);
  agp.look("away", "while-away");
  agp.offline = true;
  await page.goto("/");
  await expect.poll(() => agp.requests.some((r) => r.path.endsWith("/away/changes"))).toBe(true);
  agp.offline = false;
  await expect.poll(() => agp.posted("/tool_results")).toHaveLength(1);
  expect(agp.posted("/tool_results")[0].result[0]).toMatch(`Revision ${model.revision.slice(0, 8)}`);
});

test("a model that fails to load leaves the chat readable, and Holo hears why", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("live");
  agp.say("live", "A tower");
  agp.share("live", fixture());
  agp.files.clear();
  agp.look("live", "lost");
  await page.goto("/?build=live");
  await expect(page.locator(".msg.user")).toHaveText("A tower");
  await expect(page.getByRole("alert")).toContainText("Couldn't load the latest model.");
  await expect.poll(() => agp.posted("/tool_results")).toHaveLength(1);
  expect(agp.posted("/tool_results")[0]).toMatchObject({
    kind: "error_event",
    tool_req: { id: "lost" },
    error: expect.stringContaining("could not be loaded"),
  });
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
  const composer = page.getByPlaceholder("A red lighthouse on a rock… or drop a photo");
  const prompt = "Construis la Citadelle de Port-Louis à Lorient";
  await composer.fill(prompt);
  await page.getByLabel("Photos to attach").setInputFiles(PHOTO);
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
  const [first] = session.messages;
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

  await page.getByPlaceholder("Ask for a change").fill("Add the lighthouse");
  await send.click();
  await expect.poll(() => agp.posted("/messages")).toHaveLength(1);
  expect(agp.posted("/messages")[0]).toMatchObject({ message: "Add the lighthouse", files: [] });
});

test("Send shows the request and a starting build at once, before the platform answers", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  let answer = () => {};
  const answered = new Promise<void>((resolve) => (answer = resolve));
  await page.route("https://agp.eu.hcompany.ai/api/v2/sessions", async (route) => {
    if (route.request().method() === "POST") await answered;
    await route.fallback();
  });
  await page.goto("/");
  await page.getByRole("textbox").fill("A red lighthouse");
  await page.getByRole("textbox").press("Enter");
  await expect(page.locator(".msg.user")).toHaveText("A red lighthouse");
  await expect(page.getByRole("textbox")).toHaveValue("");
  await expect(page.locator(".aside-title")).toHaveText("New build");
  expect(agp.posted("/api/v2/sessions")).toHaveLength(0);

  answer();
  await expect(page).toHaveURL(/\?build=new-build$/);
  await expect(page.locator(".msg.user")).toHaveText("A red lighthouse");
});

test("a suggestion starts its build in one click: Holo gets the full prompt, the user sees its label", async ({
  page,
}) => {
  await site(page);
  const agp = await platform(page);
  await page.goto("/");
  await page.getByRole("button", { name: "A red-and-white lighthouse" }).click();
  await expect(page).toHaveURL(/\?build=new-build$/);
  const [first] = agp.posted("/api/v2/sessions")[0].messages;
  expect(first.message).toMatch(/^A tall red-and-white striped lighthouse on a rocky headland\./);
  await expect(page.locator(".msg.user")).toHaveText("A red-and-white lighthouse");
  await expect(page.locator(".aside-title")).toHaveText("A red-and-white lighthouse");
});

test("a change to my ended build continues it as a copy under the same name", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  const model = fixture();
  agp.session("ended");
  agp.say("ended", "A tower");
  agp.share("ended", model);
  agp.answer("ended", "Built.");
  agp.sessions.get("ended")!.status = "completed";
  await page.goto("/?build=ended");
  await shown(page, model.revision);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("menuitem", { name: "Publish to the library…" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByPlaceholder("Ask for a change").fill("Make it blue");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\?build=new-build$/);
  await expect(page.locator(".aside-title")).toHaveText(model.name);
  const [first] = agp.posted("/api/v2/sessions")[0].messages;
  expect(first.message).toBe("Make it blue");
  expect(first.files.map((f: { name: string }) => f.name)).toEqual(["brickyard.tgz", "remix.py"]);
  expect(agp.posted("/messages")).toHaveLength(0);
});

test("home shows my builds by the names Holo gave them; showcases under Public builds", async ({ page }) => {
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
  const mine = page.getByRole("region", { name: "Your builds" }).locator(".tile");
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText("Hollowbough");
  await expect(mine).toContainText("42 pieces");
  const everyone = page.getByRole("region", { name: "Public builds" }).locator(".tile");
  await expect(everyone).toHaveCount(1);
  await expect(everyone).toContainText("Showcase");
  await everyone.click();
  await expect(page).toHaveURL(/\?showcase=paris$/);
  await shown(page, showcase.revision);
  await expect(page.getByText("A showcase from the gallery: remix it to make your own.")).toBeVisible();
});

/** A tile's transparent pixels and red ones. */
const tilePixels = (tile: Locator) =>
  tile.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const canvas = Object.assign(document.createElement("canvas"), {
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let clear = 0;
    let red = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) clear++;
      else if (data[i] > 140 && data[i + 1] < 90 && data[i + 2] < 90) red++;
    }
    return { clear, red };
  });

test("a build's library tile shows its latest revision on a transparent background, even when it finished off screen", async ({
  page,
}) => {
  const showcase = { ...fixture(), id: "paris", name: "Paris" };
  await site(page, [showcase]);
  const agp = await platform(page);
  const model = fixture();
  agp.session("live");
  agp.share("live", model);
  agp.answer("live", "A tower.");
  await page.goto("/?build=live");
  await shown(page, model.revision);
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("brickyard.library") ?? "{}").live?.revision))
    .toBe(model.revision);
  await page.getByRole("button", { name: "HoloBricks", exact: true }).click();
  const tile = page.getByRole("region", { name: "Your builds" }).locator("img.tile-thumb");
  await expect(tile).toHaveAttribute("src", /^data:image\/webp;base64,/);
  const first = await tile.getAttribute("src");
  const before = await tilePixels(tile);
  expect(before.clear).toBeGreaterThan(0);
  expect(before.red).toBeGreaterThan(0);

  agp.state("live", "running");
  await page.goBack();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "HoloBricks", exact: true }).click();
  await expect(page.getByRole("region", { name: "Your builds" }).locator(".tile")).toContainText("building…");
  await page.getByRole("region", { name: "Public builds" }).locator(".tile").click();
  await expect(page).toHaveURL(/\?showcase=paris$/);
  agp.share("live", revised({ ...model, pieces: model.pieces.map((p) => ({ ...p, color: 1 })) }));
  agp.answer("live", "A blue tower.");
  await page.getByRole("button", { name: "HoloBricks", exact: true }).click();
  await expect(tile).not.toHaveAttribute("src", first!);
  const after = await tilePixels(tile);
  expect(after.clear).toBeGreaterThan(0);
  expect(after.red).toBe(0);
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
