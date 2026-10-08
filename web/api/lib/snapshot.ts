import { HaiAgentsClient, HaiAgentsError, type HaiAgents } from "hai-agents";
import { buildRevision } from "../../src/buildRevision";
import { H } from "../../src/hosts";
import { platformAsset, assetBlob } from "../../src/assetUrl";
import { applyEdits, type Edit, toLdraw } from "../../src/edits";
import { type Build, EMPTY_MODEL, type Model } from "../../src/model";
import { AGENT, EMPTY_TRANSCRIPT, read, status, type Transcript, unpack } from "../../src/session";
import { readFork } from "./forks";
import { Refusal } from "./http";

const EDITED = "Edited by hand after Holo built it: the parts list is not verified.";

const numbers = (value: unknown, n: number) =>
  Array.isArray(value) && value.length === n && value.every(Number.isFinite);

/** Whether `e` is an edit as the browser makes it, by kind. */
function wellFormed(e: any): e is Edit {
  if (!Array.isArray(e?.ids) || !e.ids.every(Number.isInteger)) return false;
  switch (e.kind) {
    case "delete":
      return true;
    case "move":
      return numbers(e.by, 3);
    case "rotate":
      return (e.turns === 1 || e.turns === -1) && numbers(e.about, 2);
    case "color":
      return Number.isInteger(e.color);
    case "duplicate":
      return numbers(e.by, 3) && Number.isInteger(e.first);
    default:
      return false;
  }
}

/** Hand edits as the browser saved them: bound to the revision they were made on. */
export interface Edited {
  revision: string;
  edits: Edit[];
}

const platform = (key: string) =>
  new HaiAgentsClient({
    environment: H.agents,
    apiKey: key,
    headers: { "X-HCompany-Client-Name": AGENT },
  });

const missing = (e: unknown) => e instanceof HaiAgentsError && (e.statusCode === 404 || e.statusCode === 403);

async function mine(agp: HaiAgentsClient, id: string): Promise<HaiAgents.Session> {
  const session = await agp.sessions.getSession({ id }).catch((e) => {
    throw missing(e) ? new Refusal(404, "No such build.") : e;
  });
  const agent = session.request.agent;
  if ((typeof agent === "string" ? agent : agent.name) !== AGENT) throw new Refusal(404, "No such build.");
  // Sessions are readable across an organization; the listing is the caller's own sessions only.
  const at = session.createdAt.getTime();
  const own = await agp.sessions.listSessions({
    createdAfter: new Date(at - 1000),
    createdBefore: new Date(at + 1000),
    size: 100,
  });
  if (!own.items.some((s) => s.id === id)) throw new Refusal(403, "Only its author can publish a build.");
  return session;
}

export const ownedSession = (id: string, key: string) => mine(platform(key), id);

async function transcript(agp: HaiAgentsClient, id: string): Promise<Transcript> {
  let t = EMPTY_TRANSCRIPT;
  for (;;) {
    const changes = await agp.sessions.getSessionChanges({ id, fromIndex: t.events, includeEvents: true });
    const events = changes?.newEvents ?? [];
    if (!events.length) return t;
    t = read(t, events);
  }
}

async function download(url: string, key: string): Promise<Blob> {
  if (!platformAsset(url)) throw new Error("Untrusted attachment URL");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    // The validated platform endpoint redirects to signed storage; fetch drops cross-origin credentials.
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status})`);
  return assetBlob(response);
}

function checked(edited: unknown): Edited | null {
  if (edited == null) return null;
  const { revision, edits } = edited as Edited;
  const valid = typeof revision === "string" && Array.isArray(edits) && edits.every(wellFormed);
  if (!valid) throw new Refusal(400, "The edits are malformed.");
  return edits.length ? { revision, edits } : null;
}

async function withEdits(build: Build, edited: Edited | null): Promise<Build> {
  if (!edited) return build;
  if (edited.revision !== build.revision)
    throw new Refusal(409, "Your edits are for an earlier revision of the model.");
  const pieces = applyEdits(build.pieces, edited.edits);
  return {
    ...build,
    pieces,
    revision: await buildRevision(pieces),
    ldr: toLdraw(build, pieces),
    bom: { error: EDITED },
    shopping: { error: EDITED },
  };
}

/** The caller's finished build as the public sees it: its latest model with any hand edits, and no chat. */
export async function snapshot(id: string, key: string, edited: unknown, owner?: string): Promise<Build> {
  if (id.startsWith("fork-")) {
    const fork = owner ? await readFork(owner, id) : null;
    if (!fork) throw new Refusal(404, "No such build.");
    if (fork.sessionId) return { ...(await snapshot(fork.sessionId, key, edited)), id };
    return withEdits({ ...fork.seed.model, id, status: "done", open: false, messages: [] }, checked(edited));
  }
  const agp = platform(key);
  const session = await mine(agp, id);
  const state = status(session.status.status);
  if (state === "building") throw new Refusal(409, "Holo is still building: publish once it answers.");
  const t = await transcript(agp, id);
  if (!t.model) throw new Refusal(409, "Nothing is built yet.");
  const model = await unpack<Model>(await download(t.model.url, key));
  // A fork's title survives Holo naming the reconstructed model differently.
  const fork = t.fork
    ? await unpack<{ format?: number; model?: { name?: string } }>(await download(t.fork, key))
    : null;
  if (fork?.format === 1 && typeof fork.model?.name === "string" && fork.model.name.trim())
    model.name = fork.model.name.slice(0, 80);
  // Recovery source belongs to the session, not the public library.
  delete model.recovery;
  const prompt = t.messages.find((m) => m.role === "user")?.text ?? "";
  const build: Build = {
    ...model,
    name: model.name !== EMPTY_MODEL.name ? model.name : prompt.slice(0, 60) || model.name,
    id,
    status: state,
    open: false,
    messages: [],
  };
  return withEdits(build, checked(edited));
}
