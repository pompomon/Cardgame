# Card art

Card images are static assets used by the Three.js battlefield and its native
HTML interface. Serialized game state still uses the five `BasicLand` keys, but
public filenames come only from the catalog's stable `assetSlug`.

## Layout

Each directory contains exactly these five PNGs:

```text
gravebloom-dryad.png
signal-siren.png
rooftop-gargoyle.png
echo-doppelganger.png
memory-vampire.png
```

They appear under:

```text
public/cards/
├── card-back.png
├── classic/
├── hd/
├── hd-fallback/
└── monochrome/
```

- Art must be square and at least 256×256.
- `classic/` contains deterministic 1024×1024 pixel-art counterparts to the
  procedural Classic fallback.
- `hd/` contains restored 1254×1254 primary creature artwork from the last
  pre-migration revision. Human review must independently confirm that these
  files meet the **photoreal** quality gate.
- `hd-fallback/` contains deterministic 1024×1024 geometric creature artwork.
- `monochrome/` contains deterministic 1024×1024 monochrome creature artwork.
- The canonical key-to-slug mapping is in `src/app/card-catalog.ts`; never
  derive a path from a display name or serialized key.

## Runtime behavior

`cardArtSourceFor()` in `src/app/card-visuals.ts` owns source selection.

- `classic` renders the cached procedural SVG; its shipped PNG provides
  deterministic recipe parity and asset inventory. This procedural rendering
  is intentional, not a missing raster integration.
- `hd` tries `hd/<slug>.png`, then `hd-fallback/<slug>.png`, then the
  procedural icon.
- `monochrome` tries `monochrome/<slug>.png`, then the procedural icon.
- Small glyphs may force the procedural source to avoid downloading a large
  raster image.

Three.js pre-paints a playable procedural card face before loading raster art.
The native interface uses the same fallback order. Both suppress repeatedly
failed raster URLs for the session and retry after online recovery.

The service worker handles `/cards/*` network-first with cache fallback.
Same-path replacements therefore refresh online while remaining available
offline. Bump `RUNTIME_ASSET_VERSION` whenever committed same-path artwork is
replaced so obsolete runtime caches are retired.

## Deterministic assets

The Classic, HD-fallback, and Monochrome assets share the creature recipes in
`src/app/card-visual-recipes.ts` and use only the Node standard library:

```bash
npm run generate:card-art
```

This rewrites the five approved slugs in those three directories. Re-running
the same recipe is byte-identical. Commit recipe, generator, and generated
image changes together.

For isolated verification without touching tracked assets, use Node 24:

```bash
npm run test -- src/test/card-art-generator.test.ts
```

The existing 256×256 two-run check proves repeatability. A separate 1024×1024
shipping-size check compares all 15 generated files byte-for-byte with the
committed Classic, HD-fallback, and Monochrome assets. Test output stays in
project-local scratch directories and is removed afterward.

## HD artwork

The current HD files are restored byte-for-byte from
`98dea673ceb7858c67ab126a8fcb0f26251e2250`, the last revision before the
slugged creature-art migration removed the legacy paths. They were introduced
in `ace5d53921dcb7eab992fe94e083865334d10217` and are reused under the current
catalog slugs according to the stable serialized identity:

| Serialized identity | Current file | SHA-256 |
| --- | --- | --- |
| `Forest` | `gravebloom-dryad.png` | `b1bfa46f3ccebd04112e1e7e8ae1df9446922429f7b7fc399f4c0ec109546b72` |
| `Island` | `signal-siren.png` | `50f856df06fc53b2f713ac8e1a7cf6f1fe6aeee28ab0bfcb9af4403a2aeb0b64` |
| `Mountain` | `rooftop-gargoyle.png` | `37c1d2f610d78b11a12428a4680d1a93e1b34cffa02400dcb1b7107e7c9fd05f` |
| `Plains` | `echo-doppelganger.png` | `86a595aeaf25c16e867c9219d18bf3fab6f5a549703d99aa21f045dc18918a61` |
| `Swamp` | `memory-vampire.png` | `97b17ba1c075476673f59a2bb87c8ac22843eb150efc796aa60b5b2399d5e926` |

`src/test/card-art-assets.test.ts` verifies that each primary HD file differs
from its deterministic fallback. The hashes, dimensions, and inequality check
establish provenance and independence only; they do not establish photoreal
quality or visual acceptance.

### Optional future generation

An authorized operator can deliberately generate future replacements with the
hosted image-generation script. CI, lint, tests, and builds never invoke it.
Configure `IMAGE_GEN_API_KEY` (or `OPENAI_API_KEY`) securely in the environment,
never in committed files or logs.

**Operator replacement gate:** existing PNGs are skipped unless `--force` is
supplied. To replace the current restored files intentionally, run:

```bash
npm run generate:photoreal-card-art -- --force
```

Options:

- `--force` overwrites existing files.
- `--card=<selector>` limits generation to a repeatable, case-sensitive
  catalog slug or serialized key, such as `gravebloom-dryad` or `Forest`.

Optional configuration includes `IMAGE_GEN_MODEL`, `IMAGE_GEN_ENDPOINT`, and
`IMAGE_GEN_SIZE`. Generation is non-deterministic. Never commit an API key,
temporary output, or an unreviewed image.

### Acceptance status

Historical restoration and the automated primary/fallback separation check are
complete. Human art review and production-browser visual acceptance remain
separate requirements under the
[browser evidence procedure](../../docs/agent/testing.md#browser-verification-and-evidence).
Passing provenance, hash, inventory, dimension, or fallback tests does not close
those visual gates.

## Review and replacement workflow

1. Confirm the filename is one of the five exact catalog slugs.
2. Confirm the PNG is square, at least 256×256, and contains no text, logos, or
   branded symbols.
3. Confirm HD is genuinely photoreal, not a procedural/fallback copy; review the
   readable silhouette, creature-to-ability mapping, color-role
   continuity, urban-fantasy cohesion, crop safety, and contrast.
4. Check the image on the Three.js battlefield and in the native Cards dialog
   at desktop, narrow mobile, short landscape, and 200% text zoom.
5. Run the asset, fallback, base-path, service-worker, and production-build
   tests.
6. Verify online loading and a cached offline reload under the configured
   non-root base path.
7. Bump `RUNTIME_ASSET_VERSION` for any same-path replacement.

Record generation, browser interaction, capture, inspection, and
reviewer-accessible attachment separately. Until the photoreal and visual
review gates pass, the artwork phase is incomplete even if all automated
checks pass.
