import { client, preparedSession, download, initialMessage } from "./agent";
import { card, remember, linkFork } from "./library";
import { script } from "./remix";
import { FORK_FILE } from "./session";
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
  const find = async () => {
    const attempts = await client.sessions.listSessions({ groupId: group, size: 100 });
    return attempts.items[0]?.id ?? null;
  };
  const finish = (id: string) => {
    accepted = id;
    remember(group, { forkStarting: false });
    seeds.set(id, seed);
    remember(id, { name: seed.model.name, prompt, pieces: seed.model.pieces.length });
    return id;
  };
  return (selected: ForkSeed, text: string, photos: string[]): Promise<string> => {
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

const starts = new Map<string, ReturnType<typeof forkOperation>>();

/** The first ordinary chat message starts Holo; the saved copy keeps its identity. */
export async function startFork(id: string, seed: ForkSeed, text: string, photos: string[]): Promise<string> {
  let operation = starts.get(id);
  if (!operation) starts.set(id, (operation = forkOperation(id)));
  const start = async () => {
    const session = await operation(seed, text, photos);
    await linkFork(id, session);
    return session;
  };
  return navigator.locks ? navigator.locks.request(`brickyard-fork-${id}`, start) : start();
}
