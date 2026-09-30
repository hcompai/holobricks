import { H } from "../src/hosts";
import { cookie, HANDOFF, HANDOFF_S, type Handoff, local, PENDING, type Pending, setCookie } from "../src/signin";
import { admit, pass } from "./lib/account";
import { Refusal } from "./lib/http";
import { exchange, mint, revoke, whoami } from "./lib/portal";

const text = (value: unknown) => (typeof value === "string" ? value : null);

function pending(header: string | null): Pending {
  try {
    const { previous, back, verifier } = JSON.parse(cookie(header, PENDING) ?? "{}");
    return { previous: text(previous), back: local(back), verifier: text(verifier) };
  } catch {
    return { previous: null, back: "/", verifier: null };
  }
}

/** The portal's access token: its cookie on the parent domain, or, on a loopback page, traded for the one-time code. */
async function portalToken(request: Request, verifier: string | null): Promise<string> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code && verifier) return exchange(code, verifier, `${url.origin}${url.pathname}`);
  const access = cookie(request.headers.get("cookie"), H.token);
  if (!access) throw new Refusal(401, "The H sign-in did not reach Brickyard: try again.");
  return access;
}

async function signIn(request: Request, { previous, verifier }: Pending): Promise<Handoff> {
  if (new URL(request.url).searchParams.has("error")) throw new Refusal(401, "The Google sign-in failed: try again.");
  const access = await portalToken(request, verifier);
  const user = admit(await whoami(access));
  if (previous) await revoke(access, previous);
  const key = await mint(access, user.email);
  const expires = Date.parse(`${key.expires.slice(0, 10)}T23:59:59Z`) / 1000;
  return { user, key: key.key, keyId: key.id, expires, pass: pass(user, expires, key.key) };
}

/**
 * Where the portal's Google sign-in comes back to, with its access token in a cookie on the parent domain: mint
 * a Brickyard key for the Agents API and a pass for this API, both good for a month, revoke the browser's previous
 * key, and hand them to the page the user left from.
 */
export async function GET(request: Request): Promise<Response> {
  const left = pending(request.headers.get("cookie"));
  let handoff: Handoff;
  try {
    handoff = await signIn(request, left);
  } catch (e) {
    if (!(e instanceof Refusal)) console.error(e);
    handoff = { error: e instanceof Refusal ? e.message : "Something went wrong on our side: try again." };
  }
  const headers = new Headers({ Location: left.back, "Cache-Control": "no-store" });
  headers.append("Set-Cookie", setCookie(HANDOFF, JSON.stringify(handoff), HANDOFF_S));
  headers.append("Set-Cookie", setCookie(PENDING, "", 0, "/api/session"));
  return new Response(null, { status: 303, headers });
}
