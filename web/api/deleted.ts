import { holder } from "./lib/account";
import { body, Refusal, route } from "./lib/http";
import { findOwn, forget, forgotten, ID, unlist } from "./lib/store";

/** The ids of the caller's deleted builds, which their builds leave out. */
export const GET = route(async (request) =>
  Response.json(await forgotten(holder(request).user.id), { headers: { "Cache-Control": "private, no-store" } }),
);

/** Delete one of the caller's builds for good: `{ id }`. It leaves the library, and a session's build leaves their builds. */
export const POST = route(async (request) => {
  const { user } = holder(request);
  const { id } = await body<{ id?: unknown }>(request);
  if (typeof id !== "string" || !ID.test(id)) throw new Refusal(400, "No such build.");
  const published = await findOwn(user.id, id);
  const theirs = published?.owner === user.id;
  if (id.startsWith("import-") && !theirs) throw new Refusal(404, "No such build of yours.");
  if (theirs) await unlist(id, user.id);
  if (!id.startsWith("import-")) await forget(user.id, id);
  return new Response(null, { status: 204 });
});
