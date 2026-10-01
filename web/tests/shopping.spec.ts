import { expect, test, type Page } from "@playwright/test";
import type { Bom, Build, ShoppingPackage } from "../src/model";
import { fixture, revised, site } from "./fixtures";

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

/** Two yellow bricks with a verified parts list and shopping package for their revision. */
function duck(): Build & { bom: Bom; shopping: ShoppingPackage } {
  const [piece] = fixture().pieces;
  const build = revised({
    ...fixture(),
    id: "shop-test",
    name: "Little duck",
    messages: [{ role: "user", text: "PRIVATE REQUEST", images: [] }],
    steps: [{ index: 0, title: "Body" }],
    pieces: [0, 1].map((id) => ({ ...piece, id, color: 14, step: 0, pos: [id * 80, 0, 0] })),
  });
  const validation = { status: "verified" as const, valid_until: Date.now() / 1000 + 86400 };
  return {
    ...build,
    bom: {
      revision: build.revision,
      pieces: 2,
      validation,
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
    },
    shopping: {
      version: 3,
      validation,
      id: "b".repeat(64),
      name: build.name,
      revision: build.revision,
      pieces: 2,
      lots: 1,
      xml: VERIFIED_XML,
    },
  };
}

async function open(page: Page, build: Build) {
  await site(page, [build]);
  await page.goto(`/?showcase=${build.id}`);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", build.revision);
}

test("one copy hands HoloTab the verified XML and nothing private", async ({ page, context }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, duck());
  await page.getByRole("button", { name: "Shop bricks", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Shop bricks" });
  await expect(dialog.getByRole("link", { name: "Install HoloTab" })).toHaveAttribute(
    "href",
    "https://chromewebstore.google.com/detail/holotab/hlaoiikljjgcjdhkakedfngifaopbcop",
  );
  await dialog.getByRole("button", { name: "Copy for HoloTab" }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt.match(/```xml\n([\s\S]*?)```/)?.[1]).toBe(VERIFIED_XML);
  expect(prompt).toContain("Upload BrickLink XML format");
  expect(prompt).toContain("2 pieces, 1 part/color combinations");
  expect(prompt).toContain("Do not rewrite the XML");
  expect(prompt).toContain("do not place orders or submit payment");
  expect(prompt).not.toContain("PRIVATE REQUEST");
  await expect(dialog.getByRole("status")).toContainText("Copied!");
  const xml = await dialog.getByRole("link", { name: "Download parts XML" }).getAttribute("href");
  expect(decodeURIComponent(xml!.replace(/^data:application\/xml;charset=utf-8,/, ""))).toBe(VERIFIED_XML);
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({ path: info.outputPath("shopping-mobile.png") });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("clipboard denial gives selectable text without claiming success", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    }),
  );
  await open(page, duck());
  await page.getByRole("button", { name: "Shop bricks", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Copy for HoloTab" }).click();
  const text = dialog.getByRole("textbox");
  await expect(text).toBeFocused();
  expect(await text.evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart)).toBeGreaterThan(500);
  await expect(dialog.getByRole("status")).not.toContainText("Copied!");
  expect(await text.inputValue()).toContain(VERIFIED_XML);
});

const broken: Record<string, [string, (b: ReturnType<typeof duck>) => Build]> = {
  unverified: [
    "Some bricks could not be verified",
    (b) => ({ ...b, shopping: { error: "Some bricks could not be verified." } }),
  ],
  legacy: ["needs catalog validation", (b) => ({ ...b, shopping: { ...b.shopping, version: 2 as 3 } })],
  expired: [
    "fresh catalog check",
    (b) => ({ ...b, shopping: { ...b.shopping, validation: { ...b.shopping.validation, valid_until: 1 } } }),
  ],
  stale: ["Your model changed", (b) => ({ ...b, shopping: { ...b.shopping, revision: "a".repeat(64) } })],
  incomplete: [
    "incomplete or does not match",
    (b) => ({
      ...b,
      shopping: { ...b.shopping, xml: VERIFIED_XML.replace("<MINQTY>2</MINQTY>", "<MINQTY>1</MINQTY>") },
    }),
  ],
};

for (const [name, [message, damage]] of Object.entries(broken)) {
  test(`no handoff: ${name} shopping package`, async ({ page }) => {
    await open(page, damage(duck()));
    await page.getByRole("button", { name: "Shop bricks", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("alert")).toContainText(message);
    await expect(dialog.getByRole("button", { name: "Copy for HoloTab" })).toHaveCount(0);
    await expect(dialog.getByRole("link", { name: "Download parts XML" })).toHaveCount(0);
  });
}

test("an open dialog cannot copy XML after its validation expires", async ({ page }) => {
  const build = duck();
  await open(page, build);
  await page.getByRole("button", { name: "Shop bricks", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const copy = dialog.getByRole("button", { name: "Copy for HoloTab" });
  await expect(copy).toBeEnabled();
  await page.evaluate((now) => (Date.now = () => now), (build.shopping.validation.valid_until + 1) * 1000);
  await copy.click();
  await expect(dialog.getByRole("alert")).toContainText("fresh catalog check");
  await expect(copy).toHaveCount(0);
});

const unlisted: Record<string, (b: ReturnType<typeof duck>) => Build> = {
  unverified: (b) => ({ ...b, bom: { error: "Some bricks could not be verified." } }),
  expired: (b) => ({ ...b, bom: { ...b.bom, validation: { ...b.bom.validation, valid_until: 1 } } }),
  incomplete: (b) => ({ ...b, bom: { ...b.bom, lines: [{ ...b.bom.lines[0], count: 1 }] } }),
  stale: (b) => ({ ...b, bom: { ...b.bom, revision: "a".repeat(64) } }),
};

test("the Parts panel lists a verified parts list", async ({ page }) => {
  await open(page, duck());
  await page.getByRole("button", { name: "Parts", exact: true }).click();
  await expect(page.getByRole("cell", { name: "3001 / 3", exact: true })).toBeVisible();
});

for (const [name, damage] of Object.entries(unlisted)) {
  test(`no parts list: ${name} BOM`, async ({ page }) => {
    await open(page, damage(duck()));
    await page.getByRole("button", { name: "Parts", exact: true }).click();
    await expect(page.locator(".parts [role=alert]")).toBeVisible();
    await expect(page.getByRole("cell", { name: "3001 / 3", exact: true })).toHaveCount(0);
  });
}
