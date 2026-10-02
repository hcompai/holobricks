import { expect, test } from "@playwright/test";
import { ACCOUNT, fixture, site } from "./fixtures";
import { platform } from "./platform";

test("the owner renames, makes private and deletes their builds from their cards", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("run-1", "idle");
  agp.say("run-1", "A little tower");
  agp.share("run-1", fixture());
  agp.answer("run-1", "Built.");

  const imported = {
    id: "import-1",
    name: "Granite house",
    prompt: "",
    pieces: 8,
    steps: 4,
    author: ACCOUNT.user.name,
    owner: ACCOUNT.user.id,
    published: 2,
    thumbnail: null,
    build: "https://blob.test/builds/import-1/build.json.gz",
    private: false,
  };
  const entries = [imported];
  const removed: string[] = [];
  const calls: string[] = [];
  await page.route("**/api/builds*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push(`${request.method()} builds ${request.method() === "PATCH" ? request.postData() : url.search}`);
    if (request.method() === "PATCH") {
      const { id, private: hidden } = request.postDataJSON();
      const entry = entries.find((e) => e.id === id)!;
      entry.private = hidden;
      return route.fulfill({ json: entry });
    }
    if (url.searchParams.has("mine")) return route.fulfill({ json: entries.filter((e) => e.private) });
    if (url.searchParams.has("id")) return route.fulfill({ status: 404, json: { error: "Not public." } });
    return route.fulfill({ json: entries.filter((e) => !e.private) });
  });
  await page.route("**/api/projects*", (route) => {
    const request = route.request();
    if (request.method() === "DELETE") {
      const url = new URL(request.url());
      const id = url.searchParams.get("id")!;
      calls.push(`DELETE projects ${url.search}`);
      if (url.searchParams.get("source") === "session") removed.push(id);
      else
        entries.splice(
          entries.findIndex((e) => e.id === id),
          1,
        );
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: removed });
  });
  await page.goto("/");

  const yours = page.getByRole("region", { name: "Your builds" });
  const card = (name: RegExp) => yours.locator(".tile-owned").filter({ has: page.locator(".tile", { hasText: name }) });
  await expect(card(/Granite house/)).toBeVisible();
  await expect(card(/Untitled build/)).toBeVisible();

  // Rename from the card.
  await card(/Granite house/)
    .getByRole("button", { name: "Rename, publish or delete" })
    .click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("New name").fill("Maison en granit");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(card(/Maison en granit/)).toBeVisible();

  // Make it private: it stays under Your builds, tagged private.
  await card(/Maison en granit/)
    .getByRole("button", { name: "Rename, publish or delete" })
    .click();
  await page.getByRole("menuitem", { name: "Make private" }).click();
  await page.getByRole("dialog", { name: "Make private" }).getByRole("button", { name: "Make private" }).click();
  await expect(card(/Maison en granit/)).toContainText("private");
  expect(calls).toContain('PATCH builds {"id":"import-1","private":true}');

  // Delete the session: the confirmation says what stays on the platform; it is gone after a reload too.
  await card(/Untitled build/)
    .getByRole("button", { name: "Rename, publish or delete" })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete" });
  await expect(confirm).toContainText("Its chat stays on H's platform until the session ends");
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(card(/Untitled build/)).toHaveCount(0);
  expect(calls).toContain("DELETE projects ?id=run-1&source=session");
  await page.reload();
  await expect(card(/Maison en granit/)).toBeVisible();
  await expect(card(/Untitled build/)).toHaveCount(0);

  // Delete the imported build for good.
  await card(/Maison en granit/)
    .getByRole("button", { name: "Rename, publish or delete" })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(confirm).toContainText("This cannot be undone");
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(yours.locator(".tile-owned")).toHaveCount(0);
  expect(calls).toContain("DELETE projects ?id=import-1&source=public");
});

test("a teammate's public build has no owner's menu", async ({ page }) => {
  await site(page);
  await page.route("**/api/builds*", (route) =>
    new URL(route.request().url()).searchParams.has("id") || new URL(route.request().url()).searchParams.has("mine")
      ? route.fulfill({ json: [] })
      : route.fulfill({
          json: [
            {
              id: "theirs",
              name: "Ada's tower",
              prompt: "",
              pieces: 8,
              steps: 4,
              author: "Ada Lovelace",
              owner: "u-ada",
              published: 1,
              thumbnail: null,
              build: "https://blob.test/builds/theirs/build.json.gz",
            },
          ],
        }),
  );
  await page.goto("/");
  const everyone = page.getByRole("region", { name: "Public builds" });
  await expect(everyone.locator(".tile")).toContainText("Ada's tower");
  await expect(page.getByRole("button", { name: "Rename, publish or delete" })).toHaveCount(0);
});
