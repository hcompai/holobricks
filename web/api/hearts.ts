import { holder } from "./lib/account";
import { heart, hearts, unheart } from "./lib/hearts";
import { body, Refusal, route, SHARED } from "./lib/http";
import { find, ID } from "./lib/store";

const PRIVATE = { "Cache-Control": "private, no-store" };

function buildId(value: unknown): string {
  if (typeof value !== "string" || !ID.test(value)) throw new Refusal(400, "No such build.");
  return value;
}

/** Hearts per public build, with the signed-in user's own when the request carries their pass. */
export const GET = route(async (request) => {
  if (!request.headers.has("authorization")) return Response.json(await hearts(null), { headers: SHARED });
  return Response.json(await hearts(holder(request).user.id), { headers: PRIVATE });
});

/** Heart a public build: `{ id }`. */
export const PUT = route(async (request) => {
  const { user } = holder(request);
  const id = buildId((await body<{ id: unknown }>(request)).id);
  if (!(await find(id))) throw new Refusal(404, "This build is not public.");
  await heart(id, user.id);
  return new Response(null, { status: 204 });
});

/** Take a heart back: `?id=`. */
export const DELETE = route(async (request) => {
  const { user } = holder(request);
  await unheart(buildId(new URL(request.url).searchParams.get("id")), user.id);
  return new Response(null, { status: 204 });
});
