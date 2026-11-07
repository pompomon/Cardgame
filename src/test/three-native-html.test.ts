import { beforeEach, describe, expect, it } from 'vitest'
import { cardCatalogEntry } from '../app/card-catalog'
import { BASIC_LANDS } from '../game/types'
import {
  escapeHtml,
  noteRasterCardArtLoadFailure,
  renderCardRules,
  renderCardTile,
  renderLandIcon,
  resetRasterCardArtLoadFailuresForTests,
} from '../renderers/three/native-html'

describe('Three.js native card tile output', () => {
  beforeEach(() => {
    resetRasterCardArtLoadFailuresForTests()
  })

  it.each(BASIC_LANDS)('renders catalog-backed primary and response rules for %s', (name) => {
    const entry = cardCatalogEntry(name)
    const html = renderCardRules({ name })
    expect(html).toContain(`aria-label="${escapeHtml(entry.displayName)} abilities"`)
    expect(html).toContain(`<dt>${escapeHtml(entry.primaryAbility.name)}</dt>`)
    expect(html).toContain(`<dd>${escapeHtml(entry.primaryAbility.rulesText)}</dd>`)
    if (entry.responseAbility) {
      expect(html).toContain(`<dt>${escapeHtml(entry.responseAbility.name)}</dt>`)
      expect(html).toContain(`<dd>${escapeHtml(entry.responseAbility.rulesText)}</dd>`)
    }
    expect(html.match(/<dt>/g)).toHaveLength(entry.responseAbility ? 2 : 1)
  })

  it('does not derive rules from hidden or unknown card names', () => {
    expect(renderCardRules({
      name: '__hidden__', serializedKey: 'Island', displayName: 'Signal Siren',
    })).toBe('')
    expect(renderCardRules({ name: '<script>untrusted</script>' })).toBe('')
    expect(renderCardRules({ name: 'Signal Siren' })).toBe('')
  })

  it('renders Anime card tiles using the shipped PNG as a full-bleed background with an overlaid label', () => {
    const html = renderCardTile({
      name: 'Forest',
      serializedKey: 'Forest',
      displayName: 'Gravebloom Dryad',
      assetSlug: 'gravebloom-dryad',
    }, 'anime')
    expect(html).toContain('src="/cards/anime/gravebloom-dryad.png"')
    expect(html).toContain('data-card-art="gravebloom-dryad"')
    expect(html).toContain('Gravebloom Dryad')
    expect(html).not.toContain('>Forest<')
    // Anime tile uses a dedicated background-image structure (not the small
    // `card-tile-icon` glyph) so the PNG can fill the entire tile.
    expect(html).toContain('card-tile-bg')
    expect(html).toContain('card-tile-label')
    expect(html).toContain('card-tile--raster')
    expect(html).not.toContain('card-tile-icon')
    // Anime art falls back to the geometric hd-fallback PNG first
    // (raster→raster swap, classes preserved), then to procedural SVG via a
    // chained second-hop onerror. Both URLs appear in the initial render.
    expect(html).toContain('onerror=')
    expect(html).toContain('/cards/hd-fallback/gravebloom-dryad.png')
    // The chained second-hop handler embeds the procedural URL so it can reach
    // procedural SVG even when the first fallback raster also fails.
    expect(html).toContain('data:image/svg+xml')
  })

  it('applies monochrome as an image-filter class independently of the selected style', () => {
    const html = renderCardTile('Forest', 'anime', true)
    expect(html).toContain('src="/cards/anime/gravebloom-dryad.png"')
    expect(html).toContain('three-card--monochrome')
  })

  it('renders Classic card tiles using the procedural SVG and palette swatch', () => {
    const html = renderCardTile('Mountain', 'classic')
    expect(html).not.toContain('src="/cards/classic/rooftop-gargoyle.png"')
    expect(html).toContain('src="data:image/svg+xml')
    expect(html).toContain('--tile-fill:')
    expect(html).not.toContain('card-tile--raster')
    expect(html).not.toContain('card-tile-icon--raster')
    expect(html).not.toContain('onerror=')
    expect(html).toContain('Rooftop Gargoyle')
    expect(html).toContain('data-card-art="rooftop-gargoyle"')
  })

  it('keeps the procedural icon for tiny action glyphs even in Anime mode', () => {
    const html = renderLandIcon('Island', 'anime', 16, 'action-icon', { forceProcedural: true })
    expect(html).toContain('src="data:image/svg+xml')
    expect(html).not.toContain('/cards/anime/signal-siren.png')
    expect(html).not.toContain('action-icon--raster')
    expect(html).not.toContain('onerror=')
  })

  it('uses the Anime PNG (with raster class) for normal-sized glyphs and chains to the fallback raster first', () => {
    const html = renderLandIcon('Swamp', 'anime', 22, 'card-tile-icon')
    expect(html).toContain('src="/cards/anime/memory-vampire.png"')
    expect(html).toContain('card-tile-icon--raster')
    expect(html).toContain('/cards/hd-fallback/memory-vampire.png')
    // The chained second-hop handler removes the raster class when the raster
    // fallback also fails; the procedural URL is embedded for that second hop.
    expect(html).toContain("this.classList.remove(&#39;card-tile-icon--raster&#39;)")
    expect(html).toContain('data:image/svg+xml')
  })

  it('advances to the geometric fallback after the Anime URL has failed in-session', () => {
    noteRasterCardArtLoadFailure('/cards/anime/gravebloom-dryad.png')
    const iconHtml = renderLandIcon('Forest', 'anime', 22, 'card-tile-icon')
    // Now serves the geometric raster fallback directly; onerror drops to
    // procedural SVG and strips raster classes.
    expect(iconHtml).toContain('src="/cards/hd-fallback/gravebloom-dryad.png"')
    expect(iconHtml).toContain('card-tile-icon--raster')
    expect(iconHtml).toContain('onerror=')
    expect(iconHtml).toContain('data:image/svg+xml')
    expect(iconHtml).toContain("this.classList.remove(&#39;card-tile-icon--raster&#39;)")

    const tileHtml = renderCardTile('Forest', 'anime')
    expect(tileHtml).toContain('src="/cards/hd-fallback/gravebloom-dryad.png"')
    expect(tileHtml).toContain('card-tile--raster')
  })

  it('uses procedural art directly after both raster URLs have failed in-session', () => {
    noteRasterCardArtLoadFailure('/cards/anime/gravebloom-dryad.png')
    noteRasterCardArtLoadFailure('/cards/hd-fallback/gravebloom-dryad.png')
    const iconHtml = renderLandIcon('Forest', 'anime', 22, 'card-tile-icon')
    expect(iconHtml).toContain('src="data:image/svg+xml')
    expect(iconHtml).not.toContain('/cards/anime/gravebloom-dryad.png')
    expect(iconHtml).not.toContain('/cards/hd-fallback/gravebloom-dryad.png')
    expect(iconHtml).not.toContain('card-tile-icon--raster')
    expect(iconHtml).not.toContain('onerror=')

    const tileHtml = renderCardTile('Forest', 'anime')
    expect(tileHtml).not.toContain('card-tile--raster')
    expect(tileHtml).toContain('--tile-fill:')
  })

  it('renders a face-down placeholder tile for the hidden-hand sentinel name', () => {
    const html = renderCardTile({
      name: '__hidden__',
      serializedKey: 'Plains',
      displayName: 'Echo Doppelgänger',
      assetSlug: 'untrusted-override',
    }, 'classic')
    expect(html).toContain('card-tile--hidden')
    expect(html).toContain('aria-label="Hidden card"')
    // Must not leak any land name into the rendered tile.
    expect(html).not.toMatch(/Forest|Island|Mountain|Plains|Swamp/)
    expect(html).not.toMatch(/Echo|Doppelgänger|echo-doppelganger|data-card-art/)
  })

  it('keeps Unicode display copy separate from stable palette and legacy art identity', () => {
    const html = renderCardTile({
      name: 'untrusted legacy text',
      serializedKey: 'Plains',
      displayName: 'Echo Doppelgänger <script>',
      assetSlug: 'echo-doppelganger',
    }, 'anime')
    expect(html).toContain('src="/cards/anime/echo-doppelganger.png"')
    expect(html).toContain('three-card--plains')
    expect(html).toContain('data-card-art="echo-doppelganger"')
    expect(html).toContain('Echo Doppelgänger &lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})
