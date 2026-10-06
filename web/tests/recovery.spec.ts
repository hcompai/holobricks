import { expect, test } from "@playwright/test";
import { gunzipSync, gzipSync } from "node:zlib";
import { fixture, site } from "./fixtures";
import { platform } from "./platform";

const model = () => ({
  ...fixture(),
  recovery: { version: 1 as const, revision: fixture().revision, script: 'step("Tower")\nbrick("3001", 0, 0, 0, 4)' },
});
const photo =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

test("recover a failed build with its exact checkpoint, original requests and photos; keep the original", async ({
  page,
}) => {
  await site(page);
  const agp = await platform(page);
  const saved = model();
  agp.session("failed", "failed");
  agp.say("failed", "Build a tower", [photo]);
  agp.say("failed", "Make the roof red");
  agp.attach("failed", "remix.py", Buffer.from("old starting model"));
  agp.step("failed", "Adding the roof.", "PRIVATE_REASONING");
  agp.share("failed", saved);
  await page.goto("/?build=failed");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", saved.revision);
  const panel = page.getByRole("region", { name: "Build recovery" });
  await expect(panel).toContainText("Your original model stays here");
  await panel.getByRole("button", { name: "Continue from saved version" }).click();
  await expect(page).toHaveURL(/build=new-build$/);
  const [created] = agp.posted("/api/v2/sessions");
  expect(created.group_id).toBe("failed");
  expect(created.messages.slice(0, 2).map((m: any) => m.message)).toEqual(["Build a tower", "Make the roof red"]);
  expect(created.messages[0].images).toEqual([photo]);
  const file = created.messages[0].files.find((f: any) => f.name === "recovery-model.json.gz");
  expect(gunzipSync(Buffer.from(file.source, "base64")).toString()).toBe(JSON.stringify(saved));
  expect(created.messages[0].files.some((f: any) => f.name === "remix.py")).toBe(false);
  expect(JSON.stringify(created)).not.toContain("PRIVATE_REASONING");
  expect(agp.posted("/messages")).toHaveLength(0);
  await page.getByRole("link", { name: "Open original build" }).click();
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", saved.revision);
  await page.getByRole("button", { name: "Open recovery attempt" }).click();
  await expect(page).toHaveURL(/build=new-build$/);
  expect(agp.posted("/api/v2/sessions")).toHaveLength(1);
  expect(agp.sessions.get("failed")!.status).toBe("failed");
});

