import { expect, test } from "@playwright/test";
import { assetBlob, platformAsset } from "../src/assetUrl";

test("only the exact HTTPS Agents origin can receive credentials", () => {
  expect(platformAsset("https://agp.eu.hcompany.ai/files/photo.png")).toBe(true);
  for (const url of [
    "https://images.example.org/photo.png",
    "https://agp.eu.hcompany.ai.evil.example/photo.png",
    "https://agp.eu.hcompany.ai:444/photo.png",
    "https://agp.eu.hcompany.ai@evil.example/photo.png",
    "https://user:password@agp.eu.hcompany.ai/photo.png",
    "http://agp.eu.hcompany.ai/photo.png",
    "file:///etc/passwd",
  ])
    expect(platformAsset(url)).toBe(false);
});

test("oversized attachments are cancelled with or without a declared size", async () => {
  const bytes = new Uint8Array(10 * 1024 * 1024 + 1);
  await expect(assetBlob(new Response(bytes))).rejects.toThrow("too large");
  await expect(
    assetBlob(new Response("small", { headers: { "content-length": String(bytes.length) } })),
  ).rejects.toThrow("too large");
  const kept = await assetBlob(new Response("photo", { headers: { "content-type": "image/png" } }));
  expect(await kept.text()).toBe("photo");
  expect(kept.type).toBe("image/png");
});

test("a library model follows storage redirects without forwarding the API key", async ({ page }) => {
  const { fixture, site } = await import("./fixtures");
  const { platform } = await import("./platform");
  const { gzipSync } = await import("node:zlib");
  const { createServer } = await import("node:http");
  await site(page);
  const agp = await platform(page);
  agp.session("stored-model", "completed");
  const model = fixture();
  agp.share("stored-model", model);
  let storageRequests = 0;
  let forwardedKey = false;
  const storage = createServer((request, response) => {
    storageRequests++;
    forwardedKey ||= !!request.headers.authorization;
    response.writeHead(200, { "content-type": "application/gzip", "access-control-allow-origin": "*" });
    response.end(gzipSync(JSON.stringify(model)));
  });
  await new Promise<void>((resolve) => storage.listen(0, "127.0.0.1", resolve));
  const target = `http://127.0.0.1:${(storage.address() as import("node:net").AddressInfo).port}/model.gz`;
  try {
    await page.route([...agp.files.keys()][0], (route) =>
      route.request().method() === "OPTIONS"
        ? route.fulfill({
            status: 204,
            headers: {
              "access-control-allow-origin": "*",
              "access-control-allow-headers": "authorization",
              "access-control-allow-methods": "GET",
            },
          })
        : route.fulfill({ status: 302, headers: { location: target, "access-control-allow-origin": "*" } }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?build=stored-model");
    await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model.revision);
    await expect(page.locator(".viewer")).toHaveAttribute("data-render-state", "ready");
    expect(storageRequests).toBe(1);
    expect(forwardedKey).toBe(false);
  } finally {
    await new Promise<void>((resolve, reject) => storage.close((error) => (error ? reject(error) : resolve())));
  }
});
