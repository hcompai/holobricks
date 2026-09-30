import { gzipSync } from "node:zlib";
import { holder, isAdmin } from "./lib/account";
import { body, Refusal, route } from "./lib/http";
import { snapshot } from "./lib/snapshot";
import { enter, files, find, findOwn, library, privateOf, type Published, save, setPrivate, unlist } from "./lib/store";

const ID = /^[\w-]{1,100}$/;
const THUMBNAIL = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/;
const MAX_THUMBNAIL = 512 * 1024;
const SHARED = { "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=60" };

/** Republishing overwrites a build's files in place: its URLs carry the time, past the Blob CDN's cache. */
const versioned = (url: string, at: number) => `${url}?v=${at}`;
const bare = (url: string) => url.split("?")[0];

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

const OWN = { "Cache-Control": "private, no-store" };

/**
 * The public library, or one public build with `?id=`. Signed in, `?mine=1` lists the caller's private builds, and
 * `?id=` also finds one of them.
 */
export const GET = route(async (request) => {
  const params = new URL(request.url).searchParams;
  if (params.has("mine")) return Response.json(await privateOf(holder(request).user.id), { headers: OWN });
  const id = params.get("id");
  if (!id) return Response.json(await library(), { headers: SHARED });
  const shared = await find(buildId(id));
  if (shared) return Response.json(shared, { headers: SHARED });
  const own = request.headers.has("authorization") ? await findOwn(holder(request).user.id, buildId(id)) : null;
  if (!own) throw new Refusal(404, "This build is not public.");
  return Response.json(own, { headers: OWN });
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
  const build = await snapshot(id, key, given.edits, (name, image) => keep(name, image, image.type || "image/png"));
  const coverUrl = cover ? await keep(`thumbnail.${cover.type.split("/")[1]}`, cover.data, cover.type) : null;
  if (!cover && previous?.thumbnail) written.push(bare(previous.thumbnail));
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
    thumbnail: coverUrl ? versioned(coverUrl, at) : (previous?.thumbnail ?? null),
    build: versioned(await keep("build.json.gz", gzipSync(JSON.stringify(build)), "application/gzip"), at),
  };
  await enter(published, before, written);
  return Response.json(published, { status: 201 });
});

/** Take a build out of the library and delete its files: its author, or an admin for a public one. */
export const DELETE = route(async (request) => {
  const { user } = holder(request);
  const id = buildId(new URL(request.url).searchParams.get("id"));
  const published = (await find(id)) ?? (await findOwn(user.id, id));
  if (!published) throw new Refusal(404, "No such build in the library.");
  if (published.owner !== user.id && !isAdmin(user)) throw new Refusal(403, "Only its author can unpublish a build.");
  await unlist(id, published.owner);
  return new Response(null, { status: 204 });
});
