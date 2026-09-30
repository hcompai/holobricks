import { admit, pass } from "./lib/account";
import { body, Refusal, route } from "./lib/http";
import { mint, revoke, whoami } from "./lib/portal";

/**
 * Sign in with the access token the portal's sign-in window handed the page: a Brickyard API key for the
 * Agents API, and a pass for this API, both good for a month. The browser's previous key is revoked.
 */
export const POST = route(async (request) => {
  const { accessToken, previousKey } = await body<{ accessToken?: unknown; previousKey?: unknown }>(request);
  if (typeof accessToken !== "string") throw new Refusal(400, "The portal sign-in is incomplete.");
  const user = admit(await whoami(accessToken));
  if (typeof previousKey === "string") await revoke(accessToken, previousKey);
  const key = await mint(accessToken);
  const expires = Date.parse(`${key.expires}T23:59:59Z`) / 1000;
  return Response.json(
    { user, key: key.key, keyId: key.id, expires, pass: pass(user, expires) },
    { headers: { "Cache-Control": "no-store" } },
  );
});
