import { H } from "../src/hosts";
import { cookie, HANDOFF, HANDOFF_S, type Handoff, local, PENDING, type Pending, setCookie } from "../src/signin";
import { admit, pass } from "./lib/account";
import { Refusal } from "./lib/http";
import { mint, revoke, whoami } from "./lib/portal";

function pending(header: string | null): Pending {
  try {
    const { previous, back } = JSON.parse(cookie(header, PENDING) ?? "{}");
    return { previous: typeof previous === "string" ? previous : null, back: local(back) };
  } catch {
    return { previous: null, back: "/" };
  }
}

async function signIn(request: Request, previous: string | null): Promise<Handoff> {
  if (new URL(request.url).searchParams.has("error")) throw new Refusal(401, "The Google sign-in failed: try again.");
  const access = cookie(request.headers.get("cookie"), H.token);
  if (!access) throw new Refusal(401, "The H sign-in did not reach Brickyard: try again.");
  const user = admit(await whoami(access));
  if (previous) await revoke(access, previous);
  const key = await mint(access);
  const expires = Date.parse(`${key.expires}T23:59:59Z`) / 1000;
  return { user, key: key.key, keyId: key.id, expires, pass: pass(user, expires, key.key) };
}

/**
 * Where the portal's Google sign-in comes back to, with its access token in a cookie on the parent domain: mint
 * a Brickyard key for the Agents API and a pass for this API, both good for a month, revoke the browser's previous
 * key, and hand them to the page the user left from.
 */
export async function GET(request: Request): Promise<Response> {
  const { previous, back } = pending(request.headers.get("cookie"));
  let handoff: Handoff;
  try {
    handoff = await signIn(request, previous);
  } catch (e) {
    if (!(e instanceof Refusal)) console.error(e);
    handoff = { error: e instanceof Refusal ? e.message : "Something went wrong on our side: try again." };
  }
  const headers = new Headers({ Location: back, "Cache-Control": "no-store" });
  headers.append("Set-Cookie", setCookie(HANDOFF, JSON.stringify(handoff), HANDOFF_S));
  headers.append("Set-Cookie", setCookie(PENDING, "", 0, "/api/session"));
  return new Response(null, { status: 303, headers });
}
