import type { Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import type { Model } from "../src/api";

const AGP = "https://agp.eu.hcompany.ai";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const NOW = "2026-01-01T00:00:00Z";

interface Session {
  id: string;
  status: string;
  events: object[];
  shared: number;
}

interface Request {
  method: string;
  path: string;
  body: any;
}

/** The Agents API as the web app sees it, with the events of each session written by the test, in wire format. */
export class Platform {
  readonly sessions = new Map<string, Session>();
  readonly requests: Request[] = [];
  readonly files = new Map<string, Buffer>();
  /** Answer the next session creations with this HTTP status. */
  refuse: number[] = [];
  offline = false;

  session(id: string, status = "running") {
    this.sessions.set(id, { id, status, events: [], shared: 0 });
    return this;
  }

  private push(id: string, type: string, data: object) {
    this.sessions.get(id)!.events.push({ timestamp: NOW, type, data });
  }

  private agent(id: string, data: object) {
    this.push(id, "AgentEvent", data);
  }

  state(id: string, state: string, pending: object[] | null = null) {
    this.sessions.get(id)!.status = state;
    this.push(id, "ActiveStateChangeEvent", { state, pending_tool_calls: pending });
  }

  say(id: string, text: string) {
    this.agent(id, { kind: "message_event", caller_id: "user", content: [text] });
  }

  step(id: string, content: string, reasoning = "") {
    this.agent(id, { kind: "policy_event", reasoning_content: reasoning, content, tool_reqs: [] });
  }

  share(id: string, model: Model) {
    const session = this.sessions.get(id)!;
    const url = `${AGP}/files/${id}/${++session.shared}.gz`;
    this.files.set(url, gzipSync(JSON.stringify(model)));
    this.push(id, "AttachmentEvent", {
      origin: "agent",
      name: "model.json.gz",
      path: "/workspace/model.json.gz",
      media_type: "application/json",
      size_bytes: 0,
      url,
    });
  }

  look(id: string, call: string, args: object = {}) {
    this.state(id, "awaiting_tool_results", [{ tool_name: "look", args, id: call }]);
  }

  answer(id: string, text: string) {
    this.agent(id, { kind: "answer_event", answer: text });
    this.state(id, "idle");
  }

  posted(suffix: string) {
    return this.requests.filter((r) => r.method === "POST" && r.path.endsWith(suffix)).map((r) => r.body);
  }
}

export async function platform(page: Page): Promise<Platform> {
  const agp = new Platform();
  await page.route(`${AGP}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const reply = (status: number, json?: unknown) =>
      route.fulfill({ status, headers: CORS, ...(json === undefined ? { body: "" } : { json }) });
    if (method === "OPTIONS") return reply(204);
    if (agp.files.has(request.url()))
      return route.fulfill({ headers: CORS, contentType: "application/gzip", body: agp.files.get(request.url())! });
    const body = method === "POST" ? request.postDataJSON() : undefined;
    agp.requests.push({ method, path: url.pathname, body });
    const [, , , , id, action] = url.pathname.split("/");
    const session = id ? agp.sessions.get(id) : undefined;

    if (url.pathname === "/api/v2/sessions" && method === "GET") {
      const items = [...agp.sessions.values()].map((s) => ({
        id: s.id,
        agent: "brickyard",
        status: s.status,
        first_message: null,
        created_at: NOW,
      }));
      return reply(200, { items, total: items.length, page: 1 });
    }
    if (url.pathname === "/api/v2/sessions" && method === "POST") {
      const refused = agp.refuse.shift();
      if (refused) return reply(refused, { detail: "The platform is unavailable." });
      agp.session("new-build", "pending");
      return reply(200, { id: "new-build", request: body, status: "pending", created_at: NOW });
    }
    if (!session) return reply(404, { detail: "No such session" });
    if (action === "messages") {
      agp.say(session.id, body.message);
      agp.state(session.id, "running");
      return reply(202);
    }
    if (action === "tool_results" || action === "force_answer") return reply(202);
    if (action === "status") return reply(200, { status: session.status, error: null });
    if (action === "changes") {
      if (agp.offline) return reply(503, { detail: "Unavailable" });
      const from = Number(url.searchParams.get("from_index") ?? 0);
      if (from < session.events.length)
        return reply(200, { status: session.status, error: null, new_events: session.events.slice(from) });
      await new Promise((resolve) => setTimeout(resolve, 200));
      return reply(204);
    }
    return reply(404, { detail: "Not mocked" });
  });
  return agp;
}
