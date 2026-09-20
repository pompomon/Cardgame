import type { BasicLand } from '../game/types'

export interface CardAbilityCopy {
  readonly name: string
  readonly rulesText: string
  readonly effectCaption: string
}

export interface CardCatalogEntry {
  readonly serializedKey: BasicLand
  readonly displayName: string
  readonly assetSlug: string
  readonly primaryAbility: CardAbilityCopy
  readonly responseAbility?: CardAbilityCopy
  readonly visualRole: 'green' | 'blue' | 'red' | 'white' | 'black'
}

function defineCardCatalogEntry(entry: CardCatalogEntry): CardCatalogEntry {
  return Object.freeze({
    ...entry,
    primaryAbility: Object.freeze({ ...entry.primaryAbility }),
    ...(entry.responseAbility
      ? { responseAbility: Object.freeze({ ...entry.responseAbility }) }
      : {}),
  })
}

export const CARD_CATALOG = Object.freeze({
  Forest: defineCardCatalogEntry({
    serializedKey: 'Forest',
    displayName: 'Gravebloom Dryad',
    assetSlug: 'gravebloom-dryad',
    primaryAbility: {
      name: 'Reclaim',
      rulesText: 'Return one creature from your discard pile to your hand.',
      effectCaption: 'Reclaimed',
    },
    visualRole: 'green',
  }),
  Island: defineCardCatalogEntry({
    serializedKey: 'Island',
    displayName: 'Signal Siren',
    assetSlug: 'signal-siren',
    primaryAbility: {
      name: 'Listen In',
      rulesText: 'Draw one card.',
      effectCaption: 'Listened in',
    },
    responseAbility: {
      name: 'Intercept',
      rulesText: "Discard Signal Siren and one other card to cancel an opponent's summon.",
      effectCaption: 'Intercepted',
    },
    visualRole: 'blue',
  }),
  Mountain: defineCardCatalogEntry({
    serializedKey: 'Mountain',
    displayName: 'Rooftop Gargoyle',
    assetSlug: 'rooftop-gargoyle',
    primaryAbility: {
      name: 'Banish',
      rulesText: "Choose an opposing creature on the board and send it to its owner's discard pile.",
      effectCaption: 'Banished to discard pile',
    },
    visualRole: 'red',
  }),
  Plains: defineCardCatalogEntry({
    serializedKey: 'Plains',
    displayName: 'Echo Doppelgänger',
    assetSlug: 'echo-doppelganger',
    primaryAbility: {
      name: 'Mimic',
      rulesText: 'Repeat the ability of one of your creatures other than Echo Doppelgänger.',
      effectCaption: 'Ability mimicked',
    },
    visualRole: 'white',
  }),
  Swamp: defineCardCatalogEntry({
    serializedKey: 'Swamp',
    displayName: 'Memory Vampire',
    assetSlug: 'memory-vampire',
    primaryAbility: {
      name: 'Drain Memory',
      rulesText: "Choose one card from your opponent's hand for them to discard.",
      effectCaption: 'Memory drained',
    },
    visualRole: 'black',
  }),
} satisfies Readonly<Record<BasicLand, CardCatalogEntry>>)

export function cardCatalogEntry(key: BasicLand): CardCatalogEntry {
  return CARD_CATALOG[key]
}

export function displayCardName(key: BasicLand): string {
  return cardCatalogEntry(key).displayName
}

export function cardAssetSlug(key: BasicLand): string {
  return cardCatalogEntry(key).assetSlug
}
