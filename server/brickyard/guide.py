"""What a builder agent needs to know to write a build script: the API, scale, recipes, parts and colors."""

from __future__ import annotations

from brickyard import ldraw
from brickyard.workbench import COMMON_COLORS, COMMON_PARTS, part_line

GUIDE = """# The build script

The model stands on a {width}x{depth} stud baseplate. The script is plain Python: constants, loops, and your own \
functions for anything that repeats (a window bay, a tree, a lamp). Stack things on the heights the calls return, \
never on hand-counted ones.
- step(title): starts a manual step; the calls after it go into it.
- walls(x, y, w, d, z, courses, color, corners=None, windows=None, openings=[]) -> top z: hollow walls of bonded \
bricks around the rectangle x to x+w-1, y to y+d-1, each course 3 plates tall. corners is the color of the four \
corner columns. windows={{"color": 40, "courses": [1, 3], "every": 2, "width": 1}} sets glass into every side, every \
N studs, on the courses listed (from 0); corners stay solid. openings=[{{"side": "south", "at": 3, "width": 2, \
"courses": 2, "arch": True}}] cuts doors, gates and shopfronts from the bottom; at counts studs from the side's west \
or south end; arches need a width of 2 or 4.
- fill(x, y, w, d, z, color=None, palette=None, kind="plate", skip=[]): covers the rectangle at height z with plates, \
tiles or bricks, largest parts first: floors, decks, ceilings, streets, water, lawns. Cells already filled at that \
height are left out, so it paves around what stands there; the run warns when that leaves out most of the rectangle. \
A palette of [color, weight] pairs uses small parts in random colors, for textured ground. skip lists [x, y, w, d] \
rectangles to leave out.
- roof(x, y, w, d, z, color, steep=False) -> top z: a plate ceiling at z, then a hipped roof of slopes; w and d must \
be even. It rises about 1.5 plates per stud of its shorter side, 4.5 when steep; steep on a square ends in a spire.
- brick(part, x, y, z, color, rotation=0): one part, for details.
- top(x, y, w=1, d=1) -> z: the highest plate height filled over the rectangle so far, 0 on the bare baseplate.
- print() output comes back with the run.

Example:
```python
PAVING = [[71, 5], [72, 2], [19, 1]]

def tree(x, y):
    for z in (0, 3, 6):
        brick("3941", x + 1, y + 1, z, 70)
    brick("87081", x, y, 9, 2)
    brick("6222", x, y, 12, 288)
    brick("3941", x + 1, y + 1, 15, 10)

step("Town hall walls")
eaves = walls(10, 12, 12, 8, 0, 6, 15, corners=71, windows={{"color": 40, "courses": [1, 3, 5]}},
              openings=[{{"side": "south", "at": 5, "width": 2, "courses": 2, "arch": True}}])
step("Town hall roof")
roof(10, 12, 12, 8, eaves, 320)
step("Trees")
for x in (2, 26):
    tree(x, 2)
step("Paving")
fill(0, 0, 32, 32, 0, palette=PAVING, kind="tile")
```

# Coordinates
- x runs 0-{xmax} from left to right, y runs 0-{ymax} from front to back, z is the height in plates above the \
baseplate. Bricks are 3 plates tall; plates and tiles are 1.
- The sides of a rectangle are south (the front, lowest y), north (the back), west (left, lowest x) and east (right).
- A part placed at (x, y) covers studs x to x+W-1 and y to y+D-1, with W x D as listed at rotation 0. Rotation 90 or \
270 swaps W and D.
- Parts on the baseplate use z=0. To stack, put the upper part at z = lower z + lower height.
- Slopes at rotation 0 descend toward the front (-y), at 180 toward the back (+y), at 90 toward -x, at 270 toward +x.
- Parts must stay on the baseplate, must not overlap other pieces, and must rest on something. Runs name every \
brick that does not, with the script line that made it.

# Looking right
- Match the real proportions: tall things are tall. A lighthouse is about four times taller than it is wide.
- Buildings are hollow walls with windows on every side and a real roof, never solid blocks of bricks. Give walls a \
contrasting color for corners or a plinth, and roofs a color of their own.
- Walls rest only on what is under their own bricks: before narrower walls go on top of wider ones (a tower on a \
pier, an upper storey set back), fill a plate slab over the lower walls' top.
- Keep one scale across the model: a storey is 2 courses, walls are at least as tall as the roof on them, and lamps, \
benches and fences stay below the eaves.
- Shape beats boxes: slopes, round bricks, cones, arches and fences, trims and stripes in accent colors.

# Recipes
- Ground and water: build everything that stands on the baseplate first (buildings, piers, tree trunks), then fill \
the ground and the water at z=0 with tiles and a palette, as the last steps. Paving [[71, 5], [72, 2], [19, 1]], \
grass [[2, 4], [10, 2], [288, 1]], water [[272, 5], [1, 2], [73, 1]].
- House: walls of 2 courses per storey with windows on courses 1, 3, 5 (trans black 40, or trans yellow 46 for lit \
rooms) and a door opening, then a roof on the walls' top z, with steep=True for tall Gothic or Nordic roofs.
- Tower and spire: square walls with narrow windows, or stacked round bricks (3941 is 2x2, 3062b is 1x1). A steep \
roof on a square tower ends in a spire; 4589 cones on the corners make pinnacles.
- Bridge deck or walkway over open space: every piece needs something directly under or above it, and fill does not \
bridge gaps. Span the gap with brick() plates long enough to reach both supports, placed side by side (60479 is \
1x12, 2445 is 2x12, 4282 is 2x16, 3027 is 6x16), then fill tiles or plates on top of them; or stand the deck on \
columns.
- Street lamp: a 3062b in black, a 3062b in trans yellow 46 on it, and a 4589 cone in black on top.
- Window 60592 gets its glass automatically; put it in a wall opening with a black brick behind it.

# Common parts at rotation 0 (`bricks parts` finds any other)
{parts}

# Colors (LDraw code: name)
{colors}"""


def guide(width: int = 32, depth: int = 32) -> str:
    palette = ldraw.colors()
    parts = "\n".join(part_line(f"{p}.dat") for p in COMMON_PARTS)
    colors = ", ".join(f"{c}: {palette[c][0].lower()}" for c in COMMON_COLORS if c in palette)
    return GUIDE.format(parts=parts, colors=colors, width=width, depth=depth, xmax=width - 1, ymax=depth - 1)
