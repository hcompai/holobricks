"""The bricks CLI: an agent's hands on a live build, from a shell in its own workspace."""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path

import httpx

TIMEOUT_S = 300
ATTACHED = 2
"""Images marked `@@attach` in the output, which sagent shows the agent with the command's result."""
REFERENCE = Path(".brickyard-reference.json")


def reference(path: str | None = None) -> Path | None:
    """Select or read the primary image paired with construction renders across commands."""
    selecting = path is not None
    if path is None:
        if not REFERENCE.exists():
            return None
        saved = json.loads(REFERENCE.read_text())
        if not isinstance(saved, dict) or not isinstance(saved.get("path"), str):
            raise ValueError("Invalid primary reference selection")
        path = saved["path"]
    image = Path(path).resolve()
    if not image.is_file() or image.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
        raise ValueError(f"Reference must be an existing JPEG, PNG or WebP image: {image}")
    if selecting:
        REFERENCE.write_text(json.dumps({"path": str(image)}) + "\n")
    return image


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
        "look",
        help="render the model in the four views (render.png), from one camera (view-N.png), or only a box (closeup-N.png)",
    )
    look.add_argument("box", nargs="*", type=int, metavar="x0 y0 z0 x1 y1 z1", help="only the pieces in this box")
    look.add_argument("--angle", type=float, help="seen from: 0 the front, 90 the right, 180 the back, 270 the left")
    look.add_argument("--elevation", type=float, help="degrees above the horizon: 0 eye level, 90 straight down")
    look.add_argument("--zoom", type=float, help="1 frames the whole model, 4 a quarter of its width")
    look.add_argument("--at", type=float, nargs=3, metavar=("X", "Y", "Z"), help="center of the view, studs and plates")
    tools.add_parser("parts", help="search LDraw parts by words or number").add_argument("query")
    tools.add_parser("colors", help="verified BrickLink colors for a part, returned as LDraw codes").add_argument(
        "part"
    )
    tools.add_parser("check", help="verify every part/color pair in the current bill of materials")
    tools.add_parser("reference", help="pair this reference image with every construction render").add_argument("image")
    tools.add_parser("name", help="name the build").add_argument("name")
    args = parser.parse_args()
    if args.tool == "reference":
        try:
            selected = reference(args.image)
        except (OSError, ValueError) as e:
            parser.error(str(e))
        print(f"Primary reference: {selected}. It will accompany each run/look render.")
        print(f"@@attach {selected}")
        return
    camera = {k: v for k in ("angle", "elevation", "zoom", "at") if (v := getattr(args, k, None)) is not None}

    if args.tool == "run":
        out = call("run", code=Path(args.script).read_text())
    elif args.tool == "parts":
        out = call("parts", query=args.query)
    elif args.tool == "colors":
        out = call("colors", part=args.part)
    elif args.tool == "check":
        out = call("check")
    elif args.tool == "name":
        out = call("name", name=args.name)
    else:
        if args.box and len(args.box) != 6:
            sys.exit("bricks look takes no box, or six numbers: x0 y0 z0 x1 y1 z1")
        out = call("look", **({"camera": camera} if camera else {}), **({"box": args.box} if args.box else {}))
    print(out["text"])
    if out["images"]:
        if args.tool == "look" and args.box:
            names = save(out["images"], "closeup", numbered=True)
        elif camera:
            names = save(out["images"], "view", numbered=True)
        else:
            names = save(out["images"], "render")
        print(f"\n{out['caption']} Saved in your workspace:")
        for name in names:
            print(f"- {Path(name).resolve()}")
        for name in names[:ATTACHED]:
            print(f"@@attach {name}")
        if len(names) < ATTACHED:
            try:
                selected = reference()
            except (OSError, ValueError, KeyError) as e:
                print(f"Primary reference unavailable: {e}. Use bricks reference <image-path> to select it again.")
            else:
                if selected:
                    print(f"Primary reference for comparison:\n@@attach {selected}")
    sys.exit(1 if out["problems"] else 0)


if __name__ == "__main__":
    main()
