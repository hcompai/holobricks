import { holder } from "./lib/account";
import { Refusal, route } from "./lib/http";
import { deleteFork, readFork } from "./lib/forks";
import { deleteProjectName } from "./lib/names";
import { markRemoved, removedIds } from "./lib/removed";
import { ownedSession } from "./lib/snapshot";
import { findOwn, ID, unlist } from "./lib/store";

const headers = { "Cache-Control": "private, no-store" };
const SOURCES = new Set(["session", "fork", "public"]);

/** The ids of the projects the caller removed from their library. */
export const GET = route(async (request) => {
  const { user } = holder(request);
  return Response.json(await removedIds(user.id), { headers });
});

/**
 * Delete one of the caller's projects: `?id=&source=`. A public copy is unpublished first. A fork's files and an
 * imported build's files are deleted; a session, which the Agents API cannot delete, is removed from the library.
 */
export const DELETE = route(async (request) => {
  const { user, key } = holder(request);
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  const source = params.get("source") ?? "";
  if (!ID.test(id) || !SOURCES.has(source)) throw new Refusal(400, "Invalid project.");

  // Only sessions need hiding, since the Agents API keeps them; a fork's or an import's files are simply deleted.
  const removed = source === "session" ? [id] : [];
  if (source === "fork") {
    if (!(await readFork(user.id, id))) throw new Refusal(404, "No such project of yours.");
  } else if (source === "session") {
    await ownedSession(id, key).catch((e) => {
      if (e instanceof Refusal && e.status === 403) throw new Refusal(403, "Only its owner can delete it.");
      throw e;
    });
  } else {
    const own = await findOwn(user.id, id);
    if (!own || own.owner !== user.id) throw new Refusal(404, "No such project of yours.");
  }

  // Public or private (a moderator may have hidden it), the caller's library copy goes with it.
  const published = await findOwn(user.id, id);
  if (published && published.owner === user.id) await unlist(id, user.id);
  if (source === "fork") {
    const run = await deleteFork(user.id, id);
    if (run) removed.push(run);
  }
  if (removed.length) await markRemoved(user.id, removed);
  await deleteProjectName(user.id, id).catch(() => undefined);
  return new Response(null, { status: 204 });
});
