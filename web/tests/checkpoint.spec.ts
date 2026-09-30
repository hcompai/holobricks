import { expect, test } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { snapshot } from "../api/lib/snapshot";
import { imported } from "../api/lib/imported";
import { fixture } from "./fixtures";

test("publishing or importing a checkpoint never publishes its recovery source", async () => {
  const model = {
    ...fixture(),
    recovery: { version: 1 as const, revision: fixture().revision, script: "PRIVATE_SOURCE" },
  };
  expect(await imported(model, "imported")).not.toHaveProperty("recovery");
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/model") return new Response(gzipSync(JSON.stringify(model)));
    if (url.pathname.endsWith("/changes"))
      return Number(url.searchParams.get("from_index")) > 0
        ? new Response(null, { status: 204 })
        : Response.json({
            status: "failed",
            new_events: [
              {
                timestamp: "2026-01-01T00:00:00Z",
                type: "AttachmentEvent",
                data: {
                  origin: "agent",
                  name: "model.json.gz",
                  path: "/workspace/model.json.gz",
                  url: "https://files.test/model",
                  media_type: "application/json",
                  size_bytes: 1,
                },
              },
            ],
          });
    if (url.pathname.endsWith("/sessions"))
      return Response.json({
        items: [{ id: "mine", agent: "brickyard", status: "failed", created_at: "2026-01-01T00:00:00Z" }],
        total: 1,
        page: 1,
      });
    return Response.json({
      id: "mine",
      request: { agent: "brickyard" },
      status: { status: "failed" },
      created_at: "2026-01-01T00:00:00Z",
    });
  };
  try {
    const published = await snapshot("mine", "test-key", null, async () => "unused");
    expect(published.revision).toBe(model.revision);
    expect(published).not.toHaveProperty("recovery");
    expect(JSON.stringify(published)).not.toContain("PRIVATE_SOURCE");
  } finally {
    globalThis.fetch = original;
  }
});
