# Card art

Card images served as static assets to the Phaser renderer.

## Layout

```
public/cards/
├─ card-back.png            # Shared card-back asset (not currently used by Phaser renderer)
├─ classic/
│  ├─ Forest.png
│  ├─ Island.png
│  ├─ Mountain.png
│  ├─ Plains.png
│  └─ Swamp.png
├─ hd/
│  └─ ...
└─ monochrome/
   └─ ...
```

- One PNG per `(cardVisualStyle, BasicLand)` pair (3 styles × 5 lands = 15 files), plus a single shared `card-back.png` asset.
- The `classic/` and `monochrome/` PNGs are 256×256 placeholder swatches generated from each style's palette in `src/app/card-visuals.ts`.
- The `hd/` PNGs are finished 1024×1024 art produced by `scripts/generate-card-art.mjs`. The Phaser renderer scales them down to the current card slot, so any square art at this size or larger works.
- The naming convention is enforced by `src/app/card-art.ts` (`cardArtKey` / `cardArtUrl`). Replacing artwork is a drop-in: ship a new PNG at the same path; no code changes are needed.

## Replacement workflow

1. Produce new square artwork at least 256×256 (HD replacements are typically 1024×1024).
2. Save it as `public/cards/<style>/<Land>.png`, matching the existing filename casing exactly (lands are PascalCase: `Forest`, `Island`, `Mountain`, `Plains`, `Swamp`).
3. Reload the app — Phaser preloads art via `ALL_CARD_ART` on scene boot, so the new file is picked up automatically.

If a file is missing or fails to load, the renderer falls back to the procedural pixel icon (`landPixelRects`) so cards remain visible.

## Regenerating the HD assets

The HD card art is produced deterministically by a Node script that depends only on the Node standard library (no extra npm packages):

```
npm run generate:card-art
```

This (re)writes `public/cards/hd/*.png`. Re-running on the same checkout yields byte-identical output. If you change the recipe in `scripts/generate-card-art.mjs`, regenerate and commit the resulting PNGs alongside the change.

## Style slots

The current visual style slots, mirrored from `src/app/card-visual-styles.ts`:

- `classic` — palette-driven flat swatches (placeholder).
- `hd` — high-resolution painted scenes (replaces the legacy `neon` slot).
- `monochrome` — palette-driven grayscale swatches (placeholder).

Users who had previously selected `neon` are migrated to `hd` on first read (`src/app/card-visual-style-selection.ts`).
