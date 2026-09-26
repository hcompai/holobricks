# How Claude rebuilt Hogwarts

A log of the process, tools and decisions, to distill into Holo's harness.

## 0. Brief

> Rebuild Hogwarts from scratch. Ugly, didn't look like Hogwarts. Big, not square, real height. Fetch references, plan.

## 1. Look at what exists before touching it

| Step | Tool | Why |
|---|---|---|
| Read `showcase/hogwarts.py`, `kit.py`, `shapes.py` | file read | know the helpers and the old design |
| Render the old build | `GET /api/builds/hogwarts/sheet.png` (4 views) | judge it with eyes, not code |
| Read the checker (`workbench._check`, `model.place/bounds`) | file read | learn the rules: bounding boxes collide, "floating" is only a warning, mounted parts skip the support check |
| Query the part library by id and keyword | `ldraw.search`, `part_line` | know real sizes (a 3942c cone is 2x2x6 plates, a 4460b slope is 1x2x9) before designing |
| Check the viewer scales | grep `InstancedMesh` in `scene.ts` | instancing, so 20k+ pieces are fine |

Diagnosis of the old build (`data/refs/hogwarts/v0-old-sheet.png`):

- cliff is 8 courses on a 64x64 square: no drama, no height
- walls grey, roofs flat bright blue: Hogwarts is **tan walls, dark grey spires**
- lake is a noisy speckle of three blues
- castle reads as boxes with small cones; no spiky silhouette, no cascade down the rock
- cliff face is striped 1-course brick rows, not rock

## 2. References

| Ref | Source | What it teaches |
|---|---|---|
| LEGO 76419 Castle and Grounds (microscale) | brickset.com image | tan walls, dark grey cone roofs, **jagged grey cliff of big angled facets**, bright trans-blue water, stairs down the rock, boathouse |
| LEGO 71043 Hogwarts Castle (microscale) | brickset.com image | Great Hall with buttresses and a long steep roof, Astronomy Tower tallest with a clustered crown, viaduct arches, covered bridge |
| Studio Tour model, 2 views | Wikimedia Commons API search | real composition from the lake: big round tower left, viaduct front-left, Great Hall front-center, Astronomy Tower center-back, Gryffindor square tower with spires right, greenhouses front-right |

Tools: `curl` on predictable brickset URLs (`images.brickset.com/sets/images/<set>-1.jpg`), Wikimedia Commons `api.php?generator=search&prop=imageinfo&iiurlwidth=900` for licensed photos, then read each image to look at it. Saved to `data/refs/hogwarts/`.

Lesson: **official LEGO sets of the same subject are the best reference**; they already solved "how does this look in bricks at this scale".

## 3. Plan

Build area **128 x 88** (lake in front and on the left, forest behind on the right). Castle crest near 220 plates: height about 0.7x the width.

Palette: tan (19) walls, dark tan (28) plinths and trims, dark bluish grey (72) roofs and spires, pearl gold (297) finials, light and dark bluish grey (71, 72) rock with olive (330) and dark green (288) tufts, trans-light-blue and trans-dark-blue water over blue.

Layers, each its own steps:

1. **Lake**: blue base, calm trans-blue plates, few highlights.
2. **Cliff**: a voxel heightmap, meshed into bricks: exposed faces only (hollow inside, hidden columns under the top), faces bevelled with 45/65/75 degree slopes so they read as angled crags, not brick rows.
3. **Castle**, reusable parts: `hall` (buttresses, lancets, steep roof), `round_tower` (2x2, 3x3, 4x4, cone spire with a gold finial), `square_tower` (corner pinnacles, pyramid spire), `curtain` (crenellated walls).
   - Great Hall, Astronomy Tower (tallest, crown of spires), the big round tower, Gryffindor/clock tower, Headmaster's tower, viaduct arches, covered bridge, greenhouses.
4. **Below and around**: boathouse at the water with stairs up the rock, boats, Hagrid's hut, Forbidden Forest.

Loop: script, run, render 4 views, then close-up looks at weak spots, fix, repeat. Compare each render against the references side by side.

## 4. Build log

### 4.1 Tooling first

- **Camera renders from the terminal.** `GET /api/builds/<id>/sheet.png` renders in headless Chrome. I gave it `?angle=&elevation=&zoom=&at=x,y,z` so any close-up is one `curl` (5 to 8 s). Wrapper: `r.sh BUILD OUT.png [angle elev zoom at]`.
- **Test the parts before designing with them.** A throwaway 40x24 build (`hogtest`) with each unknown part in four rotations, colored red/blue/green/yellow by rotation, then a zoomed top view. Learned in one render:
  - `48092` 4x4 corner round: rot 90 = front-left quarter, 0 = front-right, 180 = back-left, 270 = back-right; four make an 8x8 round tower. `5152` 3x3 the same, for 6x6.
  - `48310` half cone 8x4x6: rot 0 is the front half, rot 180 the back; together an 8x8 cone with a 4x4 top.
  - a 1x1 finial on a 2x2 cone sits between grid cells, so I added `Kit.centered` (half-stud offset, placed as a mounted part).
- Lesson for Holo: **a one-render part test beats reasoning about rotations**. Colors per rotation make it readable at a glance.
