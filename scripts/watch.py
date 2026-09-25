"""Print a build's status and chat: `python scripts/watch.py <build id>`."""

import json
import sys
import urllib.request

build = json.load(urllib.request.urlopen(f"http://127.0.0.1:8000/api/builds/{sys.argv[1]}"))
print(build["status"], "|", build["name"], "|", len(build["pieces"]), "pieces |", len(build["steps"]), "steps")
for m in build["messages"]:
    print(f"[{m['role']}] {m['text'][:400]}")
