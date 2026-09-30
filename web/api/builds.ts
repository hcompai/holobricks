import { gzipSync } from "node:zlib";
import { holder, isAdmin } from "./lib/account";
import { body, Refusal, route } from "./lib/http";
import { snapshot } from "./lib/snapshot";
import { enter, files, find, library, type Published, save, unlist } from "./lib/store";

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

/** The public library, or one public build with `?id=`. */
export const GET = route(async (request) => {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json(await library(), { headers: SHARED });
  const published = await find(buildId(id));
  if (!published) throw new Refusal(404, "This build is not public.");
  return Response.json(published, { headers: SHARED });
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

/** Take a build out of the library: its author, or an admin. */
export const DELETE = route(async (request) => {
  const { user } = holder(request);
  const id = buildId(new URL(request.url).searchParams.get("id"));
  const published = await find(id);
  if (!published) throw new Refusal(404, "This build is not public.");
  if (published.owner !== user.id && !isAdmin(user)) throw new Refusal(403, "Only its author can unpublish a build.");
  await unlist(id);
  return new Response(null, { status: 204 });
});
