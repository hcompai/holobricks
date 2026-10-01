import { assertRequestUnderLimit, fileFromBlob, HaiAgentsClient, type HaiAgents } from "hai-agents";
import prompt from "../../agent/holo.md?raw";
import { expired, key } from "./account";
import { H } from "./hosts";
import type { Build } from "./model";
import { script } from "./remix";
import { AGENT } from "./session";
const MODEL = "holo4-27b";
const MAX_STEPS = 300;
const MAX_TIME_S = 3 * 3600;
/** How long a finished build keeps its Workstation for a follow-up message. */
const IDLE_TIMEOUT_S = 3600;
const TOOLKIT = "/brickyard.tgz";
const DOWNLOAD_S = 60;

/** A call to the Agents API; a refused key signs the user out. */
async function call(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401) expired();
  return response;
}

export const client = new HaiAgentsClient({
  environment: H.agents,
  apiKey: key,
  headers: { "X-HCompany-Client-Name": AGENT },
  // Safari sends the SDK's User-Agent in CORS preflights, and the Agents API does not allow it.
  fetch: (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("User-Agent");
    return call(input, { ...init, headers });
  },
});

const LOOK: HaiAgents.ToolDefinition = {
  name: "look",
  description:
    "Render the model you last shared, in the user's viewer, and return its revision, its piece count and the image. " +
    "No arguments: the four views, 3/4 front-right, 3/4 back-left, front, and top (back at the top). " +
    "`angle` gives one large view instead, `box` keeps only the pieces inside it.",
  inputSchema: {
    type: "object",
    properties: {
      angle: {
        type: "number",
        description: "Compass degrees around the model: 0 front, 90 right, 180 back, 270 left.",
      },
      elevation: { type: "number", minimum: 0, maximum: 90, description: "Degrees above the horizon, default 30." },
      zoom: { type: "number", minimum: 1, maximum: 16, description: "Magnification, default 1." },
      at: {
        type: "array",
        items: { type: "number" },
        minItems: 3,
        maxItems: 3,
        description: "[x, y, z], the point at the center of the view: x and y in studs, z in plates.",
      },
      box: {
        type: "array",
        items: { type: "integer" },
        minItems: 6,
        maxItems: 6,
        description: "[x0, y0, z0, x1, y1, z1], studs and plates, all included: only the pieces inside it.",
      },
    },
    additionalProperties: false,
  },
};

function agent(): HaiAgents.Agent {
  const instructions = prompt
    .replace("{{date}}", new Date().toISOString().slice(0, 10))
    .replace("{{max_steps}}", String(MAX_STEPS))
    .replaceAll("{{max_minutes}}", String(MAX_TIME_S / 60));
  return {
    name: AGENT,
    description: "Designs brick models from real LDraw parts, step by step, in HoloBricks.",
    model: MODEL,
    instructions,
    environments: [{ kind: "workstation", id: AGENT }],
    tools: [LOOK],
  };
}

/** A message with the `attached` files, then its photos as `prefix-N.jpg`, so later photos never overwrite earlier ones. */
async function message(
  text: string,
  photos: string[],
  attached: Record<string, Blob>,
  prefix = "photo",
): Promise<HaiAgents.UserMessageEvent & { type: "user_message" }> {
  const blobs = await Promise.all(photos.map((src) => fetch(src).then((r) => r.blob())));
  const files = await Promise.all([
    ...Object.entries(attached).map(([name, blob]) => fileFromBlob(blob, name)),
    ...blobs.map((blob, i) => fileFromBlob(blob, `${prefix}-${i + 1}.jpg`)),
  ]);
  return { type: "user_message", message: text, images: photos, files };
}

/** Start a build with its first message: the toolkit, `attached` and the photos. */
export async function create(text: string, photos: string[], attached: Record<string, Blob> = {}): Promise<string> {
  const first = await initialMessage(text, photos, attached);
  const session = await client.startSession({
    agent: agent(),
    messages: [first],
    maxSteps: MAX_STEPS,
    maxTimeS: MAX_TIME_S,
    idleTimeoutS: IDLE_TIMEOUT_S,
    deleteAfterMin: null,
  });
  return session.id;
}

export async function initialMessage(text: string, photos: string[], attached: Record<string, Blob>) {
  const toolkit = await fetch(TOOLKIT);
  if (!toolkit.ok) throw new Error("The HoloBricks toolkit is missing from this site.");
  return message(text, photos, { "brickyard.tgz": await toolkit.blob(), ...attached });
}

/** Continue an ended model with the existing ordinary chat flow. */
export const remix = (build: Build, text: string, photos: string[]) =>
  create(text, photos, { "remix.py": new Blob([script(build)], { type: "text/x-python" }) });

export async function say(id: string, text: string, photos: string[]) {
  await client.session(id).sendMessage(await message(text, photos, {}, `photo-${Date.now()}`));
}

/** Submit recovery inputs with session creation, so there is no empty-session/message gap. */
export async function createRecovery(messages: HaiAgents.UserMessageEvent[], source: string): Promise<string> {
  return preparedSession(messages, source)();
}

/** Validate before a caller records that a side-effecting request was sent. */
export function preparedSession(messages: HaiAgents.UserMessageEvent[], source: string): () => Promise<string> {
  const request = {
    agent: agent(),
    messages,
    maxSteps: MAX_STEPS,
    maxTimeS: MAX_TIME_S,
    idleTimeoutS: IDLE_TIMEOUT_S,
    deleteAfterMin: null,
    groupId: source,
  };
  assertRequestUnderLimit(request);
  // Creating a run is a side effect: never retry an ambiguous response automatically.
  return async () => (await client.sessions.createSession({ body: request }, { maxRetries: 0 })).id;
}

/** Holo ends its current step and answers; the session stays open for the next message. */
export const stop = (id: string) => client.session(id).forceAnswer();

/** Read the caller's existing run for a copy; never start a new one while reopening it. */
export async function forkSession(groupId: string): Promise<string | null> {
  const { items } = await client.sessions.listSessions({ owner: "me", groupId, size: 100 });
  return items[0]?.id ?? null;
}

/** The caller's own HoloBricks sessions, newest first. */
export async function sessions(): Promise<HaiAgents.SessionSummary[]> {
  const all: HaiAgents.SessionSummary[] = [];
  for (let page = 1; ; page++) {
    // hai-agents 1.0.12 sends the `agent` list as a JSON string, which matches no session.
    const { items, total } = await client.sessions.listSessions(
      { owner: "me", page, size: 100 },
      { queryParams: { agent: AGENT } },
    );
    all.push(...items);
    if (!items.length || all.length >= total) return all;
  }
}

/** An attachment or image the platform serves behind the API key. */
export async function download(url: string, signal?: AbortSignal): Promise<Blob> {
  const timeout = AbortSignal.timeout(DOWNLOAD_S * 1000);
  const response = await call(url, {
    headers: { Authorization: `Bearer ${key()}` },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status})`);
  return response.blob();
}

export async function answer(id: string, call: HaiAgents.ToolRequest, result: unknown) {
  await client.sessions.sendSessionToolResults({ id, body: { kind: "tool_result", toolReq: call, result } });
}

export async function fail(id: string, call: HaiAgents.ToolRequest, error: string) {
  await client.sessions.sendSessionToolResults({
    id,
    body: { kind: "error_event", error, origin: "client", toolReq: call },
  });
}
