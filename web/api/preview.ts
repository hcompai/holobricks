import index from "../dist/index.html?raw";
import { H } from "../src/hosts";
import { SHARED } from "./lib/http";
import { find, ID } from "./lib/store";

/** What a link preview shows of a build: never its prompt or its chat. */
interface Card {
  name: string;
  description: string;
  url: string;
  image: string | null;
}

interface Showcase {
  id: string;
  name: string;
  pieces: number;
  thumbnail: number | null;
}

const pieces = (count: number) => `${count.toLocaleString("en-US")} pieces`;
const link = (param: string, id: string) => `${H.site}/?${new URLSearchParams({ [param]: id })}`;
const escaped = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function published(id: string): Promise<Card | null> {
  const build = ID.test(id) ? await find(id) : null;
  return build
    ? {
        name: build.name,
        description: `${pieces(build.pieces)}, shared by ${build.author}`,
        url: link("public", id),
        image: build.thumbnail,
      }
    : null;
}

/** Read from the site's gallery: preview deployments are behind Vercel's protection, the site is not. */
async function showcase(id: string): Promise<Card | null> {
  const response = await fetch(`${H.site}/gallery/builds.json`);
  if (!response.ok) return null;
  const build = ((await response.json()) as Showcase[]).find((s) => s.id === id);
  return build
    ? {
        name: build.name,
        description: `${pieces(build.pieces)}, from the HoloBricks gallery`,
        url: link("showcase", id),
        image: build.thumbnail == null ? null : `${H.site}/gallery/thumbnails/${id}.png?v=${build.thumbnail}`,
      }
    : null;
}

/** index.html with the card's title, description, link and cover in its link preview tags. */
function page(card: Card): string {
  const tags: Record<string, string> = {
    "og:title": `${card.name} · HoloBricks`,
    "og:description": card.description,
    "og:url": card.url,
    ...(card.image ? { "og:image": card.image, "og:image:alt": card.name } : {}),
  };
  let html = index;
  for (const [key, value] of Object.entries(tags))
    html = html.replace(
      new RegExp(`(<meta (?:property|name)="${key}" content=")[^"]*`),
      (_, start: string) => start + escaped(value),
    );
  return card.image ? html.replace(/\s*<meta property="og:image:(?:width|height)"[^>]*>/g, "") : html;
}

/** The app's page for `/?public=<id>` and `/?showcase=<id>`, with a link preview of that build. */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const [id, shown] = [params.get("public"), params.get("showcase")];
  let card: Card | null = null;
  try {
    card = id ? await published(id) : shown ? await showcase(shown) : null;
  } catch (e) {
    console.error("Could not preview the build", e);
  }
  return new Response(card ? page(card) : index, {
    headers: { "Content-Type": "text/html; charset=utf-8", ...SHARED },
  });
}

export const HEAD = GET;
