import { expect, test } from "@playwright/test";

test("New build requests Holo explicitly and retains the prompt and photo when Holo is unavailable", async ({
  page,
}) => {
  const build = {
    id: "previous",
    name: "Previous model",
    prompt: "Previous model",
    builder: "holo",
    status: "done",
    created: 1,
    updated: 1,
    width: 0,
    depth: 0,
    messages: [],
    steps: [],
    pieces: [],
  };
  const submitted: Record<string, unknown>[] = [];
  await page.addInitScript(() => {
    (window as any).EventSource = class {
      close() {}
    };
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/builds" && request.method() === "POST") {
      submitted.push(request.postDataJSON());
      return route.fulfill({ status: 503, json: { detail: "Holo is not configured on this server." } });
    }
    if (path === "/api/builds") return route.fulfill({ json: [{ ...build, pieces: 0, steps: 0 }] });
    if (path === "/api/builds/previous") return route.fulfill({ json: build });
    if (path === "/api/builds/previous/state")
      return route.fulfill({ json: { build, token: "previous", renders: [] } });
    if (path === "/api/ldconfig")
      return route.fulfill({ body: "0 !COLOUR White CODE 15 VALUE #FFFFFF EDGE #333333\n" });
    return route.fulfill({ status: 404 });
  });

  await page.goto("/?build=previous");
  await page.getByRole("button", { name: "New build", exact: true }).click();
  const composer = page.getByPlaceholder("Describe what to build…");
  const prompt = "Construis la Citadelle de Port-Louis à Lorient";
  await composer.fill(prompt);
  await page.locator('input[type="file"]').setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64",
    ),
  });
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("503: Holo is not configured on this server.", { exact: true })).toBeVisible();
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toMatchObject({ prompt, builder: "holo" });
  expect(submitted[0].images).toEqual([expect.stringMatching(/^data:image\/jpeg;base64,/)]);
  await expect(composer).toHaveValue(prompt);
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  expect(new URL(page.url()).searchParams.has("build")).toBe(false);
});
