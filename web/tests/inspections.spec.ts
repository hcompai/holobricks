import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { inspected } from "../src/look";
import { fixture, revised, site } from "./fixtures";
import { platform, type Platform } from "./platform";

const close = { angle: 40, elevation: 30, box: [-1, -1, -3, 1, 1, -1] };
const other = { angle: 90, elevation: 60, box: [9, -1, -3, 11, 1, -1] };
const canvas = (page: Page) => page.locator(".viewer-canvas canvas");
const shot = async (page: Page) =>
  createHash("sha256")
    .update(await canvas(page).screenshot())
    .digest("hex");

async function settled(page: Page) {
  let previous = "";
  let current = "";
  await expect
    .poll(
      async () => {
        current = await shot(page);
        const same = current === previous;
        previous = current;
        return same;
      },
      { intervals: [400, 400, 400] },
    )
    .toBe(true);
  return current;
}

async function open(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await site(page);
  const agp = await platform(page);
  const drawing = revised({
    ...fixture(),
    steps: fixture().steps.slice(0, 2),
    pieces: fixture()
      .pieces.slice(0, 2)
      .map((p, i) => ({ ...p, color: i ? 1 : 4, step: i, pos: [i * 200, 0, 0] })),
  });
  agp.session("inspections");
  agp.say("inspections", "A tower");
  agp.share("inspections", drawing);
  await page.goto("/?build=inspections");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", drawing.revision);
  return { agp, drawing };
}

async function look(agp: Platform, id: string, args = close) {
  const before = agp.posted("/tool_results").length;
  agp.look("inspections", id, args);
  await expect.poll(() => agp.posted("/tool_results").length).toBe(before + 1);
  const result = agp.posted("/tool_results").at(-1);
  expect(result.kind).toBe("tool_result");
  agp.result("inspections", { tool_name: "look", id, args }, result.result);
  agp.state("inspections", "running");
  return result.result;
}

test("completed inspections change the main canvas; dragging retains control until Follow resumes", async ({
  page,
}, info) => {
  const { agp } = await open(page);
  const overview = await shot(page);
  await look(agp, "close");
  await expect.poll(() => shot(page)).not.toBe(overview);
  const followed = await shot(page);
  await page.screenshot({ path: info.outputPath("follow-inspection.png") });
  const follow = page.getByRole("button", { name: "Follow", exact: true });
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  const bounds = (await canvas(page).boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  const manual = await settled(page);
  expect(manual).not.toBe(followed);
  await look(agp, "other", other);
  await page.waitForTimeout(300); // The tool response and React effects settle while the user keeps control.
  expect(await shot(page)).toBe(manual);
  await follow.click();
  await expect.poll(() => shot(page)).not.toBe(manual);
  const resumed = await shot(page);
  await page.getByRole("button", { name: "Front", exact: true }).click();
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  expect(await shot(page)).not.toBe(resumed);
  await follow.click();
  await expect.poll(() => shot(page)).toBe(resumed);
  agp.answer("inspections", "Ready");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  // A finished build must show the whole model, rather than remain cropped to the last inspected region.
  await expect.poll(() => shot(page)).not.toBe(resumed);
});

test("reload recovers an inspection, but old-revision and failed results never move a new model", async ({ page }) => {
  const { agp, drawing } = await open(page);
  const overview = await shot(page);
  const result = await look(agp, "close");
  await expect.poll(() => shot(page)).not.toBe(overview);
  const followed = await shot(page);
  await page.reload();
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", drawing.revision);
  await expect.poll(() => shot(page)).toBe(followed);
  const next = revised({ ...drawing, pieces: drawing.pieces.map((p) => ({ ...p, color: 1 })) });
  agp.share("inspections", next);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", next.revision);
  await page.waitForTimeout(700); // Model framing eases to its new bounds.
  const current = await shot(page);
  agp.result("inspections", { tool_name: "look", id: "late", args: other }, result);
  agp.result("inspections", { tool_name: "look", id: "failed", args: close }, ["The render failed."]);
  await page.waitForTimeout(500);
  expect(await shot(page)).toBe(current);
});

test("replay and annotation keep their view while Holo inspects; Live resumes the latest inspection", async ({
  page,
}) => {
  const { agp } = await open(page);
  const before = await shot(page);
  await look(agp, "close");
  await expect.poll(() => shot(page)).not.toBe(before);
  await page.getByRole("button", { name: "First step", exact: true }).click();
  await expect(page.getByRole("button", { name: "Live", exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  const replay = await shot(page);
  await look(agp, "other", other);
  await page.waitForTimeout(300);
  expect(await shot(page)).toBe(replay);
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect.poll(() => shot(page)).not.toBe(replay);
  await page.getByRole("button", { name: "Annotate", exact: true }).click();
  const frozen = page.getByRole("img", { name: "Frozen model view" });
  await expect(frozen).toBeVisible();
  const source = await frozen.getAttribute("src");
  await look(agp, "annotating", close);
  await page.waitForTimeout(300);
  expect(await frozen.getAttribute("src")).toBe(source);
  await page.getByRole("button", { name: "Cancel annotation", exact: true }).click();
  await expect(frozen).toHaveCount(0);
});

test("only a successful render with a named revision can restore an inspection", () => {
  const result = {
    role: "tool" as const,
    text: "Revision a1b2c3d4, 24 pieces. The render.",
    images: ["data:image/jpeg;base64,test"],
  };
  expect(inspected("look", close, result)?.revision).toBe("a1b2c3d4");
  expect(inspected("look", close, { ...result, images: [] })).toBeNull();
  expect(inspected("look", close, { ...result, text: "The render failed." })).toBeNull();
  expect(inspected("look", { box: [1] }, result)).toBeNull();
});
