import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import type { Build } from "../src/api";

const VERIFIED_XML = `<INVENTORY>
  <ITEM>
    <ITEMTYPE>P</ITEMTYPE>
    <ITEMID>3001</ITEMID>
    <COLOR>3</COLOR>
    <MINQTY>2</MINQTY>
    <CONDITION>N</CONDITION>
  </ITEM>
</INVENTORY>
`;

function fixture(): Build {
  return {
    id: "shop-test",
    name: "Little duck",
    prompt: "PRIVATE REQUEST",
    builder: "holo",
    status: "done",
    created: 1,
    updated: 1,
    width: 4,
    depth: 2,
    messages: [],
    steps: [{ index: 0, title: "Body" }],
    pieces: [
      { id: 1, part: "3001.dat", color: 14, step: 0, pos: [0, 0, 0], rot: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
      { id: 2, part: "3001.dat", color: 14, step: 0, pos: [80, 0, 0], rot: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    ],
  };
}

function packageFor(build: Build) {
  const rows = build.pieces.map((p) => [
    p.id,
    p.part,
    p.color,
    p.step,
    ...[...p.pos, ...p.rot].map((v) => Math.round(v * 1_000_000)),
  ]);
  return {
    version: 3,
    validation: { status: "verified", valid_until: Date.now() / 1000 + 86400 },
    id: "b".repeat(64),
    build_id: build.id,
    name: build.name,
    pieces: build.pieces.length,
    lots: 1,
    revision: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  };
}

function bomFor(build: Build) {
  return {
    revision: packageFor(build).revision,
    pieces: 2,
    validation: { status: "verified", valid_until: Date.now() / 1000 + 86400 },
    lines: [
      {
        part: "3001.dat",
        title: "Brick 2 x 4",
        color: 14,
        colorName: "Yellow",
        hex: "#F2CD37",
        count: 2,
        bricklinkPart: "3001",
        bricklinkColor: 3,
      },
    ],
  };
}

async function mock(page: Page, build = fixture(), failures = 0) {
  const pack = packageFor(build);
  const requests: any[] = [];
  await page.addInitScript(() => {
    class Events {
      onmessage: ((event: { data: string }) => void) | null = null;
      constructor() {
        (window as any).events = this;
      }
      close() {}
    }
    (window as any).EventSource = Events;
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/shopping")) {
      requests.push(request.postDataJSON());
      return failures-- > 0
        ? route.fulfill({ status: 503, json: { detail: "Could not prepare your parts. Please retry." } })
        : route.fulfill({ json: pack });
    }
    if (path === `/api/shopping/${pack.id}.xml`)
      return route.fulfill({ contentType: "application/xml", body: VERIFIED_XML });
    if (path === "/api/builds")
      return route.fulfill({ json: [{ ...build, pieces: build.pieces.length, steps: 1, thumbnail: 9999999999999 }] });
    if (path === "/api/builds/shop-test") return route.fulfill({ json: build });
    if (path === "/api/builds/shop-test/state") {
      const snapshot = { ...build, revision: packageFor(build).revision };
      const token = JSON.stringify(snapshot);
      const after = new URL(request.url()).searchParams.get("after");
      return route.fulfill({ json: { token, build: token === after ? null : snapshot, renders: [] } });
    }
    if (path === "/api/ldconfig") return route.fulfill({ body: "0 !COLOUR Yellow CODE 14 VALUE #F2CD37 EDGE #333333" });
    if (path.startsWith("/api/parts/"))
      return route.fulfill({ body: "0 FILE brickyard.ldr\n3 14 0 0 0 80 0 0 0 -24 0\n0 NOFILE" });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/?build=shop-test");
  return { pack, requests };
}

test("a recolor with the same piece count revalidates the BOM and removes the old list", async ({ page }) => {
  const build = fixture();
  await mock(page, build);
  let verified = true;
  await page.route("**/api/builds/shop-test/bom", (route) =>
    verified
      ? route.fulfill({ json: bomFor(build) })
      : route.fulfill({ status: 422, json: { detail: { message: "Unverified color" } } }),
  );
  await page.getByRole("button", { name: "Parts", exact: true }).click();
  await expect(page.getByRole("cell", { name: "3001 / 3", exact: true })).toBeVisible();
  verified = false;
  build.pieces[0].color = 503;
  // Finished builds release their event stream. The independent snapshot poll must
  // still detect changed colors even when the number of pieces remains identical.
  await expect(page.getByRole("alert")).toContainText("could not be verified");
  await expect(page.getByRole("cell", { name: "3001 / 3", exact: true })).toHaveCount(0);
});

for (const failure of ["legacy", "expired", "incomplete", "revision"] as const) {
  test(`a ${failure} BOM never appears as a parts list`, async ({ page }) => {
    const build = fixture();
    await mock(page, build);
    const bom = bomFor(build);
    if (failure === "expired") bom.validation.valid_until = 1;
    if (failure === "incomplete") bom.lines[0].count = 1;
    if (failure === "revision") bom.revision = "a".repeat(64);
    await page.route("**/api/builds/shop-test/bom", (route) =>
      route.fulfill({ json: failure === "legacy" ? bom.lines : bom }),
    );
    await page.getByRole("button", { name: "Parts", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("could not be verified");
    await expect(page.getByRole("cell", { name: "3001 / 3", exact: true })).toHaveCount(0);
  });
}

test("one copy hands HoloTab a frozen, private-data-free shopping task", async ({ page, context }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const build = fixture();
  const { pack, requests } = await mock(page, build);
  await page.getByRole("button", { name: "Shop bricks", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Make it real." });
  await expect(dialog.getByRole("button", { name: "Copy for HoloTab" })).toBeEnabled();
  expect(requests.every((r) => r.revision === pack.revision)).toBe(true);
  await expect(dialog.getByRole("link", { name: "Install HoloTab" })).toHaveAttribute(
    "href",
    "https://chromewebstore.google.com/detail/holotab/hlaoiikljjgcjdhkakedfngifaopbcop",
  );
  await dialog.getByRole("button", { name: "Copy for HoloTab" }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain(`/api/shopping/${pack.id}.html`);
  expect(prompt.match(/```xml\n([\s\S]*?)```/)?.[1]).toBe(VERIFIED_XML);
  expect(prompt).toContain("no download, local file access, file picker or user upload is needed");
  expect(prompt).toContain("Upload BrickLink XML format");
  expect(prompt).toContain("an inaccessible link must not interrupt");
  expect(prompt).toContain("2 pieces, 1 part/color combinations");
  expect(prompt).toContain("instead of importing again");
  expect(prompt).toContain("Do not rewrite the XML");
  expect(prompt).toContain("do not edit the verified inventory to make it pass");
  expect(prompt).toContain("do not place orders or submit payment");
  expect(prompt).not.toContain("PRIVATE REQUEST");
  expect(prompt).not.toContain("/download.ldr");
  await expect(dialog.getByRole("status")).toContainText("Copied!");
  await expect(dialog.getByRole("link", { name: "View or download parts" })).toHaveAttribute(
    "href",
    new RegExp(`${pack.id}\\.html$`),
  );
  // A live rewind after the handoff must never change the copied order.
  build.pieces = [];
  build.steps = [];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".timeline")).toContainText("No steps yet");
  await dialog.getByRole("button", { name: "Copy again" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({ path: info.outputPath("shopping-mobile.png") });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("failed preparation retries and clipboard denial gives selectable text without claiming success", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    }),
  );
  await mock(page, fixture(), 1);
  await page.getByRole("button", { name: "Shop bricks", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("Please retry");
  await dialog.getByRole("button", { name: "Try again" }).click();
  await dialog.getByRole("button", { name: "Copy for HoloTab" }).click();
  const text = dialog.getByRole("textbox");
  await expect(text).toBeFocused();
  expect(await text.evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart)).toBeGreaterThan(500);
  await expect(dialog.getByRole("status")).not.toContainText("Copied!");
  await expect(text).toHaveValue(/Expected inventory: 2 pieces/);
  expect(await text.inputValue()).toContain(VERIFIED_XML);
});

test("XML loading failure blocks handoff until a complete retry succeeds", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mock(page);
  let attempts = 0;
  await page.route("**/api/shopping/*.xml", (route) =>
    ++attempts === 1
      ? route.fulfill({ status: 503 })
      : route.fulfill({ contentType: "application/xml", body: VERIFIED_XML }),
  );
  await page.getByRole("button", { name: "Shop bricks", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("couldn’t load your verified parts XML");
  await expect(dialog.getByRole("button", { name: "Copy for HoloTab" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "View or download parts" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Try again" }).click();
  await dialog.getByRole("button", { name: "Copy for HoloTab" }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt.match(/```xml\n([\s\S]*?)```/)?.[1]).toBe(VERIFIED_XML);
  expect(attempts).toBe(2);
});

for (const xml of ["<INVENTORY><ITEM>", VERIFIED_XML.replace("<MINQTY>2</MINQTY>", "<MINQTY>1</MINQTY>")]) {
  test(`incomplete XML cannot enter the clipboard (${xml.length} bytes)`, async ({ page }) => {
    await mock(page);
    await page.route("**/api/shopping/*.xml", (route) => route.fulfill({ contentType: "application/xml", body: xml }));
    await page.getByRole("button", { name: "Shop bricks", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("incomplete or does not match");
    await expect(page.getByRole("button", { name: "Copy for HoloTab" })).toHaveCount(0);
  });
}

test("an open dialog cannot copy XML after its validation expires", async ({ page }) => {
  const { pack } = await mock(page);
  await page.getByRole("button", { name: "Shop bricks", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const copy = dialog.getByRole("button", { name: "Copy for HoloTab" });
  await expect(copy).toBeEnabled();
  await page.evaluate(
    (now) => {
      Date.now = () => now;
    },
    (pack.validation.valid_until + 1) * 1000,
  );
  await copy.click();
  await expect(dialog.getByRole("alert")).toContainText("fresh catalog check");
  await expect(copy).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "View or download parts" })).toHaveCount(0);
});

test("shopping waits for a nonempty finished build", async ({ page }) => {
  await mock(page, { ...fixture(), status: "building" });
  await expect(page.getByRole("button", { name: "Shop bricks", exact: true })).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a stale preparation cannot expose a mismatched shopping link", async ({ page }) => {
  await mock(page);
  await page.route("**/api/builds/shop-test/shopping", (route) =>
    route.fulfill({ json: { ...packageFor(fixture()), revision: "stale" } }),
  );
  await page.getByRole("button", { name: "Shop bricks", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("Your model changed");
  await expect(dialog.getByRole("button", { name: "Copy for HoloTab" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "View or download parts" })).toHaveCount(0);
});

test("catalog rejections explain the invalid combinations and offer no shopping handoff", async ({ page }) => {
  await mock(page);
  await page.route("**/api/builds/shop-test/shopping", (route) =>
    route.fulfill({
      status: 422,
      json: {
        detail: {
          message: "Some bricks could not be verified in their chosen colors.",
          issues: [
            { part: "3001.dat", color_name: "Very Light Grey", count: 2, reason: "Color not recorded for this part." },
          ],
        },
      },
    }),
  );
  await page.getByRole("button", { name: "Shop bricks", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("2 × 3001.dat · Very Light Grey");
  await expect(dialog.getByRole("button", { name: "Copy for HoloTab" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "View or download parts" })).toHaveCount(0);
});

for (const state of ["legacy", "expired", "missing expiry"]) {
  test(`rejects ${state} shopping packages`, async ({ page }) => {
    await mock(page);
    const pack = packageFor(fixture());
    await page.route("**/api/builds/shop-test/shopping", (route) =>
      route.fulfill({
        json:
          state === "legacy"
            ? { ...pack, version: 2 }
            : { ...pack, validation: { status: "verified", valid_until: state === "expired" ? 1 : undefined } },
      }),
    );
    await page.getByRole("button", { name: "Shop bricks", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      state === "legacy" ? "needs catalog validation" : "fresh catalog check",
    );
    await expect(page.getByRole("button", { name: "Copy for HoloTab" })).toHaveCount(0);
  });
}
