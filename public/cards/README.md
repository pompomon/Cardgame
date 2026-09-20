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
- `hd/` is reserved for primary 1024×1024 **photoreal** creature artwork.
  Current deterministic HD-fallback copies are placeholders, not acceptable
  final HD assets. Their presence or successful loading does not complete
  artwork delivery.
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

Final HD images must be photoreal, generated manually by an authorized operator
using the hosted image-generation script. CI, lint, tests, and builds never
invoke it. Configure `IMAGE_GEN_API_KEY` (or `OPENAI_API_KEY`) securely in the
environment, never in committed files or logs.

**Operator replacement gate:** existing PNGs are skipped unless `--force` is
supplied. All five HD slots currently exist, so a run without that flag does not
replace the placeholders. The existing operator script is supported; after
generation credentials are available, deliberately replace them with:

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

### Current acceptance blocker

On 2026-09-20 at revision `71bb4c492485c08b70f514a454ab845eb24fdcc1`,
`cmp` returned exit 0 for each of the five `hd/<slug>.png` and
`hd-fallback/<slug>.png` pairs; their SHA-256 hashes also matched. File headers
reported 1024×1024 PNGs for all ten files. This text-only check establishes that
the HD slots contain fallback copies, not independent photoreal artwork.

Photoreal replacement is **blocked by unavailable generation credentials** in
the follow-up session, not by an unsupported operator script. No photoreal
generation was attempted and no assets were changed. No images were viewed for
this text-only asset audit; later checkpointed browser inspection follows the
[browser evidence procedure](../../docs/agent/testing.md#browser-verification-and-evidence).
Human art review and actual production-browser visual acceptance remain separate,
pending verification. Passing deterministic or dimension tests does not close
these gates.

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
