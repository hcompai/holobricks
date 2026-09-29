import type { HaiAgents } from "hai-agents";
import { sessions, unavailable } from "./agent";
import type { Build, BuildSummary, Status } from "./api";

const GALLERY = "/gallery";
const STORE = "brickyard.library";

/** What the browser remembers of a session's model, since the platform keeps only its chat. */
interface Card {
  name: string;
  prompt: string;
  pieces: number;
  thumbnail?: string;
}

const cards = (): Record<string, Card> => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}");
  } catch {
    return {};
  }
};

const NEW_CARD: Card = { name: "Untitled build", prompt: "", pieces: 0 };

export const card = (id: string): Card | undefined => cards()[id];

export function remember(id: string, card: Partial<Card>) {
  const all = cards();
  all[id] = { ...NEW_CARD, ...all[id], ...card };
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch (e) {
    console.error("Could not remember the build", e);
  }
}

export function status(session: HaiAgents.TrajectoryStatus): Status {
  if (session === "failed" || session === "timed_out") return "error";
  if (session === "idle" || session === "completed" || session === "interrupted") return "done";
  return "building";
}

interface ShowcaseSummary {
  id: string;
  name: string;
  prompt: string;
  status: Status;
  created: number;
  pieces: number;
  thumbnail: number | null;
}

async function showcases(): Promise<BuildSummary[]> {
  const response = await fetch(`${GALLERY}/builds.json`);
  if (!response.ok || !response.headers.get("content-type")?.includes("json")) return [];
  const summaries: ShowcaseSummary[] = await response.json();
  return summaries.map((s) => ({
    ...s,
    thumbnail: s.thumbnail == null ? null : `${GALLERY}/thumbnails/${s.id}.png?v=${s.thumbnail}`,
    showcase: true,
  }));
}

export async function showcase(id: string): Promise<Build> {
  const response = await fetch(`${GALLERY}/builds/${encodeURIComponent(id)}.json`);
  if (!response.ok) throw new Error(`No showcase ${id}`);
  return { ...(await response.json()), id, open: false };
}

/** The user's builds, newest first, then the showcases. */
export async function library(): Promise<BuildSummary[]> {
  const [mine, shown] = await Promise.all([unavailable ? [] : sessions(), showcases()]);
  const known = cards();
  const builds = mine.map((s): BuildSummary => {
    const saved = known[s.id];
    const prompt = saved?.prompt || s.firstMessage?.message || "";
    return {
      id: s.id,
      name: saved?.name ?? (prompt.slice(0, 60) || NEW_CARD.name),
      prompt,
      status: status(s.status),
      created: s.createdAt.getTime() / 1000,
      pieces: saved?.pieces ?? null,
      thumbnail: saved?.thumbnail ?? null,
      showcase: false,
    };
  });
  return [...builds.sort((a, b) => b.created - a.created), ...shown];
}

const THUMBNAIL_SIDE = 320;

/** A render as a small WebP data URL, to keep beside the build. */
export async function thumbnail(png: Blob): Promise<string> {
  const bitmap = await createImageBitmap(png);
  const scale = Math.min(1, THUMBNAIL_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.8);
}
