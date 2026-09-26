"""The bricks CLI: an agent's hands on a live build, from a shell in its own workspace."""

from __future__ import annotations

import argparse
import base64
import os
import sys
from pathlib import Path

import httpx

TIMEOUT_S = 300
ATTACHED = 2
"""Images marked `@@attach` in the output, which sagent shows the agent with the command's result."""


def call(tool: str, **args: object) -> dict:
    url = os.environ.get("BRICKYARD_URL", "http://127.0.0.1:8000")
    build = os.environ.get("BRICKYARD_BUILD")
    if not build:
        sys.exit("Set BRICKYARD_BUILD to the id of the build to work on.")
    response = httpx.post(f"{url}/api/builds/{build}/tools/{tool}", json=args, timeout=TIMEOUT_S)
    if response.is_error:
        sys.exit(f"bricks {tool} failed ({response.status_code}): {response.text}")
    return response.json()


def save(images: list[dict], stem: str, numbered: bool = False) -> list[str]:
    """Numbered images count on from the ones saved before, so earlier ones keep their names."""
    names = []
    first = len(list(Path().glob(f"{stem}-*"))) + 1
    for n, image in enumerate(images, first):
        suffix = f"-{n}" if numbered else ""
        name = f"{stem}{suffix}.{image['mime'].split('/')[-1].replace('jpeg', 'jpg')}"
        Path(name).write_bytes(base64.b64decode(image["data"]))
        names.append(name)
    return names


def main() -> None:
    parser = argparse.ArgumentParser(prog="bricks", description=__doc__)
    tools = parser.add_subparsers(dest="tool", required=True)
    tools.add_parser("run", help="rebuild the model from a build script; saves render.png").add_argument(
        "script", nargs="?", default="build.py"
    )
    look = tools.add_parser(
        "look", help="render the model in the four views, saved as render.png, or from one camera, saved as view-N.png"
    )
    look.add_argument("--angle", type=float, help="seen from: 0 the front, 90 the right, 180 the back, 270 the left")
    look.add_argument("--elevation", type=float, help="degrees above the horizon: 0 eye level, 90 straight down")
    look.add_argument("--zoom", type=float, help="1 frames the whole model, 4 a quarter of its width")
    look.add_argument("--at", type=float, nargs=3, metavar=("X", "Y", "Z"), help="center of the view, studs and plates")
    tools.add_parser("parts", help="search LDraw parts by words or number").add_argument("query")
    tools.add_parser("reference", help="find reference photos of a subject; saves reference-N").add_argument("query")
    tools.add_parser("name", help="name the build").add_argument("name")
    args = parser.parse_args()
    camera = {k: v for k in ("angle", "elevation", "zoom", "at") if (v := getattr(args, k, None)) is not None}

    if args.tool == "run":
        out = call("run", code=Path(args.script).read_text())
    elif args.tool in ("parts", "reference"):
        out = call(args.tool, query=args.query)
    elif args.tool == "name":
        out = call("name", name=args.name)
    else:
        out = call("look", camera=camera) if camera else call("look")
    print(out["text"])
    if out["images"]:
        if args.tool == "reference":
            names = save(out["images"], "reference", numbered=True)
        elif camera:
            names = save(out["images"], "view", numbered=True)
        else:
            names = save(out["images"], "render")
        print(f"\n{out['caption']} Saved in your workspace:")
        for name, image in zip(names, out["images"], strict=True):
            source = f": {image['title']}, from {image['url']}" if image.get("url") else ""
            print(f"- {Path(name).resolve()}{source}")
        for name in names[:ATTACHED]:
            print(f"@@attach {name}")
    sys.exit(1 if out["problems"] else 0)


if __name__ == "__main__":
    main()
