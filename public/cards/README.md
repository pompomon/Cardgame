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
- `hd/` contains primary 1024×1024 creature artwork. A deterministic
  HD-fallback copy may safely seed a slot until reviewed photoreal art is
  available.
- `hd-fallback/` contains deterministic 1024×1024 geometric creature artwork.
- `monochrome/` contains deterministic 1024×1024 monochrome creature artwork.
- The canonical key-to-slug mapping is in `src/app/card-catalog.ts`; never
  derive a path from a display name or serialized key.

## Runtime behavior

`cardArtSourceFor()` in `src/app/card-visuals.ts` owns source selection.

- `classic` renders the cached procedural SVG; its shipped PNG provides
  deterministic recipe parity and asset inventory.
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

For isolated verification without touching tracked assets:

```bash
node scripts/generate-card-art.mjs --output /tmp/card-art --size 256
```

## HD artwork

The HD images are generated manually by an operator script that calls a hosted
image-generation API. CI, lint, tests, and builds never invoke it.
Use `--force` when replacing a deterministic seed already present in `hd/`.

```bash
IMAGE_GEN_API_KEY=<key> npm run generate:photoreal-card-art
```

Options:

- `--force` overwrites existing files.
- `--card=<selector>` limits generation to a repeatable, case-sensitive
  catalog slug or serialized key, such as `gravebloom-dryad` or `Forest`.

Optional configuration includes `IMAGE_GEN_MODEL`, `IMAGE_GEN_ENDPOINT`, and
`IMAGE_GEN_SIZE`. Generation is non-deterministic. Never commit an API key,
temporary output, or an unreviewed image.

## Review and replacement workflow

1. Confirm the filename is one of the five exact catalog slugs.
2. Confirm the PNG is square, at least 256×256, and contains no text, logos, or
   branded symbols.
3. Review the readable silhouette, creature-to-ability mapping, color-role
   continuity, urban-fantasy cohesion, crop safety, and contrast.
4. Check the image on the Three.js battlefield and in the native Cards dialog
   at desktop, narrow mobile, short landscape, and 200% text zoom.
5. Run the asset, fallback, base-path, service-worker, and production-build
   tests.
6. Verify online loading and a cached offline reload under the configured
   non-root base path.
7. Bump `RUNTIME_ASSET_VERSION` for any same-path replacement.
