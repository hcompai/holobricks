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
