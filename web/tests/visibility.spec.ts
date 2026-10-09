import { expect, test, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { ACCOUNT, fixture, site } from "./fixtures";
import { platform } from "./platform";

const BLOB = "https://blob.test";

/** The public library API: publishing lists the build, deleting unlists it. */
async function library(page: Page) {
  const published: any[] = [];
  const calls: string[] = [];
  await page.route(`${BLOB}/**`, (route) =>
    route.fulfill({ headers: { "access-control-allow-origin": "*" }, body: gzipSync(JSON.stringify(fixture())) }),
  );
  await page.route("**/api/builds*", (route) => {
    const request = route.request();
    const method = request.method();
    const id = new URL(request.url()).searchParams.get("id");
    if (method === "POST") {
      calls.push("POST");
      const entry = {
        id: request.postDataJSON().id,
        name: "A tower",
        pieces: 8,
        steps: 4,
        author: ACCOUNT.user.name,
        owner: ACCOUNT.user.id,
        published: 1,
        thumbnail: null,
        build: `${BLOB}/builds/live/build.json.gz`,
      };
      published.unshift(entry);
      return route.fulfill({ status: 201, json: entry });
    }
    if (method === "DELETE") {
      calls.push("DELETE");
      published.splice(0, published.length);
      return route.fulfill({ status: 204 });
    }
    if (id) {
      const one = published.find((p) => p.id === id);
      return one ? route.fulfill({ json: one }) : route.fulfill({ status: 404, json: { error: "Not public." } });
    }
    return route.fulfill({ json: published });
  });
  return calls;
}

test("the first public build is confirmed from the finished card, the next switch flips at once", async ({ page }) => {
  await site(page);
  const calls = await library(page);
  const agp = await platform(page);
  agp.session("live");
  agp.say("live", "A tower");
  const model = fixture();
  agp.share("live", model);
  await page.goto("/?build=live");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model.revision);

  const card = page.getByRole("region", { name: "Build finished" });
  const header = page.locator("header").getByRole("switch", { name: "Public", exact: true });
  await expect(card).toHaveCount(0);
  await expect(header).toBeDisabled();

  agp.answer("live", "Built it.");
  await expect(card).toContainText("is ready");
  await expect(card).toContainText("only you can see it");
  const inCard = card.getByRole("switch", { name: "Public", exact: true });
  await expect(inCard).not.toBeChecked();
  await expect(inCard).toHaveText("Private");

  await inCard.click();
  const ask = page.getByRole("dialog", { name: "Make it public" });
  await expect(ask).toContainText(`Share ${model.name} with everyone?`);
  await expect(ask).toContainText(`credited to ${ACCOUNT.user.name}`);
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toHaveCount(0);
  expect(calls).toEqual([]);

  await inCard.click();
  await ask.getByRole("button", { name: "Make it public" }).click();
  await expect(ask).toHaveCount(0);
  await expect(inCard).toBeChecked();
  await expect(inCard).toHaveText("Public");
  await expect(header).toBeChecked();
  await expect(card).toContainText("in the public library");
  expect(calls).toEqual(["POST"]);

  await header.click();
  await expect(header).not.toBeChecked();
  await expect(card).toContainText("only you can see it");
  await header.click();
  await expect(header).toBeChecked();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls).toEqual(["POST", "DELETE", "POST"]);

  await card.getByRole("button", { name: "Dismiss" }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model.revision);
  await expect(header).toBeChecked();
  await expect(card).toHaveCount(0);
});
