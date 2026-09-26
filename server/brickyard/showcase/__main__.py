"""Regenerate a showcase build in place: `python -m brickyard.showcase paris`."""

import asyncio
import importlib
import sys


def main(name: str) -> None:
    kit = asyncio.run(importlib.import_module(f"brickyard.showcase.{name}").build())
    print("\n\n".join(kit.problems) or "No problems.")
    print(f"{kit.build.id}: {len(kit.build.pieces)} pieces in {len(kit.build.steps)} steps")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "paris")
