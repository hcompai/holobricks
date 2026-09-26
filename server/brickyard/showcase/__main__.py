"""Regenerate a showcase build: `python -m brickyard.showcase paris`."""

import asyncio
import importlib
import sys


def main(name: str) -> None:
    kit = asyncio.run(importlib.import_module(f"brickyard.showcase.{name}").build())
    store = kit.session.store
    for old in store.all():
        if old.builder == "claude" and old.name == kit.build.name and old.id != kit.build.id:
            (store.root / f"{old.id}.json").unlink()
            store.thumbnail(old.id).unlink(missing_ok=True)
    print("\n\n".join(kit.problems) or "No problems.")
    print(f"{kit.build.id}: {len(kit.build.pieces)} pieces in {len(kit.build.steps)} steps")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "paris")
