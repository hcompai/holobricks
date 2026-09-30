import { fileFromBlob, type HaiAgents } from "hai-agents";
import { client, createRecovery, download } from "./agent";
import { buildRevision } from "./buildRevision";
import { card, remember } from "./library";
import type { Build, Model } from "./model";
import { EMPTY_TRANSCRIPT, read, status, unpack } from "./session";

export const canRestore = (model: Model) =>
  model.recovery?.version === 1 &&
  model.recovery.revision === model.revision &&
  typeof model.recovery.script === "string" &&
  model.recovery.script.trim().length > 0;

const pending = new Map<string, Promise<string>>();

async function prepare(build: Build): Promise<string> {
  const previous = card(build.id)?.recoveryAttempt;
  if (previous) return previous;
  // Also find an accepted recovery after a reload or a lost creation response.
  const attempts = await client.sessions.listSessions({ groupId: build.id, size: 100 });
  if (attempts.items.length) {
    const existing = attempts.items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0].id;
    remember(build.id, { recoveryAttempt: existing });
    remember(existing, { name: build.name, recoveredFrom: build.id });
    return existing;
  }
  let transcript = EMPTY_TRANSCRIPT;
  for (;;) {
    const changes = await client.sessions.getSessionChanges({
      id: build.id,
      fromIndex: transcript.events,
      includeEvents: true,
    });
    if (changes && status(changes.status) === "building")
      throw new Error("This build is still running. Open it before trying again.");
    const events = changes?.newEvents ?? [];
    if (!events.length) break;
    transcript = read(transcript, events);
  }
  const requests = transcript.messages.filter((m) => m.role === "user");
  if (!requests.length) throw new Error("The original request is unavailable. Your model has not been changed.");
  const toolkit = await fetch("/brickyard.tgz");
  if (!toolkit.ok) throw new Error("The toolkit is unavailable. Try again later; your original build is unchanged.");
  const files = [await fileFromBlob(await toolkit.blob(), "brickyard.tgz")];
  if (canRestore(build)) {
    if (!transcript.model) throw new Error("The saved version is unavailable. Your original build is unchanged.");
    const attachment = await download(transcript.model.url);
    const saved = await unpack<Model>(attachment);
    if (
      !canRestore(saved) ||
      saved.revision !== build.revision ||
      (await buildRevision(saved.pieces)) !== saved.revision
    )
      throw new Error("The saved version changed or is incomplete. Reopen this build before continuing.");
    files.push(await fileFromBlob(attachment, "recovery-model.json.gz"));
  }
  const messages: HaiAgents.UserMessageEvent[] = [];
  // Fetch every original reference before creating anything. Never silently drop a missing photo.
  for (const [index, request] of requests.entries()) {
    const photos = await Promise.all(
      request.images.map((url) => (url.startsWith("data:") ? fetch(url).then((r) => r.blob()) : download(url))),
    );
    const images = await Promise.all(
      photos.map(async (blob) => {
        const file = await fileFromBlob(blob, "reference.jpg");
        return `data:${blob.type || "image/jpeg"};base64,${file.source}`;
      }),
    );
    const attached = await Promise.all(
      photos.map((blob, i) => fileFromBlob(blob, `reference-${index + 1}-${i + 1}.jpg`)),
    );
    messages.push({
      type: "user_message",
      message: request.text,
      images,
      files: [...(index === 0 ? files : []), ...attached],
    });
  }
  if (canRestore(build))
    messages.push({
      type: "user_message",
      message:
        "Continue the requests above from the attached recovery-model.json.gz. After setup, restore it with bricks restore, share the restored model and look before editing. Preserve the existing design and continue unfinished work. Do not start over. Temporary files and unshared changes from the previous attempt are not available.",
      images: [],
      files: [],
    });
  const id = await createRecovery(messages, build.id);
  remember(build.id, { recoveryAttempt: id });
  remember(id, { name: build.name, prompt: requests[0].text, recoveredFrom: build.id });
  return id;
}

/** Share a pending request across button clicks; never mutate or restart the failed session. */
export function recover(build: Build): Promise<string> {
  const existing = pending.get(build.id);
  if (existing) return existing;
  const attempt = navigator.locks
    ? navigator.locks.request(`brickyard-recovery-${build.id}`, () => prepare(build))
    : prepare(build);
  const next = attempt.finally(() => pending.delete(build.id));
  pending.set(build.id, next);
  return next;
}
