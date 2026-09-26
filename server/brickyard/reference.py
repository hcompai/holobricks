"""Reference photos of real objects, from Wikipedia page images."""

from __future__ import annotations

from dataclasses import dataclass

import httpx

API = "https://en.wikipedia.org/w/api.php"
HEADERS = {"User-Agent": "Brickyard/0.1 (LEGO build demo)"}


@dataclass
class Photo:
    title: str
    data: bytes
    mime: str
    url: str


async def search(query: str, limit: int = 3, size: int = 512) -> list[Photo]:
    params = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrsearch": query,
        "gsrlimit": 8,
        "prop": "pageimages",
        "piprop": "thumbnail",
        "pithumbsize": size,
    }
    async with httpx.AsyncClient(timeout=20, headers=HEADERS, follow_redirects=True) as client:
        pages = (await client.get(API, params=params)).json().get("query", {}).get("pages", {}).values()
        photos = []
        for page in sorted(pages, key=lambda p: p["index"]):
            url = page.get("thumbnail", {}).get("source")
            if not url or len(photos) == limit:
                continue
            image = await client.get(url)
            mime = image.headers.get("content-type", "").split(";")[0]
            if image.status_code == 200 and mime in ("image/jpeg", "image/png", "image/webp"):
                photos.append(Photo(page["title"], image.content, mime, url))
        return photos
