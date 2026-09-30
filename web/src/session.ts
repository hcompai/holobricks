import { isSettledSessionStatus, type HaiAgents } from "hai-agents";
import type { Message, Status } from "./model";

export const AGENT = "brickyard";
export const MODEL_FILE = "model.json.gz";

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
  /** Reasoning of the latest step while the builder works. */
  thinking: string;
  state: "running" | "idle" | "awaiting_tool_results";
  /** URL of the model the builder shared last, and how many models it shared up to it. */
  model: { url: string; shared: number } | null;
  /** `look` calls awaiting a render, with how many models were shared when each was made. */
  looks: { call: HaiAgents.ToolRequest; shared: number }[];
  error: string | null;
}

export const EMPTY_TRANSCRIPT: Transcript = {
  events: 0,
  messages: [],
  thinking: "",
  state: "running",
  model: null,
  looks: [],
  error: null,
};

/** An image in event content as a URL: inline ones as data URLs, stored ones as platform URLs that need the API key. */
function picture(item: unknown): string | null {
  if (typeof item === "string") return item.startsWith("data:image/") ? item : null;
  if (typeof item !== "object" || item === null || !("source" in item) || typeof item.source !== "string") return null;
  const { type, source, mediaType } = item as HaiAgents.ImageContent;
  return type === "base64" ? `data:${mediaType ?? "image/png"};base64,${source}` : source;
}

const images = (content: unknown[]) => content.map(picture).filter((src): src is string => src !== null);

const text = (content: unknown[]) =>
  content.filter((item): item is string => typeof item === "string" && !picture(item)).join("\n\n");

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
      return { ...t, state, looks, thinking: state === "running" ? t.thinking : "" };
    }
    case "AttachmentEvent": {
      const { origin, name, url } = (event as HaiAgents.SessionEventZero.AttachmentEvent).data;
      if (origin !== "agent" || name !== MODEL_FILE) return t;
      return { ...t, model: { url, shared: (t.model?.shared ?? 0) + 1 } };
    }
    case "AgentErrorEvent":
      return { ...t, error: (event as HaiAgents.SessionEventZero.AgentErrorEvent).data.error };
    case "AgentEvent":
      break;
    default:
      return t;
  }
  const data = (event as HaiAgents.SessionEventZero.AgentEvent).data;
  const say = (message: Message) => ({ ...t, messages: [...t.messages, message] });
  switch (data.kind) {
    case "message_event": {
      if (data.callerId !== "user") return t;
      return say({ role: "user", text: text(data.content ?? []), images: images(data.content ?? []) });
    }
    case "policy_event": {
      const thinking = data.reasoningContent ?? "";
      const content = data.content?.trim();
      return content ? { ...say({ role: "assistant", text: content, images: [] }), thinking } : { ...t, thinking };
    }
    case "tool_result": {
      const looked = data.toolReq.toolName === "look" ? render(data.result) : null;
      return looked ? say(looked) : t;
    }
    case "answer_event": {
      const answer = typeof data.answer === "string" ? data.answer : JSON.stringify(data.answer);
      return say({ role: "assistant", text: answer, images: [] });
    }
    case "error_event":
      return data.toolReq?.toolName === "look" ? say({ role: "system", text: data.error, images: [] }) : t;
    default:
      return t;
  }
}

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
    return { role: "system", text: `The build stopped: ${error ?? session.replace("_", " ")}.`, images: [] };
  return null;
}
