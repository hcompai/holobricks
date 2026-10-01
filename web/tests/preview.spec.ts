import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { site } from "./fixtures";

const TOWER = {
  id: "tower",
  name: `Ada's <tower> & "keep"`,
  prompt: "A private prompt",
  pieces: 1534,
  steps: 12,
  author: "Ada Lovelace",
  owner: "u-ada",
  published: 1,
  thumbnail: "https://blob.test/builds/tower/thumbnail.webp?v=1",
  build: "https://blob.test/builds/tower/build.json.gz",
};
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);
const SHOWCASE = { id: "hogwarts", name: "Hogwarts", prompt: "A private prompt", pieces: 26987, thumbnail: 179 };

/** Vercel Blob's API holding the public library entry of TOWER, and the site's gallery holding SHOWCASE. */
async function host() {
  const server = createServer((request, response) => {
    const url = new URL(request.url!, origin);
    const json = (body: object, status = 200) => response.writeHead(status).end(JSON.stringify(body));
    const pathname = url.searchParams.get("url");
    if (pathname === "library/broken.json") return json({ error: { code: "unknown_error" } }, 500);
    if (pathname === `library/${TOWER.id}.json`)
      return json({ url: `${origin}/${pathname}`, pathname, uploadedAt: new Date().toISOString() });
    if (pathname) return json({ error: { code: "not_found", message: "The requested blob does not exist" } }, 404);
    if (url.pathname === `/library/${TOWER.id}.json`) return json(TOWER);
    json({}, 404);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test_secret",
    VERCEL_BLOB_API_URL: origin,
    VERCEL_BLOB_RETRIES: "0",
  });
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    String(input).endsWith("/gallery/builds.json") ? Response.json([SHOWCASE]) : real(input, init);
  return {
    origin,
    close: () => {
      globalThis.fetch = real;
      server.close();
    },
  };
}

/** The preview function as it deploys, bundled with the webServer's build of dist/index.html. */
async function bundled(): Promise<(request: Request) => Promise<Response>> {
  const out = mkdtempSync(join(tmpdir(), "brickyard-api-"));
  execFileSync("node", ["scripts/build-api.mjs", out]);
  return (await import(pathToFileURL(join(out, "functions/api/preview.func/index.mjs")).href)).GET;
}

const meta = (html: string, key: string) =>
  html.match(new RegExp(`<meta\\s+(?:property|name)="${key}"\\s+content="([^"]*)"`))?.[1];

test("a link to a public build or a showcase previews its name, pieces, author and cover; any other gets the app as is", async () => {
  const GET = await bundled();
  const index = readFileSync("dist/index.html", "utf8");
  const { origin, close } = await host();
  const page = async (search: string) => {
    const response: Response = await GET(new Request(`${origin}/${search}`));
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    return response.text();
  };
  try {
    const tower = await page("?public=tower");
    expect(meta(tower, "og:title")).toBe("Ada&#39;s &#60;tower&#62; &#38; &#34;keep&#34; · HoloBricks");
    expect(meta(tower, "og:description")).toBe("1,534 pieces, shared by Ada Lovelace");
    expect(meta(tower, "og:url")).toMatch(/^https:\/\/[^/?]+\/\?public=tower$/);
    expect(meta(tower, "og:image")).toBe(TOWER.thumbnail);
    expect(meta(tower, "og:image:width")).toBeUndefined();
    expect(tower).not.toContain("<tower>");
    expect(tower).not.toContain(TOWER.prompt);
    expect(tower.replace(/<meta\s+property="og:[^>]*>\s*/g, "")).toBe(
      index.replace(/<meta\s+property="og:[^>]*>\s*/g, ""),
    );

    const hogwarts = await page("?showcase=hogwarts");
    expect(meta(hogwarts, "og:title")).toBe("Hogwarts · HoloBricks");
    expect(meta(hogwarts, "og:description")).toBe("26,987 pieces, from the HoloBricks gallery");
    expect(meta(hogwarts, "og:image")).toMatch(/^https:\/\/[^/?]+\/gallery\/thumbnails\/hogwarts\.png\?v=179$/);
    expect(hogwarts).not.toContain(SHOWCASE.prompt);

    for (const search of ["?public=gone", "?public=broken", "?public=../tower", "?showcase=gone", "?build=tower"])
      expect(await page(search), search).toBe(index);
  } finally {
    close();
  }
});

test("signed out, a shared link shows the build's cover and who shared it above the sign-in", async ({ page }) => {
  const GET = await bundled();
  const { origin, close } = await host();
  try {
    const html = await (await GET(new Request(`${origin}/?public=tower`))).text();
    await site(page, [], null);
    await page.route(/\/\?public=tower$/, (route) => route.fulfill({ contentType: "text/html", body: html }));
    await page.route(TOWER.thumbnail, (route) => route.fulfill({ contentType: "image/png", body: PIXEL }));
    await page.goto("/?public=tower");
    await expect(page.getByText("Ada Lovelace shared with you")).toBeVisible();
    await expect(page.getByRole("heading", { name: TOWER.name })).toBeVisible();
    await expect(page.getByRole("img", { name: TOWER.name })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  } finally {
    close();
  }
});
