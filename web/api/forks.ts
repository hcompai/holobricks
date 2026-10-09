import { isTerminalSessionStatus } from "hai-agents";
import { gunzipSync } from "node:zlib";
import { forkSeed, readSeed } from "../src/forkModel";
import type { Build } from "../src/model";
import { holder } from "./lib/account";
import { body, Refusal, route } from "./lib/http";
import { imported, LIMITS } from "./lib/imported";
import { forkList, carriedFrom, isFork, linkFork, readFork, saveFork } from "./lib/forks";
import { ownedSession } from "./lib/snapshot";
import { ID } from "./lib/store";

const headers = { "Cache-Control": "private, no-store" };
/** A copy is a fork of its own, or one of the caller's builds carried on past its ended session. */
const copyId = (id: unknown) => {
  if (typeof id !== "string" || !ID.test(id)) throw new Refusal(400, "Invalid copy.");
  return id;
};

export const GET = route(async (request) => {
  const { user } = holder(request);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json(await forkList(user.id), { headers });
  const copy = await readFork(user.id, copyId(id));
  if (!copy) throw new Refusal(404, "Copy unavailable.");
  return Response.json(copy, { headers });
});

/** Save the drawing only. No Agents API call and no message to Holo. */
export const POST = route(async (request) => {
  const { user, key } = holder(request);
  const upload = Buffer.from(await request.arrayBuffer());
  if (upload.length > 4 * 1024 * 1024) throw new Refusal(413, "Model too large.");
  let given;
  try {
    given = JSON.parse(gunzipSync(upload, { maxOutputLength: LIMITS.geometry + 20_000_000 }).toString());
  } catch {
    throw new Refusal(400, "Invalid copy.");
  }
  const id = copyId(given.id);
  if (!isFork(id)) await ownedSession(id, key);
  const seed = await readSeed(new Blob([JSON.stringify(given.seed)])).catch(() => {
    throw new Refusal(400, "Invalid copy.");
  });
  await imported(seed.model, id); // Reuse the existing geometry and size validation.
  const clean = forkSeed(seed.model as Build, seed.origin, seed.model.name);
  return Response.json(await saveFork(user.id, id, clean), { status: 201, headers });
});

/**
 * Bind a copy to the session its message started: `{ id, sessionId }`. A copy continues in one session; once that
 * session ended, the one carrying it on takes its place.
 */
export const PATCH = route(async (request) => {
  const { user, key } = holder(request);
  const given = await body<{ id: string; sessionId: string }>(request);
  const id = copyId(given.id);
  const copy = await readFork(user.id, id);
  if (!copy) throw new Refusal(404, "Copy unavailable.");
  const session = await ownedSession(given.sessionId, key);
  if (copy.sessionId !== given.sessionId) {
    const after = carriedFrom(id, session.request.groupId);
    const current = copy.sessionId ?? (isFork(id) ? null : id);
    if (after === undefined || (after !== null && after !== current))
      throw new Refusal(400, "Session does not belong to this copy.");
    if (after && !isTerminalSessionStatus((await ownedSession(after, key)).status.status))
      throw new Refusal(409, "The copy's session is still open.");
    await linkFork(user.id, id, given.sessionId, copy.sessionId);
  }
  return new Response(null, { status: 204, headers });
});
