import { holder } from "./lib/account";
import { body, route } from "./lib/http";
import { authorOf, checkedName, setDisplayName } from "./lib/profile";

const headers = { "Cache-Control": "private, no-store" };

/** The name the caller's public builds carry. */
export const GET = route(async (request) => {
  const { user } = holder(request);
  return Response.json({ name: await authorOf(user) }, { headers });
});

/** Set the caller's display name, `{ name }`, and sign their library builds with it; "" resets it. */
export const PUT = route(async (request) => {
  const { user } = holder(request);
  const name = checkedName((await body<{ name?: unknown }>(request)).name, user);
  return Response.json({ name: await setDisplayName(user, name) }, { headers });
});
