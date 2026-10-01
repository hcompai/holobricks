import { expect, test } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { snapshot } from "../api/lib/snapshot";
import { imported } from "../api/lib/imported";
import { fixture } from "./fixtures";

for (const fork of [false, true])
  test(`publishing a ${fork ? "fork" : "checkpoint"} keeps its name without publishing private source or ancestry`, async () => {
    const model = {
      ...fixture(),
      recovery: { version: 1 as const, revision: fixture().revision, script: "PRIVATE_SOURCE" },
    };
    expect(await imported(model, "imported")).not.toHaveProperty("recovery");
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/fork")
        return new Response(
          gzipSync(JSON.stringify({ format: 1, model: { name: "My fork" }, origin: { id: "PRIVATE_ANCESTRY" } })),
        );
      if (url.pathname === "/model") return new Response(gzipSync(JSON.stringify(model)));
      if (url.pathname.endsWith("/changes"))
        return Number(url.searchParams.get("from_index")) > 0
          ? new Response(null, { status: 204 })
          : Response.json({
              status: "failed",
              new_events: [
                ...(fork
                  ? [
                      {
                        timestamp: "2026-01-01T00:00:00Z",
                        type: "AttachmentEvent",
                        data: {
                          origin: "user",
                          name: "brickyard-fork.json.gz",
                          path: "/workspace/files/brickyard-fork.json.gz",
                          url: "https://files.test/fork",
                          media_type: "application/gzip",
                          size_bytes: 1,
                        },
                      },
                    ]
                  : []),
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
      expect(published.name).toBe(fork ? "My fork" : model.name);
      expect(JSON.stringify(published)).not.toContain("PRIVATE_ANCESTRY");
      expect(published).not.toHaveProperty("recovery");
      expect(JSON.stringify(published)).not.toContain("PRIVATE_SOURCE");
    } finally {
      globalThis.fetch = original;
    }
  });
