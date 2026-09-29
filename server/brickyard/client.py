"""The bricks CLI: an agent's hands on the build in its working directory."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from brickyard.workbench import Workbench
from brickyard.workspace import Workspace


def main() -> None:
    parser = argparse.ArgumentParser(prog="bricks", description=__doc__)
    tools = parser.add_subparsers(dest="tool", required=True)
    tools.add_parser("run", help="rebuild the model from a build script and write model.json").add_argument(
        "script", nargs="?", default="build.py"
    )
    tools.add_parser("parts", help="search LDraw parts by words or number").add_argument("query")
    tools.add_parser("colors", help="verified colors for a part, returned as LDraw codes").add_argument("part")
    tools.add_parser("check", help="verify every part/color pair in the current bill of materials")
    tools.add_parser(
        "assembly", help="check the insertion order; optionally submit a subassembly plan JSON"
    ).add_argument("plan", nargs="?")
    tools.add_parser("name", help="name the build").add_argument("name")
    args = parser.parse_args()

    bench = Workbench(Workspace.open(Path.cwd()))
    if args.tool == "run":
        out = bench.run_script(Path(args.script).read_text())
    elif args.tool == "parts":
        out = bench.find_parts(args.query)
    elif args.tool == "colors":
        out = bench.catalog_colors(args.part)
    elif args.tool == "check":
        out = bench.check_catalog()
    elif args.tool == "assembly":
        out = bench.assembly_plan(json.loads(Path(args.plan).read_text()) if args.plan else None)
    else:
        out = bench.rename(args.name)
    print(out.text)
    sys.exit(1 if out.problems else 0)


if __name__ == "__main__":
    main()
