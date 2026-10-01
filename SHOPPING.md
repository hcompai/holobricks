# Shopping with HoloTab

**Shop bricks → install HoloTab if needed → copy → paste and send.** HoloBricks verifies
every part/color pair before offering the handoff, and embeds the verified BrickLink XML
directly in the shopping prompt. HoloTab pastes it into **Upload BrickLink XML format**,
continues the import confirmation, checks stock and delivered cost, and prepares carts for
the user to review and pay. There is no file upload step and no extension trigger. The
dialog also offers the XML as a download, for a manual BrickLink import.

## One catalog gate for construction and purchasing

`server/brickyard/catalog.py` owns validation. The model cannot assert its own catalog
correctness, and the HoloTab prompt does not perform ID translation.

1. Require a recognized complete LDraw part and an explicit LDraw color (never 16/24).
2. Look the part up in the catalog snapshot, built by `brickyard-catalog` from Rebrickable:
   its LDraw cross-references map each part and color to one Rebrickable and one BrickLink
   id, and its set inventories list the colors each part came in. Ambiguous mappings are
   left out of the snapshot, so they fail validation. There is no guess from a similar part
   number and no RGB approximation.
3. A pair passes only if the part came in that color in a LEGO set. Every source lot must
   pass; only then are lots aggregated by BrickLink part/color into XML with ITEMTYPE P,
   ITEMID, COLOR, MINQTY and CONDITION N. No omitted lots, partial exports or substitutions.

`bricks run` builds the script's geometry, then reports each unverified pair as a problem,
with the colors that part came in, so Holo repairs its script before finishing.
`bricks colors <part>` lists them ahead of time; `bricks check` audits the current build.

## The shared parts list

Each shared `model.json.gz` carries, for its own revision:
- `bom`: the verified parts list, or the reason it could not be verified;
- `shopping`: a version 3 package with the revision, piece and lot counts, the canonical
  inventory, the catalog evidence, the validation expiry, a content hash and the XML; or the
  reason there is none (an unverified pair, a part without a BrickLink id, a list over
  BrickLink's 204,800-byte import limit).

The Parts panel and the Shop dialog show a list only if it is verified, matches the model's
revision and piece count, and has not expired; the dialog also rechecks the XML against the
counts. Showcases carry the same bundle, exported by `brickyard-gallery`.

## Freshness and limits

Validation lasts as long as the snapshot: 30 days after `brickyard-catalog` built it. After
that, `bricks run` reports every pair as unverifiable, and shared lists stop opening in the
Shop dialog; exported showcases expire the same way. At least every 30 days, rebuild the
snapshot with `brickyard-catalog`, then redeploy: `scripts/deploy.sh` repacks the toolkit
and re-exports the showcases.

Catalog membership does not promise current stock, quantity, condition, price, one specific
mold within a catalog family, or physical buildability. HoloTab checks actual seller
inventory and shipping; unresolved items stop the handoff instead of being silently
substituted. The package excludes chat, source scripts, reference photos and credentials.

## Verification

Offline tests exercise the real validator with explicit catalog facts: unknown parts and
colors, unmapped parts, colors a part never came in, exact quantities, XML escaping of
labels and the complete bundle. Browser tests compare the copied XML with the shared
package and cover unverified and expired lists. Authenticated import and cart acceptance in
the released HoloTab extension remain separate product QA.
