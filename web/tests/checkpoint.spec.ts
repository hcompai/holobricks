import { expect, test } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { snapshot } from "../api/lib/snapshot";
import { imported } from "../api/lib/imported";
import { fixture } from "./fixtures";

/** Publish the finished session "mine", whose shared model is `model`, with `edits`, against a mocked Agents API. */
async function published(model: object, edits: unknown, fork = false) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/seed")
      return Response.json({ format: 1, origin: { id: "PRIVATE_ORIGIN" }, model: { name: "My fork" } });
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
                        path: "/workspace/brickyard-fork.json.gz",
                        url: "https://files.test/seed",
                        media_type: "application/json",
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
    return await snapshot("mine", "test-key", edits, async () => "unused");
  } finally {
    globalThis.fetch = original;
  }
}

test("publishing or importing a checkpoint never publishes its recovery source", async () => {
  const model = {
    ...fixture(),
    recovery: { version: 1 as const, revision: fixture().revision, script: "PRIVATE_SOURCE" },
  };
  expect(await imported(model, "imported")).not.toHaveProperty("recovery");
  const build = await published(model, null);
  expect(build.revision).toBe(model.revision);
  expect(build).not.toHaveProperty("recovery");
  expect(JSON.stringify(build)).not.toContain("PRIVATE_SOURCE");
});

test("publishing applies every kind of hand edit the viewer makes, and refuses malformed ones", async () => {
  const model = fixture();
  const edits = [
    { kind: "duplicate", ids: [0, 1], by: [80, 0, 0], first: 8 },
    { kind: "move", ids: [8], by: [0, -8, 0] },
    { kind: "rotate", ids: [2], turns: 1, about: [20, 0] },
    { kind: "color", ids: [3], color: 1 },
    { kind: "delete", ids: [7] },
  ];
  const build = await published(model, { revision: model.revision, edits });
  expect(build.pieces.map((p) => p.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 9]);
  expect(build.revision).not.toBe(model.revision);
  const malformed = { revision: model.revision, edits: [{ kind: "duplicate", ids: [0], by: [80, 0, 0] }] };
  await expect(published(model, malformed)).rejects.toThrow("The edits are malformed.");
});

test("publishing a running fork's saved model keeps its name and omits private ancestry", async () => {
  const build = await published(fixture(), null, true);
  expect(build.name).toBe("My fork");
  expect(build.revision).toBe(fixture().revision);
  expect(build).not.toHaveProperty("origin");
  expect(JSON.stringify(build)).not.toContain("PRIVATE_ORIGIN");
});
