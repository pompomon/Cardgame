# Card art

Card images are static assets used by the Three.js battlefield and its native
HTML interface.

## Layout

```text
public/cards/
├── card-back.png
├── classic/
│   ├── Forest.png
│   ├── Island.png
│   ├── Mountain.png
│   ├── Plains.png
│   └── Swamp.png
├── hd/
│   └── ...
├── hd-fallback/
│   └── ...
└── monochrome/
    └── ...
```

- Each visual style has one primary PNG per basic land.
- Primary art must be square and at least 256×256.
- `hd/` contains 1024×1024 photoreal landscapes.
- `hd-fallback/` contains deterministic 1024×1024 geometric fallbacks.
- `monochrome/` contains deterministic 1024×1024 illustrations.
- Paths and filename casing are canonical in `src/app/card-art.ts`.

## Runtime behavior

`cardArtSourceFor()` in `src/app/card-visuals.ts` is the single source-selection
policy.

- `classic` is procedural. The renderer uses the cached SVG pixel template and
  its palette rather than requiring the placeholder PNG.
- `hd` tries the photoreal PNG, then `hd-fallback`, then the procedural icon.
- `monochrome` tries its PNG, then the procedural icon.
- Small glyphs may force the procedural source to avoid downloading a large
  raster image.

Three.js textures load on demand. Missing textures leave the already-painted
procedural card face usable. The native interface follows the same fallback
chain and records failed raster URLs so rerenders do not retry them continuously.

The service worker handles `/cards/*` network-first with cache fallback.
Same-path replacements therefore refresh online while remaining available
offline. Bump `CACHE_VERSION` when replacing same-path assets to ensure a clean
upgrade boundary.

## Replacement workflow

1. Produce square artwork at least 256×256.
2. Save it as `public/cards/<style>/<Land>.png`, using the exact PascalCase land
   name.
3. Run asset, fallback, base-path, and production-build tests.
4. Review the image in both the Three.js battlefield and native Cards dialog.
5. Verify online loading and a cached offline reload under the non-root base
   path.

## Deterministic assets

The geometric HD fallback and monochrome art are generated using only the Node
standard library:

```bash
npm run generate:card-art
```

This rewrites `public/cards/hd-fallback/*.png` and
`public/cards/monochrome/*.png`. Re-running the same recipe is byte-identical.
Commit script and generated image changes together.

## Photoreal HD art

The HD images are generated manually by an operator script that calls a hosted
image-generation API. CI, lint, tests, and builds never invoke it.

```bash
IMAGE_GEN_API_KEY=<key> npm run generate:photoreal-card-art
```

Options:

- `--force` overwrites existing files.
- `--land=<Name>` limits generation to a repeatable, case-sensitive basic land.

Optional configuration includes `IMAGE_GEN_MODEL`, `IMAGE_GEN_ENDPOINT`, and
`IMAGE_GEN_SIZE`. The generator is non-deterministic; review outputs before
committing them. Never commit the API key.

## Style slots

- `classic` — palette-driven procedural pixel art.
- `hd` — photoreal raster art with a geometric raster fallback.
- `monochrome` — monochrome raster illustrations.

The legacy `neon` setting migrates to `hd` in
`src/app/card-visual-style-selection.ts`.
