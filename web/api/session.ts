import { H } from "../src/hosts";
import { cookie, HANDOFF, HANDOFF_S, type Handoff, local, PENDING, type Pending, setCookie } from "../src/signin";
import { admit, pass } from "./lib/account";
import { Refusal } from "./lib/http";
import { exchange, mint, revoke, whoami } from "./lib/portal";

const text = (value: unknown) => (typeof value === "string" ? value : null);

const PASSWORD_ACCOUNT = "Your H account uses an email and password: sign in with those below.";

/** What the portal's Google sign-in `error` codes mean to the user. */
const PORTAL_ERRORS = new Map([
  ["non_oauth_user", PASSWORD_ACCOUNT],
  ["user_already_exists", PASSWORD_ACCOUNT],
  ["session_unavailable", "The H portal is busy right now: try again in a minute."],
  ["user_registration_failed", "The H portal could not create your account: try again."],
  ["google_oauth_failed", "Google did not finish the sign-in: try again."],
]);

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
  if (!access) throw new Refusal(401, "The H sign-in did not reach HoloBricks: try again.");
  return access;
}

/** Mint a HoloBricks key for the Agents API and a pass for this API, both good for a month, and revoke the browser's previous key. */
async function signIn(access: string, previous: string | null): Promise<Handoff> {
  const user = admit(await whoami(access));
  if (previous) await revoke(access, previous);
  const key = await mint(access, user.email);
  const expires = Date.parse(`${key.expires.slice(0, 10)}T23:59:59Z`) / 1000;
  return { user, key: key.key, keyId: key.id, expires, pass: pass(user, expires, key.key) };
}

/** Hand the sign-in over to the page the user left from. */
async function handOver(request: Request, signedIn: (left: Pending) => Promise<Handoff>): Promise<Response> {
  const left = pending(request.headers.get("cookie"));
  let handoff: Handoff;
  try {
    handoff = await signedIn(left);
  } catch (e) {
    if (!(e instanceof Refusal)) console.error(e);
    handoff = { error: e instanceof Refusal ? e.message : "Something went wrong on our side: try again." };
  }
  const headers = new Headers({ Location: left.back, "Cache-Control": "no-store" });
  headers.append("Set-Cookie", setCookie(HANDOFF, JSON.stringify(handoff), HANDOFF_S));
  headers.append("Set-Cookie", setCookie(PENDING, "", 0, "/api/session"));
  return new Response(null, { status: 303, headers });
}

/** Where the portal's Google sign-in comes back to, with its access token in a cookie on the parent domain. */
export const GET = (request: Request) =>
  handOver(request, async ({ previous, verifier }) => {
    const error = new URL(request.url).searchParams.get("error");
    if (error !== null) {
      console.warn(`The portal refused a Google sign-in: ${error.slice(0, 64)}`);
      throw new Refusal(401, PORTAL_ERRORS.get(error) ?? "The Google sign-in failed: try again.");
    }
    return signIn(await portalToken(request, verifier), previous);
  });

/** Where this site's own form posts the access token the Platform's login popup sent it, for any sign-in method. */
export const POST = (request: Request) =>
  handOver(request, async ({ previous }) => {
    if (request.headers.get("origin") !== H.site) throw new Refusal(403, "The sign-in did not come from HoloBricks.");
    const access = (await request.formData()).get("access");
    if (typeof access !== "string" || !access)
      throw new Refusal(401, "The H sign-in did not reach HoloBricks: try again.");
    return signIn(access, previous);
  });
