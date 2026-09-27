# Shopping with HoloTab

After a nonempty build finishes, **Shop bricks** opens a preview and a short handoff:
install HoloTab in Chrome if needed, copy the prepared request, then paste and send it
in HoloTab. The request includes a saved parts-list page, its download, and the buying
procedure. Clipboard failures expose selectable text. No extension detection or automatic
task launch is claimed; Brickyard only reports that the request was copied.

## Use the merchant's bulk importer

BrickLink accepts LDraw `.ldr` files directly in its [Wanted List file importer](https://www.bricklink.com/help.asp?helpID=207).
We export every placed piece and preserve its color and transform, including
legacy pieces without matching step metadata. The purchasing file normalizes two
verified catalog aliases: `3069b.dat` → `3069.dat` and `6143.dat` → `3941.dat`.
BrickLink lists them under [3069](https://www.bricklink.com/v2/catalog/catalogitem.page?P=3069)
and [3941](https://www.bricklink.com/v2/catalog/catalogitem.page?P=3941); the official
LDraw files also document these aliases. Both import targets are valid LDraw references.
We never remove mold/print suffixes generically, change the source model, or treat
LDraw color codes as BrickLink XML codes. The inventory page shows both the source
reference and import reference. Other parts still require native importer verification.
HoloTab downloads this file,
uses the native importer, verifies the resulting quantities and colors, then uses
[Buy All / Auto-select / Create Carts](https://www.bricklink.com/help.asp?helpID=2445).

The generated request tells HoloTab to report unresolved items rather than silently
omit or substitute them, use the delivery country from the account (ask when absent),
review shipping/minimums/existing cart contents, and leave payment to the user. Its
stable Wanted List name allows interrupted sessions to resume without uploading the
same quantities twice. Actual login, upload and checkout still depend on HoloTab and
the merchant; copying a request is not evidence of a completed order.

## Saved inventory contract

- `POST /api/builds/{id}/shopping` takes `{ "revision": "..." }` and rejects a busy,
  unfinished, empty or changed build. Invalid parts and unspecified colors are rejected.
- The response includes a content-addressed package ID, source model revision, piece
  and lot counts, and the inventory. Files live in `data/shopping/{id}.{json,html,ldr}`
  and are served by `GET /api/shopping/{filename}`. Retries are idempotent and subsequent
  model edits do not change previously copied links.
- Package version 2 includes `inventory[].import_part` and counts lots by import
  reference/color. Reopening **Shop bricks** creates the corrected package; previously
  copied version 1 files stay immutable. Regenerate static galleries to publish the fix.
  The handoff also explains how to repair these specific aliases in an earlier rejected
  import without changing quantities or already translated BrickLink colors.
- No chat, source scripts, reference photos or credentials are included in these files.
- Gallery export produces the same files under `gallery/shopping`, with a per-build
  `gallery/builds/{id}.shopping.json` manifest. No live API is needed. Older gallery
  exports need regeneration; the UI explains when shopping files are missing. Keep old
  deployment files if previously copied gallery links must survive a gallery replacement.
- The importer documents a 204,800-byte upload limit. Larger inventories are rejected
  explicitly; we never truncate a shopping list.

This feature prepares an inventory, not a certified kit. It does not provide live
stock/prices, proof of physical buildability, printable instructions, native HoloTab
launch, or a unified payment across sellers. Printed instructions are explicitly
marked as not included in the shopping dialog.

## Verification

Server tests cover exact import counts, colors and transforms; orphaned-step pieces;
the Microduck's three rejected tile colors; documented aliases and untouched variants;
revision conflicts; repeat requests; immutable links; invalid/incomplete inventories;
the file-size bound; HTML escaping; private-data exclusion; and static gallery files.
Browser tests cover the real clipboard, link handoff, live updates after copying,
mobile layout, clipboard fallback, retry, and disabled/stale shopping states.

For a full product acceptance run, paste the copied request into the released HoloTab
extension and verify the importer resolves every lot and prepares the expected carts.
Stop before submitting payment. This merchant/extension run is separate from automated
tests, which do not access an account, create a Wanted List or buy anything.
