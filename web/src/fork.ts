import { client, preparedSession, download, initialMessage, forkSession } from "./agent";
import { card, remember, linkFork } from "./library";
import { script } from "./remix";
import { FORK_FILE } from "./session";
import { track } from "./analytics";
import { readSeed, type ForkSeed } from "./forkModel";
export { forkSeed, readSeed, type ForkSeed, type ForkOrigin } from "./forkModel";

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
export function forkOperation(group = `fork-${crypto.randomUUID()}`) {
  let sent = false;
  let pending: Promise<string> | null = null;
  let accepted: string | null = null;
  let seed: ForkSeed;
  let prompt: string;
  const find = () => forkSession(group);
  const finish = (id: string) => {
    accepted = id;
    remember(group, { forkStarting: false });
    seeds.set(id, seed);
    remember(id, { name: seed.model.name, prompt, pieces: seed.model.pieces.length });
    return id;
  };
  return (selected: ForkSeed, text: string, photos: string[], attached: Record<string, Blob> = {}): Promise<string> => {
    if (accepted) return Promise.resolve(accepted);
    if (pending) return pending;
    const run = async () => {
      seed = selected;
      prompt = text;
      if (sent || card(group)?.forkStarting) {
        const id = await find().catch(() => null);
        if (id) return finish(id);
        throw new Error("Start unconfirmed. Send again to check.");
      }
      const existing = await find();
      if (existing) return finish(existing);
      const json = new Blob([JSON.stringify(seed)], { type: "application/json" });
      const packed = await new Response(json.stream().pipeThrough(new CompressionStream("gzip"))).blob();
      const first = await initialMessage(text, photos, {
        ...attached,
        [FORK_FILE]: packed,
        "remix.py": new Blob([script(seed.model)], { type: "text/x-python" }),
      });
      const submit = preparedSession([first], group);
      sent = true;
      remember(group, { forkStarting: true });
      try {
        return finish(await submit());
      } catch (e) {
        // A definite client refusal did not create a session. Preparation and these refusals are safe to retry.
        const code = (e as { statusCode?: number }).statusCode;
        if (code && [400, 401, 403, 413, 422, 429].includes(code)) {
          sent = false;
          remember(group, { forkStarting: false });
        }
        if (sent) {
          const id = await find().catch(() => null);
          if (id) return finish(id);
          throw new Error("Start unconfirmed. Send again to check.");
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

const starts = new Map<string, { run: ReturnType<typeof forkOperation> }>();

/** The first ordinary chat message starts Holo; the saved copy keeps its identity. */
export async function startFork(
  id: string,
  seed: ForkSeed,
  text: string,
  photos: string[],
  attached: Record<string, Blob> = {},
): Promise<string> {
  if (!/^fork-[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid copy.");
  let operation = starts.get(id);
  if (!operation) starts.set(id, (operation = { run: forkOperation(id) }));
  const start = async () => {
    const session = await operation.run(seed, text, photos, attached);
    await linkFork(id, session);
    track("build_forked");
    return session;
  };
  return navigator.locks ? navigator.locks.request(`brickyard-fork-${id}`, start) : start();
}
