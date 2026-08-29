# Board and sprite assets

The Phaser board pipeline loads unhashed public assets from this directory and
`public/sprites/`. All artwork here is deterministic, repository-original
placeholder art and can be replaced in place without changing manifest code.

## Background variants

Each board theme (`classic`, `moonlit`, and `verdant`) ships four independently
loadable 16:9 PNGs:

- `background-hd.png` — 1920×1080
- `background-balanced.png` — 1280×720
- `background-low.png` — 960×540
- `background-fallback.png` — 640×360 minimal placeholder

The Phaser manifest selects the requested quality tier and then falls back
toward the placeholder. If every PNG fails, gameplay continues with the
existing procedural board.

Each theme also has a two-frame `ambience-atlas.png` and matching Phaser JSON
atlas. Repeated board UI and effect sprites live separately in:

```text
public/sprites/
  board-ui-atlas.png
  board-ui-atlas.json
  effects-atlas.png
  effects-atlas.json
```

Keeping the large backgrounds out of the atlases allows later retained views
to load and evict one quality tier without discarding shared UI textures.

These paths are not content-hashed. The service worker handles `/boards/*` and
`/sprites/*` network-first, matching `/cards/*`, and keeps the latest successful
response for offline fallback. Replace-in-place releases must bump
`CACHE_VERSION` in `public/sw.js`.

The background PNGs are intentionally generated from the preset definitions in
`tools/board-backgrounds/themes.json` by the manual script
`npm run generate:board-backgrounds`.
