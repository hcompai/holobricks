# Shopping with HoloTab

**Shop bricks → install HoloTab if needed → copy → paste and send.** Brickyard verifies
all part/color pairs before offering the handoff. The Copy button loads the canonical
server-generated XML in the background and embeds its exact contents directly in the
shopping prompt. HoloTab pastes it into **Upload BrickLink XML format**, continues the
import confirmation, checks stock and delivered cost, and
prepares carts for the user to review and pay. No extension trigger is required.
There is no user upload/file picker step, and HoloTab does not need local file access
or a working localhost link. The saved inventory link is optional reference material.
The prompt includes the validation expiry; an already open dialog also checks expiry
before copying. A failed, malformed or incomplete XML load never enables the handoff.

## One catalog gate for construction and purchasing

`server/brickyard/catalog.py` owns validation. The model cannot assert its own catalog
correctness, and the HoloTab prompt does not perform ID translation.

1. Require a recognized complete LDraw part and explicit LDraw color (never 16/24).
2. Read explicit BrickLink references from the official part's `!KEYWORDS` metadata.
   Otherwise query the exact part ID. Never strip mold/print suffixes or search for a
   visually similar substitute. Multiple references must converge on one canonical ID.
3. Verify an active PART entry in BrickLink's public catalog. A different returned ID
   requires a documented catalog alias. Unknowns, ambiguous references and missing
   entries fail validation.
4. Match the LDraw color name against this part's **Known** colors, obtaining the
   canonical BrickLink numeric color ID. LDraw [deliberately uses BrickLink names](https://www.ldraw.org/article/547.html).
   Only case, spaces/hyphens/underscores and Gray/Grey spelling are normalized. There is
   no RGB approximation or assumption that the two numeric color systems match.
   The All colors selector and seller listings are not manufacturing evidence.
5. Every source lot must pass. Aggregate only then by canonical part/color, preserve
   every quantity, and generate XML with ITEMTYPE P, ITEMID, COLOR, MINQTY and CONDITION N.
   No omitted lots, partial exports or automatic substitutions.

`bricks run` checks the whole candidate (including unchanged and inherited pieces)
before publication. Failure preserves the accepted model and script, returns each bad
pair and the verified LDraw color choices, and allows Holo to repair its script.
`bricks colors <part>` lets Holo choose a valid palette first; `bricks check` audits the
current build. Existing/manual/demo builds are revalidated before purchasing too.
The ordinary viewer's BOM is a design inventory; only the gated XML is a verified
purchasing inventory. Legacy designs may contain unverified pairs and need correction.

## Data freshness and failure behavior

The default provider reads public BrickLink catalog pages, without account credentials
or extra API keys. Catalog HTML is cached under `data/bricklink-catalog` with its requested
ID, source URL, fetch time and SHA-256. Each response is bounded, parsed without executing
JavaScript, and must match the expected identity and Known colors structure. Cache reads
reparse and check the hash; entries expire after 24 hours. Cached parts are reused across
runs/colors/builds. Cold requests are serialized and limited to two per second; a BOM
check has a 60-second budget (plus an in-flight request). Retries continue from the cache.

Network errors, rate limits, changed/truncated pages, unavailable mappings and expired
cache entries **cannot** produce a successful validation. A fresh cache can serve an
offline check; a stale cache cannot. This public-page adapter can be replaced by an
authenticated catalog API without changing the validation or XML contract. The HTML
adapter's maintenance dependency is explicit: site changes may block shopping until
it is updated; there is no fallback that invents a match.

Catalog membership does not promise current stock, quantity, condition, price, one
specific mold within a catalog family, or physical buildability. HoloTab checks actual
seller inventory and shipping; unresolved items stop the handoff instead of being
silently substituted. Printed assembly instructions are not included.

## Saved inventory contract

- `GET /api/builds/{id}/bom/validation` returns the checked revision, every issue,
  verified source lots, canonical IDs, evidence and available colors for repairs.
- `POST /api/builds/{id}/shopping` takes `{ "revision": "..." }`. It rejects busy,
  unfinished, empty or changed builds, and returns structured HTTP 422 issues if any
  catalog check fails. Slow catalog IO runs outside the server event loop.
- Successful version 3 packages contain the source revision, counts, canonical
  inventory, evidence and validation expiry. Files are content-addressed
  `data/shopping/{id}.{json,html,xml}`. Repeated preparation with the same evidence
  is idempotent; source edits or refreshed evidence cannot change saved files.
- Downloads require a current version 3 validation. Expired or older unvalidated
  packages return 410 with instructions to reopen Shop bricks. Old files are retained
  for evidence, not served as verified purchases. Already downloaded copies cannot be
  revoked. Responses use no-store to permit freshness checks.
- Gallery export runs the same validation and emits an error manifest for invalid
  builds. It includes XML and evidence for valid ones; the frontend refuses legacy or
  expired packages. Regenerate static galleries at least daily for fresh handoffs.
  Static files themselves remain dated snapshots, not a live stock/catalog service.
- Files exclude chat, source scripts, reference photos and credentials. Model geometry
  is unchanged by catalog normalization. XML is generated and escaped by an XML library.
- The documented 204,800-byte import bound is enforced without truncation.

## Verification

Offline tests exercise the real catalog validator using explicit source fixtures:
identity/type/status, aliases, print suffixes, Known vs All colors, name/code conversion,
ambiguous mappings, stale/corrupt cache, HTTP errors, timeout budgets and exact quantities.
Construction tests prove rejected pairs and outages cannot replace the accepted model.
API and gallery tests prove no partial file escapes; browser tests compare the actual
clipboard XML with the server snapshot, cover XML-load retry and partial-response rejection,
blocking errors, legacy/expired packages, expiry while the dialog is open, clipboard
feedback and mobile layout.

The saved Microduck audit found 7 unverified part/color combinations (25 pieces), despite
all part geometries existing in LDraw. It is intentionally blocked until those choices
are repaired. No inference run, model recolor, merchant account change or purchase was
performed to make this test pass. Authenticated import/cart acceptance in the released
HoloTab extension remains separate product QA.
