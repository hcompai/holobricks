import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { holder, isAdmin } from "./lib/account";
import { body, Refusal, route } from "./lib/http";
import { snapshot } from "./lib/snapshot";
import { projectName } from "./lib/names";
import {
  enter,
  files,
  find,
  findOwn,
  ID,
  library,
  privateOf,
  type Published,
  save,
  setPrivate,
  unlist,
} from "./lib/store";

const THUMBNAIL = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/;
const MAX_THUMBNAIL = 512 * 1024;

/** Republishing overwrites a build's files in place: its URLs carry the time, for browsers' caches. */
const versioned = (url: string, at: number) => `${url}?v=${at}`;
const bare = (url: string) => url.split("?")[0];
/** The Blob CDN ignores query strings, so a thumbnail is named by its content to show a republished one at once. */
const coverName = ({ data, type }: { data: Buffer; type: string }) =>
  `thumbnail-${createHash("sha256").update(data).digest("hex").slice(0, 16)}.${type.split("/")[1]}`;

function buildId(value: unknown): string {
  if (typeof value !== "string" || !ID.test(value)) throw new Refusal(400, "No such build.");
  return value;
}

function thumbnail(value: unknown): { data: Buffer; type: string } | null {
  if (value == null) return null;
  const match = typeof value === "string" ? value.match(THUMBNAIL) : null;
  if (!match) throw new Refusal(400, "The thumbnail is not an image.");
  const data = Buffer.from(match[2], "base64");
  if (data.length > MAX_THUMBNAIL) throw new Refusal(413, "The thumbnail is too large.");
  return { data, type: `image/${match[1]}` };
}

const PRIVATE = { "Cache-Control": "private, no-store" };

/** For signed-in users: the public library, or one build with `?id=` (public or the caller's); `?mine=1` lists the caller's private builds. */
export const GET = route(async (request) => {
  const { user } = holder(request);
  const params = new URL(request.url).searchParams;
  if (params.has("mine")) return Response.json(await privateOf(user.id), { headers: PRIVATE });
  const id = params.get("id");
  if (!id) return Response.json(await library(), { headers: PRIVATE });
  const found = (await find(buildId(id))) ?? (await findOwn(user.id, buildId(id)));
  if (!found) throw new Refusal(404, "This build is not public.");
  return Response.json(found, { headers: PRIVATE });
});

/** Make one of the caller's imported builds private or public again: `{ id, private }`. Its files and link stay the same. */
export const PATCH = route(async (request) => {
  const { user } = holder(request);
  const given = await body<{ id?: unknown; private?: unknown }>(request);
  if (typeof given.private !== "boolean") throw new Refusal(400, "Say whether the build is private.");
  const id = buildId(given.id);
  if (!id.startsWith("import-"))
    throw new Refusal(400, "Only an imported build is kept private; unpublish a session's build.");
  const published = await findOwn(user.id, id);
  if (!published || published.owner !== user.id) throw new Refusal(404, "No such build of yours.");
  await setPrivate(published, given.private);
  return new Response(null, { status: 204 });
});

/** Publish the caller's build, as it is now; publishing again replaces it. */
export const POST = route(async (request) => {
  const { user, key } = holder(request);
  const given = await body<{ id?: unknown; thumbnail?: unknown; edits?: unknown }>(request);
  const id = buildId(given.id);
  const cover = thumbnail(given.thumbnail);
  const previous = await find(id);
  if (previous && previous.owner !== user.id) throw new Refusal(403, "Only its author can publish a build.");

  const before = await files(id);
  const written: string[] = [];
  const keep = async (name: string, data: Blob | Buffer, type: string) => {
    const url = await save(id, name, data, type);
    written.push(url);
    return url;
  };
  const build = await snapshot(
    id,
    key,
    given.edits,
    (name, image) => keep(name, image, image.type || "image/png"),
    user.id,
  );
  build.name = (await projectName(user.id, id))?.name ?? build.name;
  const coverUrl = cover ? await keep(coverName(cover), cover.data, cover.type) : null;
  // The Blob CDN can serve the previous entry for a minute, and with it the previous thumbnail.
  if (previous?.thumbnail) written.push(bare(previous.thumbnail));
  const at = Math.floor(Date.now() / 1000);
  const published: Published = {
    id,
    name: build.name,
    prompt: build.messages.find((m) => m.role === "user")?.text ?? "",
    pieces: build.pieces.length,
    steps: build.steps.length,
    author: user.name,
    owner: user.id,
    published: at,
    thumbnail: coverUrl ?? previous?.thumbnail ?? null,
    build: versioned(await keep("build.json.gz", gzipSync(JSON.stringify(build)), "application/gzip"), at),
  };
  await enter(published, before, written);
  return Response.json(published, { status: 201 });
});

/**
 * Take a build out of the library and delete its files: its author only. An admin can take someone else's build out
 * of the public library to moderate it, but never delete it: it becomes private, kept for its owner.
 */
export const DELETE = route(async (request) => {
  const { user } = holder(request);
  const id = buildId(new URL(request.url).searchParams.get("id"));
  const published = (await find(id)) ?? (await findOwn(user.id, id));
  if (!published) throw new Refusal(404, "No such build in the library.");
  if (published.owner !== user.id) {
    // A private build is found for its owner only, so a moderator only ever reaches a public one here.
    if (!isAdmin(user)) throw new Refusal(403, "Only its author can unpublish a build.");
    await setPrivate(published, true);
    return new Response(null, { status: 204 });
  }
  await unlist(id, published.owner);
  return new Response(null, { status: 204 });
});
