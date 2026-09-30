"""The bricks CLI: an agent's hands on the build in its working directory."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from brickyard.workbench import Workbench
from brickyard.workspace import Workspace, write

CLOCK = ".brickyard-clock"
"""Written by setup: when it started and the session's time limit in minutes."""
FINISH_AT = 0.8


def tick(folder: Path) -> str:
    """Count this run on the session clock and say how much time is used, if setup started one."""
    path = folder / CLOCK
    if not path.exists():
        return ""
    clock = json.loads(path.read_text())
    clock["runs"] = clock.get("runs", 0) + 1
    write(path, json.dumps(clock))
    used, limit = round((time.time() - clock["started"]) / 60), clock["minutes"]
    late = ": start nothing new; finish, update notes.md and answer" if used >= FINISH_AT * limit else ""
    return f"Run {clock['runs']} · {used} of {limit} min used{late}\n"


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
        out.text = tick(Path.cwd()) + out.text
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
