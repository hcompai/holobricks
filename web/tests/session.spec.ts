import { expect, test } from "@playwright/test";
import { admit } from "../api/lib/account";
import { GET } from "../api/session";
import { H } from "../src/hosts";
import { cookie, HANDOFF, PENDING } from "../src/signin";
import { blobStore } from "./blobStore";

process.env.BRICKYARD_SECRET = "test-secret";
const blob = blobStore();
test.beforeAll(() => blob.start());
test.afterAll(() => blob.stop());

const TOKEN = `h.${Buffer.from(JSON.stringify({ access: { org_id: "org-1" } })).toString("base64url")}.s`;

const LOCAL = "http://127.0.0.1:5173";
const keyNames = new Set<string>();

/** The portal, vouching for `email`, with key names unique across the organization; returns the calls it got. */
function portal(email: string) {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url.replace(H.portal, "")}`);
    if (url.endsWith("/auth/me")) return Response.json({ user: { id: "u-1", email } });
    if (url.endsWith("/auth/desktop/exchange")) {
      const { code, code_verifier, redirect_uri } = JSON.parse(String(init!.body));
      const known = code === "one-time" && code_verifier === "verifier" && redirect_uri === `${LOCAL}/api/session`;
      return known ? Response.json({ access_token: TOKEN }) : new Response(null, { status: 401 });
    }
    if (init?.method === "POST") {
      const { name } = JSON.parse(String(init.body));
      if (keyNames.has(name))
        return Response.json({ detail: "An API key with this name already exists" }, { status: 400 });
      keyNames.add(name);
      return Response.json({ id: "key-2", key: "hk-new", expires_at: "2026-10-30" });
    }
    return new Response(null, { status: 204 });
  };
  return { calls, restore: () => void (globalThis.fetch = real) };
}

async function comeBack(cookies: Record<string, string>, url = "https://bricks.test/api/session") {
  const header = Object.entries(cookies)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("; ");
  const response = await GET(new Request(url, { headers: { cookie: header } }));
  const handed = response.headers.getSetCookie().find((c) => c.startsWith(`${HANDOFF}=`))!;
  return { response, handoff: JSON.parse(cookie(handed.split(";")[0], HANDOFF)!) };
}

test("anyone gets in, under a public name that never shows their email", () => {
  const named = (email: string) => admit({ id: "u", email }).name;
  expect(named("jane.doe@hcompany.ai")).toBe("Jane Doe");
  expect(named("jane.doe@gmail.com")).toBe("");
  expect(named("jd1987@gmail.com")).toBe("");
});

test("the portal's Google sign-in comes back as a key and a pass for anyone, where the user left", async () => {
  const pending = JSON.stringify({ previous: "key-1", back: "/?public=tower" });
  const h = portal("jane.doe@hcompany.ai");
  try {
    const { response, handoff } = await comeBack({ [H.token]: TOKEN, [PENDING]: pending });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/?public=tower");
    expect(handoff).toMatchObject({
      user: { id: "u-1", email: "jane.doe@hcompany.ai", name: "Jane Doe" },
      key: "hk-new",
      keyId: "key-2",
      pass: expect.any(String),
    });
    expect(h.calls).toEqual([
      "GET /auth/me",
      "DELETE /organizations/org-1/keys/key-1",
      "POST /organizations/org-1/keys/",
    ]);
  } finally {
    h.restore();
  }

  const colleague = portal("john.roe@hcompany.ai");
  try {
    expect((await comeBack({ [H.token]: TOKEN })).handoff).toMatchObject({ keyId: "key-2" });
  } finally {
    colleague.restore();
  }

  const outsider = portal("ada@example.com");
  try {
    const { response, handoff } = await comeBack({ [H.token]: TOKEN, [PENDING]: '{"back": "//evil.test"}' });
    expect(response.headers.get("location")).toBe("/");
    expect(handoff).toMatchObject({ user: { email: "ada@example.com", name: "" }, key: "hk-new" });
    expect(outsider.calls).toEqual(["GET /auth/me", "POST /organizations/org-1/keys/"]);
    expect((await comeBack({})).handoff).toEqual({ error: "The H sign-in did not reach HoloBricks: try again." });
  } finally {
    outsider.restore();
  }
});

test("a local dev server, which the portal's cookie never reaches, signs in with its one-time code and PKCE verifier", async () => {
  const pending = JSON.stringify({ previous: null, back: "/", verifier: "verifier" });
  const h = portal("jane.doe@hcompany.ai");
  try {
    const signedIn = await comeBack({ [PENDING]: pending }, `${LOCAL}/api/session?code=one-time`);
    expect(signedIn.handoff).toMatchObject({ user: { email: "jane.doe@hcompany.ai" }, key: "hk-new" });
    expect(h.calls).toEqual(["POST /auth/desktop/exchange", "GET /auth/me", "POST /organizations/org-1/keys/"]);
    const replayed = await comeBack({ [PENDING]: pending }, `${LOCAL}/api/session?code=stolen`);
    expect(replayed.handoff).toEqual({ error: "The sign-in expired: try again." });
  } finally {
    h.restore();
  }
});
