import { cardAssetSlug } from './card-catalog.ts'
import { BASIC_LANDS, type BasicLand } from '../game/types.ts'

export const CARD_VISUAL_GRID_SIZE = 16

export interface CardVisualRecipe {
  readonly serializedKey: BasicLand
  readonly assetSlug: string
  readonly subject: string
  readonly abilityCue: string
  readonly silhouette: readonly string[]
}

function defineRecipe(
  serializedKey: BasicLand,
  subject: string,
  abilityCue: string,
  silhouette: readonly string[],
): CardVisualRecipe {
  return Object.freeze({
    serializedKey,
    assetSlug: cardAssetSlug(serializedKey),
    subject,
    abilityCue,
    silhouette: Object.freeze([...silhouette]),
  })
}

export const CARD_VISUAL_RECIPES = Object.freeze({
  Forest: defineRecipe(
    'Forest',
    'a dryad reclaiming a vine-covered urban ruin',
    'new growth curling around recovered fragments',
    [
      '................',
      '.......#........',
      '....#..#..#.....',
      '.....#####......',
      '....###+###.....',
      '.....#####......',
      '......###.......',
      '.....#####......',
      '....##.#.##.....',
      '...##..#..##....',
      '..##...#...##...',
      '......###.......',
      '.....##.##......',
      '....##...##.....',
      '...##.....##....',
      '................',
    ],
  ),
  Island: defineRecipe(
    'Island',
    'a signal siren listening from an urban radio tower',
    'concentric radio waves carrying an intercepted message',
    [
      '................',
      '.....####.......',
      '....######......',
      '.....####.......',
      '......##...+....',
      '....######..+...',
      '...###.##.##.+..',
      '...##..##..##.+.',
      '......####...+..',
      '......####..+...',
      '......####.+....',
      '.....##..##.....',
      '....##....##....',
      '...##......##...',
      '................',
      '................',
    ],
  ),
  Mountain: defineRecipe(
    'Mountain',
    'a winged stone gargoyle guarding city rooftops',
    'a forceful wingbeat banishing a rival silhouette',
    [
      '................',
      '..##........##..',
      '.####..##..####.',
      '######.##.######',
      '.##############.',
      '...##########...',
      '.....######.....',
      '......####......',
      '.....######.....',
      '....##.##.##....',
      '...##..##..##...',
      '..##...##...##..',
      '.......##.......',
      '......####......',
      '................',
      '................',
    ],
  ),
  Plains: defineRecipe(
    'Plains',
    'two mirrored urban doppelgängers facing one another',
    'a bright echo linking the duplicated figures',
    [
      '................',
      '...##......##...',
      '..####....####..',
      '...##......##...',
      '..####....####..',
      '.######..######.',
      '...##......##...',
      '...##..++..##...',
      '...##..++..##...',
      '..####....####..',
      '..##.##..##.##..',
      '.##...####...##.',
      '##....####....##',
      '......++++......',
      '................',
      '................',
    ],
  ),
  Swamp: defineRecipe(
    'Swamp',
    'a nocturnal memory vampire above a shadowed city',
    'luminous memory wisps drawn toward the vampire',
    [
      '................',
      '......####......',
      '.....######.....',
      '....##+##+##....',
      '.....######.....',
      '...##########...',
      '..###..##..###..',
      '.###...##...###.',
      '##....####....##',
      '.....######.....',
      '......####......',
      '.....##..##.....',
      '....##....##....',
      '...##......##...',
      '..+..........+..',
      '................',
    ],
  ),
} satisfies Readonly<Record<BasicLand, CardVisualRecipe>>)

export const ORDERED_CARD_VISUAL_RECIPES: readonly CardVisualRecipe[] = Object.freeze(
  BASIC_LANDS.map((key) => CARD_VISUAL_RECIPES[key]),
)

export function cardVisualRecipe(key: BasicLand): CardVisualRecipe {
  return CARD_VISUAL_RECIPES[key]
}
