"""Hogwarts, built by its script `agent/showcase/hogwarts.py` the way a Holo run builds `build.py`."""

from pathlib import Path

from brickyard.showcase.kit import Kit

SCRIPT = Path(__file__).resolve().parents[3] / "agent" / "showcase" / "hogwarts.py"
PROMPT = (
    "Hogwarts' south front above the Black Lake: the Great Hall on its cliff, the Marble Staircase Tower, the viaduct"
)
STORY = [
    (
        "Hand-scripted by Claude after Stuart Craig's concept art, the film's miniature and LEGO 71043, as a showcase "
        "of what HoloBricks' parts and checks can do. Each building is planned as solids, the crag is shaped to carry "
        "them, and the run turns the solids into bricks: only the shell is built, steady steps become slopes, and a "
        "chain of stacked bricks holds every one. Ask for a change and Holo takes over."
    ),
]


def build() -> Kit:
    kit = Kit("hogwarts", "Hogwarts", PROMPT)
    result = kit.bench.run_script(SCRIPT.read_text())
    if result.problems or "Floating" in result.text:
        kit.problems.append(result.text)
    kit.save(STORY)
    return kit
