import { isSettledSessionStatus, type HaiAgents } from "hai-agents";
import { doing, PHASES } from "./activity";
import { inspected } from "./look";
import type { Message, RenderRequest, Status, Work } from "./model";

export const AGENT = "brickyard";
export const MODEL_FILE = "model.json.gz";
export const FORK_FILE = "brickyard-fork.json.gz";

export interface ModelAttachment {
  url: string;
  at: string;
}

/** JSON from a file, gunzipped when it is gzipped. */
export async function unpack<T>(blob: Blob): Promise<T> {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const gzipped = head[0] === 0x1f && head[1] === 0x8b;
  const stream = gzipped ? blob.stream().pipeThrough(new DecompressionStream("gzip")) : blob.stream();
  return JSON.parse(await new Response(stream).text());
}
/** The builder's side of a session, read from its events in order. */
export interface Transcript {
  events: number;
  messages: Message[];
  /** The builder's work since its last message. */
  work: Work | null;
  /** The phase of the build the builder is in, as the chat names it. */
  phase: string;
  /** When `phase` began, in ms since the epoch. */
  since: number;
  state: "running" | "idle" | "awaiting_tool_results";
  /** URL of the model the builder shared last, and how many models it shared up to it. */
  model: { url: string; shared: number } | null;
  models: ModelAttachment[];
  fork: string | null;
  /** `look` calls awaiting a render, with how many models were shared when each was made. */
  looks: { call: HaiAgents.ToolRequest; shared: number }[];
  /** The last successful inspection, with the public result's revision prefix. */
  inspection: RenderRequest | null;
  references: Reference[];
  parts: StudyPart[];
  title: string | null;
  error: string | null;
}

export const EMPTY_TRANSCRIPT: Transcript = {
  events: 0,
  messages: [],
  work: null,
  phase: PHASES.idea,
  since: 0,
  state: "running",
  model: null,
  models: [],
  fork: null,
  looks: [],
  inspection: null,
  references: [],
  parts: [],
  title: null,
  error: null,
};

/** An image in event content as a URL: inline ones as data URLs, stored ones as platform URLs that need the API key. */
function picture(item: unknown): string | null {
  if (typeof item === "string") return item.startsWith("data:image/") ? item : null;
  if (typeof item !== "object" || item === null) return null;
  const value = item as Record<string, unknown>;
  // Tool results are opaque JSON: nested images keep the workstation's snake_case keys.
  const mime = String(value.mediaType ?? value.media_type ?? value.mimeType ?? "image/png");
  if (!mime.startsWith("image/")) return null;
  if (value.type === "image" && typeof value.data === "string") return `data:${mime};base64,${value.data}`;
  if (typeof value.source !== "string") return null;
  if (value.type === "base64") return `data:${mime};base64,${value.source}`;
  if (value.type === "url" && /^(https?:\/\/|data:image\/)/.test(value.source)) return value.source;
  return null;
}

const images = (content: unknown[]) => content.map(picture).filter((src): src is string => src !== null);

const text = (content: unknown[]) =>
  content.filter((item): item is string => typeof item === "string" && !picture(item)).join("\n\n");

/** The image content shapes returned by view_image, including structured and MCP results. */
function resultImages(value: unknown, depth = 0): string[] {
  const src = picture(value);
  if (src) return [src];
  if (depth > 5 || !value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => resultImages(item, depth + 1));
  const object = value as Record<string, unknown>;
  return ["content", "image", "images", "result"].flatMap((key) => resultImages(object[key], depth + 1));
}