test("an accepted recovery whose response was lost is reopened without creating another attempt", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("failed", "failed");
  agp.say("failed", "Build a tower");
  agp.share("failed", model());
  agp.loseCreationResponse = true;
  await page.goto("/?build=failed");
  await page.getByRole("button", { name: "Continue from saved version" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Continue from saved version" }).click();
  await expect(page).toHaveURL(/build=new-build$/);
  expect(agp.posted("/api/v2/sessions")).toHaveLength(1);
  await expect(page.getByRole("link", { name: "Open original build" })).toBeVisible();
});

test("legacy builds honestly restart with the same request; failed creation preserves the model and can be retried", async ({
  page,
}) => {
  await site(page);
  const agp = await platform(page);
  agp.session("legacy", "failed");
  agp.say("legacy", "My original request", [photo]);
  agp.share("legacy", fixture());
  agp.refuse = [503];
  await page.goto("/?build=legacy");
  const retry = page.getByRole("button", { name: "Try again with same request" });
  await expect(page.getByRole("region", { name: "Build recovery" })).toContainText(
    "will restart from its original inputs",
  );
  await retry.click();
  await expect(page.getByRole("alert")).toContainText("original build is unchanged");
  expect(agp.posted("/api/v2/sessions")).toHaveLength(1);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", fixture().revision);
  await retry.click();
  await expect(page).toHaveURL(/build=new-build$/);
  const created = agp.posted("/api/v2/sessions")[1];
  expect(created.messages).toHaveLength(1);
  expect(created.messages[0].message).toBe("My original request");
  expect(created.messages[0].images).toEqual([photo]);
  expect(created.messages[0].files.map((f: any) => f.name)).toEqual(["brickyard.tgz", "reference-1-1.jpg"]);
});

test("a missing original photo never silently creates a different build", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("failed", "failed");
  agp.say("failed", "Match this photo", [
    { type: "url", source: "https://agp.eu.hcompany.ai/files/missing", mediaType: "image/jpeg" },
  ]);
  await page.goto("/?build=failed");
  await page.getByRole("button", { name: "Try again with same request" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(agp.posted("/api/v2/sessions")).toHaveLength(0);
});

for (const seed of ["remix.py", "recovery-model.json.gz"]) {
  test(`retry before the first share preserves the original ${seed}`, async ({ page }) => {
    await site(page);
    const agp = await platform(page);
    const original =
      seed === "remix.py"
        ? Buffer.from('step("Tower")\nplace("3001", 4, (40, -8, 20))')
        : gzipSync(JSON.stringify(model()));
    agp.session("failed", "failed");
    agp.say("failed", "Make the roof red");
    agp.attach("failed", seed, original);
    await page.goto("/?build=failed");
    await page.getByRole("button", { name: "Try again with same request" }).click();
    await expect(page).toHaveURL(/build=new-build$/);
    const [created] = agp.posted("/api/v2/sessions");
    const file = created.messages[0].files.find((f: any) => f.name === seed);
    expect(Buffer.from(file.source, "base64")).toEqual(original);
    expect(created.messages[0].message).toBe("Make the roof red");
  });
}

test("a missing original remix model blocks retry instead of dropping the model", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("failed", "failed");
  agp.say("failed", "Make the roof red");
  const url = agp.attach("failed", "remix.py", Buffer.from("model"));
  agp.files.delete(url);
  await page.goto("/?build=failed");
  await page.getByRole("button", { name: "Try again with same request" }).click();
  await expect(page.getByRole("alert")).toContainText("original starting model could not be retrieved");
  expect(agp.posted("/api/v2/sessions")).toHaveLength(0);
});

test("recovery fetches external reference photos without the Agents key", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  const url = "https://images.example.org/reference.png";
  const requests: { authorization?: string }[] = [];
  await page.route(url, (route) => {
    requests.push({ authorization: route.request().headers().authorization });
    return route.fulfill({
      contentType: "image/png",
      body: Buffer.from(photo.split(",")[1], "base64"),
      headers: { "access-control-allow-origin": "*" },
    });
  });
  agp.session("external-photo", "failed");
  agp.say("external-photo", "Build a tower", [{ type: "url", source: url }]);
  agp.share("external-photo", model());
  await page.goto("/?build=external-photo");
  await page.getByRole("button", { name: "Continue from saved version" }).click();
  await expect(page).toHaveURL(/build=new-build$/);
  expect(requests.length).toBeGreaterThanOrEqual(1);
  expect(requests.every((r) => !r.authorization)).toBe(true);
  const [created] = agp.posted("/api/v2/sessions");
  expect(created.messages[0].images).toEqual([photo]);
});

test("a platform attachment redirect is blocked before contacting another host", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("redirected", "failed");
  agp.say("redirected", "Build a tower");
  agp.share("redirected", model());
  let forwarded = 0;
  await page.route("https://external.example/redirected", (route) => {
    forwarded++;
    return route.fulfill({ body: "unexpected" });
  });
  await page.route("https://agp.eu.hcompany.ai/files/redirected/1.gz", (route) =>
    route.fulfill({
      status: 302,
      headers: { location: "https://external.example/redirected" },
    }),
  );
  await page.goto("/?build=redirected");
  await expect(page.getByRole("alert")).toContainText("Couldn't load the latest model");
  expect(forwarded).toBe(0);
  expect(agp.posted("/api/v2/sessions")).toHaveLength(0);
});
