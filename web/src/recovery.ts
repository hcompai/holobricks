import { fileFromBlob, type HaiAgents } from "hai-agents";
import { client, createRecovery, download } from "./agent";
import { buildRevision } from "./buildRevision";
import { remember } from "./library";
import type { Build, Model } from "./model";
import { EMPTY_TRANSCRIPT, read, status, unpack } from "./session";

export const canRestore = (model: Model) =>
  model.recovery?.version === 1 &&
  model.recovery.revision === model.revision &&
  typeof model.recovery.script === "string" &&
  model.recovery.script.trim().length > 0;

const pending = new Map<string, Promise<string>>();
export class RecoveryProblem extends Error {}

async function prepare(build: Build): Promise<string> {
  // Also find an accepted recovery after a reload or a lost creation response.
  const attempts = await client.sessions.listSessions({ groupId: build.id, size: 100 });
  if (attempts.items.length) {
    const existing = attempts.items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0].id;
    remember(build.id, { recoveryAttempt: existing });
    remember(existing, { name: build.name, recoveredFrom: build.id });
    return existing;
  }
  remember(build.id, { recoveryAttempt: undefined });
  let transcript = EMPTY_TRANSCRIPT;
  const seeds = new Map<string, string>();
  for (;;) {
    const changes = await client.sessions.getSessionChanges({
      id: build.id,
      fromIndex: transcript.events,
      includeEvents: true,
    });
    if (changes && status(changes.status) === "building")
      throw new RecoveryProblem("This build is still running. Open it before trying again.");
    const events = changes?.newEvents ?? [];
    if (!events.length) break;
    for (const event of events) {
      if (event.type !== "AttachmentEvent") continue;
      const { origin, name, url } = (event as HaiAgents.SessionEventZero.AttachmentEvent).data;
      if (origin === "user" && (name === "remix.py" || name === "recovery-model.json.gz")) seeds.set(name, url);
    }
    transcript = read(transcript, events);
  }
  const requests = transcript.messages.filter((m) => m.role === "user");
  if (!requests.length)
    throw new RecoveryProblem("The original request is unavailable. Your model has not been changed.");
  const toolkit = await fetch("/brickyard.tgz");
  if (!toolkit.ok)
    throw new RecoveryProblem("The toolkit is unavailable. Try again later; your original build is unchanged.");
  const files = [await fileFromBlob(await toolkit.blob(), "brickyard.tgz")];
  if (canRestore(build)) {
    if (!transcript.model)
      throw new RecoveryProblem("The saved version is unavailable. Your original build is unchanged.");
    const attachment = await download(transcript.model.url);
    const saved = await unpack<Model>(attachment);
    if (
      !canRestore(saved) ||
      saved.revision !== build.revision ||
      (await buildRevision(saved.pieces)) !== saved.revision
    )
      throw new RecoveryProblem("The saved version changed or is incomplete. Reopen this build before continuing.");
    files.push(await fileFromBlob(attachment, "recovery-model.json.gz"));
  } else {
    // A remix or recovery can fail before sharing anything. Keep its original starting model.
    const seed = seeds.has("recovery-model.json.gz") ? "recovery-model.json.gz" : "remix.py";
    const url = seeds.get(seed);
    if (url) {
      try {
        const attachment = await download(url);
        if (seed === "recovery-model.json.gz") {
          const saved = await unpack<Model>(attachment);
          if (!canRestore(saved) || (await buildRevision(saved.pieces)) !== saved.revision) throw new Error();
        }
        files.push(await fileFromBlob(attachment, seed));
      } catch {
        throw new RecoveryProblem(
          "The original starting model could not be retrieved. No new attempt was started. Your original build is unchanged.",
        );
      }
    }
  }
  const messages: HaiAgents.UserMessageEvent[] = [];
  // Fetch every original reference before creating anything. Never silently drop a missing photo.
  for (const [index, request] of requests.entries()) {
    const photos = await Promise.all(
      request.images.map((url) => (url.startsWith("data:") ? fetch(url).then((r) => r.blob()) : download(url))),
    ).catch(() => {
      throw new RecoveryProblem(
        "A reference photo could not be retrieved. No new attempt was started. Try again later; your original model is unchanged.",
      );
    });
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