function resultText(value: unknown): string {
  if (typeof value === "string") return picture(value) ? "" : value;
  if (Array.isArray(value)) return value.map(resultText).join("\n");
  if (!value || typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  return ["text", "stdout", "output", "content"].map((key) => resultText(object[key])).join("\n");
}

export interface StudyPart {
  id: string;
  title: string;
}

export interface Reference {
  id: string;
  src: string;
  caption: string;
  kind: "photo" | "showcase" | "attachment";
}

function references(t: Transcript, added: Reference[]): Transcript {
  const next = [...t.references];
  for (const reference of added) {
    const existing = next.findIndex((r) => r.id === reference.id || r.src === reference.src);
    if (existing >= 0) next[existing] = reference;
    else next.push(reference);
  }
  return { ...t, references: next.slice(-8) };
}

/** A `look` result as the chat shows it: its caption and the render. */
function render(result: unknown): Message | null {
  return Array.isArray(result) ? { role: "tool", text: text(result), images: images(result) } : null;
}

function step(t: Transcript, event: HaiAgents.SessionEvent): Transcript {
  switch (event.type) {
    case "ActiveStateChangeEvent": {
      const { state, pendingToolCalls } = (event as HaiAgents.SessionEventZero.ActiveStateChangeEvent).data;
      const pending = (pendingToolCalls ?? []).filter((c) => c.toolName === "look");
      const shared = t.model?.shared ?? 0;
      const looks = pending.map((call) => t.looks.find((l) => l.call.id === call.id) ?? { call, shared });
      return { ...t, state, looks, inspection: state === "running" && t.state === "idle" ? null : t.inspection };
    }
    case "AttachmentEvent": {
      const { origin, name, url } = (event as HaiAgents.SessionEventZero.AttachmentEvent).data;
      if (origin === "user" && name === FORK_FILE) return { ...t, fork: t.fork ?? url };
      if (origin !== "agent") return t;
      if (/\.(jpe?g|png|webp)$/i.test(name))
        return references(t, [{ id: name, src: url, caption: name, kind: "photo" }]);
      if (name !== MODEL_FILE) return t;
      return {
        ...t,
        model: { url, shared: (t.model?.shared ?? 0) + 1 },
        models: [...t.models, { url, at: event.timestamp.toISOString() }],
      };
    }
    case "AgentErrorEvent":
      return { ...t, error: (event as HaiAgents.SessionEventZero.AgentErrorEvent).data.error };
    case "AgentEvent":
      break;
    default:
      return t;
  }
  const data = (event as HaiAgents.SessionEventZero.AgentEvent).data;
  const at = new Date(event.timestamp).getTime();
  const say = (message: Message) => ({ ...t, messages: [...t.messages, message] });
  /** Holo's message, carrying the work that led to it. */
  const fresh: Work = { start: at, end: at, steps: [] };
  const speak = (from: Transcript, text: string): Transcript => ({
    ...from,
    messages: [
      ...from.messages,
      { role: "assistant", text, images: [], ...(from.work?.steps.length ? { work: from.work } : {}) },
    ],
    work: fresh,
  });
  switch (data.kind) {
    case "message_event": {
      if (data.callerId !== "user") return t;
      const said = say({ role: "user", text: text(data.content ?? []), images: images(data.content ?? []) });
      const phase = t.messages.some((m) => m.role === "user") ? PHASES.message : PHASES.idea;
      return { ...said, since: at, phase, work: t.work?.steps.length ? t.work : fresh };
    }
    case "policy_event": {
      const calls = (data.toolReqs ?? []).filter((c) => c.toolName !== "answer");
      const done = calls.map(doing);
      const reasoning = data.reasoningContent?.trim() ?? "";
      const previous = t.work ?? fresh;
      const steps =
        reasoning || calls.length
          ? [...previous.steps, { reasoning, actions: done.map((d) => d.label) }]
          : previous.steps;
      const phase = done.find((d) => d.phase)?.phase ?? t.phase;
      const since = phase === t.phase ? t.since : at;
      const next = { ...t, phase, since, work: { ...previous, end: at, steps } };
      const content = data.content?.trim();
      return content ? speak(next, content) : next;
    }
    case "tool_result": {
      const looked = data.toolReq.toolName === "look" ? render(data.result) : null;
      if (looked)
        return { ...say(looked), inspection: inspected(data.toolReq.id, data.toolReq.args, looked) ?? t.inspection };
      const { toolName, args = {}, id } = data.toolReq;
      if (toolName === "view_image" || toolName === "web_search") {
        const path = String(args.path ?? args.file_path ?? args.source ?? "");
        const name = path.split("/").pop();
        return references(
          t,
          resultImages(data.result).map((src, index) => ({
            id: `${name || id || "reference"}${index ? `-${index}` : ""}`,
            src,
            caption: name || "Search reference",
            kind: path.includes("showcase/") ? "showcase" : "photo",
          })),
        );
      }
      if (toolName === "shell") {
        const output = resultText(data.result);
        const title = output.match(/Build is now called '([^\n]+)'\./)?.[1] ?? t.title;
        const parts = /\bbricks parts\b/.test(String(args.command))
          ? [...output.matchAll(/^([\w.-]+): ([^|\n]+)\s*\|/gm)]
              .slice(0, 6)
              .map(([, id, title]) => ({ id, title: title.trim() }))
          : t.parts;
        return { ...t, title, parts };
      }
      return t;
    }
    case "answer_event": {
      const answer = (typeof data.answer === "string" ? data.answer : JSON.stringify(data.answer)).trim();
      const last = t.messages.at(-1);
      // A step with a message but no tool call is refused, and Holo often answers with that same message.
      if (last?.role !== "assistant" || last.text !== answer) return speak(t, answer);
      const extra = t.work?.steps ?? [];
      if (!extra.length) return { ...t, work: fresh };
      const work = {
        start: last.work?.start ?? t.work!.start,
        end: at,
        steps: [...(last.work?.steps ?? []), ...extra],
      };
      return { ...t, messages: [...t.messages.slice(0, -1), { ...last, work }], work: fresh };
    }
    case "error_event":
      return data.toolReq?.toolName === "look" ? say({ role: "system", text: data.error, images: [] }) : t;
    default:
      return t;
  }
}

/** What the builder is doing now, while it builds. */
export interface Activity {
  label: string;
  /** In ms since the epoch. */
  since: number;
  /** Its work since its last message. */
  work: Work | null;
  references?: Reference[];
  parts?: StudyPart[];
  title?: string | null;
}

export const activity = (t: Transcript): Activity => ({
  references: t.references,
  parts: t.parts,
  title: t.title,
  label: t.phase,
  since: t.since,
  work: t.work?.steps.length ? t.work : null,
});

export function read(t: Transcript, events: HaiAgents.SessionEvent[]): Transcript {
  return { ...events.reduce(step, t), events: t.events + events.length };
}

export function status(session: HaiAgents.TrajectoryStatus): Status {
  if (session === "failed" || session === "timed_out") return "error";
  return isSettledSessionStatus(session) ? "done" : "building";
}

/** The chat's last line once the session stopped on its own terms, if it needs one. */
export function ending(session: HaiAgents.TrajectoryStatus, error: string | null): Message | null {
  if (session === "interrupted") return { role: "system", text: "Stopped.", images: [] };
  if (status(session) === "error")
    return {
      role: "system",
      text:
        session === "timed_out"
          ? "This attempt reached its time limit. You can try continuing below."
          : error?.includes("CodeSandboxGoneError") || error?.includes("CodeSandboxRestartedError")
            ? "The building service stopped unexpectedly. You can try continuing below."
            : "Building was interrupted. You can try again below.",
      images: [],
    };
  return null;
}
