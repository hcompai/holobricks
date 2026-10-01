import { client, preparedSession, download, initialMessage } from "./agent";
import { buildRevision } from "./buildRevision";
import { remember } from "./library";
import type { Build, Model, Source } from "./model";
import { script } from "./remix";
import { FORK_FILE, unpack } from "./session";

export interface ForkOrigin {
  id: string;
  source: Source;
  name: string;
  version: number | null;
  revision: string;
}
export interface ForkSeed {
  format: 1;
  origin: ForkOrigin;
  model: Model;
}

/** Explicit fields keep chat, private work and attachment URLs out of the fork. */
export function forkSeed(build: Build, origin: ForkOrigin, name: string): ForkSeed {
  const { builder, width, depth, updated, revision, pieces, steps, parts, ldr, bom, shopping } = build;
  return structuredClone({
    format: 1,
    origin,
    model: { name, builder, width, depth, updated, revision, pieces, steps, parts, ldr, bom, shopping },
  });
}

export async function readSeed(blob: Blob): Promise<ForkSeed> {
  const seed = await unpack<ForkSeed>(blob);
  if (
    seed?.format !== 1 ||
    !seed.origin ||
    !["session", "public", "showcase"].includes(seed.origin.source) ||
    typeof seed.origin.id !== "string" ||
    typeof seed.model?.name !== "string" ||
    !Array.isArray(seed.model.steps) ||
    !seed.model.parts ||
    (await buildRevision(seed.model.pieces)) !== seed.model.revision
  )
    throw new Error("The fork's starting model is unavailable.");
  return seed;
}

const seeds = new Map<string, ForkSeed>();
export const cachedSeed = (id: string) => seeds.get(id) ?? null;

/** Initial files are durable even if setup failed before any AttachmentEvent could be emitted. */
export async function requestedSeed(id: string, signal: AbortSignal): Promise<ForkSeed | null> {
  const session = await client.sessions.getSession({ id }, { abortSignal: signal });
  const input = session.request.messages;
  const messages = typeof input === "object" && input ? (Array.isArray(input) ? input : [input]) : [];
  const file = messages.flatMap((m) => m.files ?? []).find((f) => f.name === FORK_FILE);
  if (!file) return null;
  return readSeed(
    file.type === "url"
      ? await download(file.source, signal)
      : await fetch(`data:application/gzip;base64,${file.source}`).then((r) => r.blob()),
  );
}

/** An ambiguous POST may already have started Holo. Check that same operation; never repeat its POST. */
export function forkOperation() {
  const group = `fork-${crypto.randomUUID()}`;
  let sent = false;
  let pending: Promise<string> | null = null;
  let accepted: string | null = null;
  let seed: ForkSeed;
  let prompt: string;
  const find = async () => {
    const attempts = await client.sessions.listSessions({ groupId: group, size: 100 });
    return attempts.items[0]?.id ?? null;
  };
  const finish = (id: string) => {
    accepted = id;
    seeds.set(id, seed);
    remember(id, { name: seed.model.name, prompt, pieces: seed.model.pieces.length });
    return id;
  };
  return (selected: ForkSeed, text: string, photos: string[]): Promise<string> => {
    if (accepted) return Promise.resolve(accepted);
    if (pending) return pending;
    const run = async () => {
      if (sent) {
        const id = await find().catch(() => null);
        if (id) return finish(id);
        throw new Error("Start unconfirmed. Check again before creating another fork.");
      }
      seed = selected;
      prompt = text;
      const json = new Blob([JSON.stringify(seed)], { type: "application/json" });
      const packed = await new Response(json.stream().pipeThrough(new CompressionStream("gzip"))).blob();
      const first = await initialMessage(text, photos, {
        [FORK_FILE]: packed,
        "remix.py": new Blob([script(seed.model)], { type: "text/x-python" }),
      });
      const submit = preparedSession([first], group);
      sent = true;
      try {
        return finish(await submit());
      } catch (e) {
        // A definite client refusal did not create a session. Preparation and these refusals are safe to retry.
        const code = (e as { statusCode?: number }).statusCode;
        if (code && [400, 401, 403, 413, 422, 429].includes(code)) sent = false;
        if (sent) {
          const id = await find().catch(() => null);
          if (id) return finish(id);
          throw new Error("Start unconfirmed. Check again before creating another fork.");
        }
        throw new Error("Couldn't start the fork. Try again.");
      }
    };
    pending = run().finally(() => {
      pending = null;
    });
    return pending;
  };
}
