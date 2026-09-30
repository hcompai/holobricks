import { expect, test } from "@playwright/test";
import { GET } from "../api/session";
import { H } from "../src/hosts";
import { cookie, HANDOFF, PENDING } from "../src/signin";

process.env.BRICKYARD_SECRET = "test-secret";

const TOKEN = `h.${Buffer.from(JSON.stringify({ access: { org_id: "org-1" } })).toString("base64url")}.s`;

/** The portal, vouching for `email`; returns the calls it got. */
function portal(email: string) {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url.replace(H.portal, "")}`);
    if (url.endsWith("/auth/me")) return Response.json({ user: { id: "u-1", email } });
    if (init?.method === "POST") return Response.json({ id: "key-2", key: "hk-new", expires_at: "2026-10-30" });
    return new Response(null, { status: 204 });
  };
  return { calls, restore: () => void (globalThis.fetch = real) };
}

async function comeBack(cookies: Record<string, string>) {
  const header = Object.entries(cookies)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("; ");
  const response = await GET(new Request("https://bricks.test/api/session", { headers: { cookie: header } }));
  const handed = response.headers.getSetCookie().find((c) => c.startsWith(`${HANDOFF}=`))!;
  return { response, handoff: JSON.parse(cookie(handed.split(";")[0], HANDOFF)!) };
}

test("the portal's Google sign-in comes back as a key and a pass for H accounts only, where the user left", async () => {
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

  const outsider = portal("ada@example.com");
  try {
    const { response, handoff } = await comeBack({ [H.token]: TOKEN, [PENDING]: '{"back": "//evil.test"}' });
    expect(response.headers.get("location")).toBe("/");
    expect(handoff).toEqual({ error: "Brickyard is open to H Company accounts." });
    expect(outsider.calls).toEqual(["GET /auth/me"]);
    expect((await comeBack({})).handoff).toEqual({ error: "The H sign-in did not reach Brickyard: try again." });
  } finally {
    outsider.restore();
  }
});
