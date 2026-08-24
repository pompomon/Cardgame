# Board background presets

This directory stores the deterministic theme presets used by the manual board background generator.

- `themes.json` is the source of truth for the table palette and pattern tuning.
- Run `npm run generate:board-backgrounds` to render PNGs into `public/boards/<theme>/`.
- The generated files follow the repository's existing board asset contract: `background-hd.png`, `background-balanced.png`, `background-low.png`, and `background-fallback.png`.
- The output remains deterministic for a given preset and seed.
