# Adventure deck strength

> [!IMPORTANT]
> AI-versus-AI measurements at `a1eec3c`, made with
> `npm run ai:adventure-decks`. They are not human win rates. Rerun the tool
> after any change to the rules, the AI or the opponent pools.

Every Adventure opponent deck played best-of-three series against the
standard deck (ten of each creature), which the player always uses. The
results are for ordering tiers, rebalancing opponent decks and setting
per-tier difficulty; see [Recommendations](#recommendations).

## Deck legend

| Land | Creature | Ability |
|---|---|---|
| Forest | Gravebloom Dryad | Reclaim: return one creature from your discard pile to your hand |
| Island | Signal Siren | Listen In: draw one card. Intercept: discard Signal Siren and one other card to cancel an opponent's summon |
| Mountain | Rooftop Gargoyle | Banish: send an opposing creature on the board to its owner's discard pile |
| Plains | Echo Doppelgänger | Mimic: repeat the ability of one of your creatures other than Echo Doppelgänger |
| Swamp | Memory Vampire | Drain Memory: choose a card from your opponent's hand for them to discard |

A player wins with five different creatures or five of one creature on the
board, and loses by drawing from an empty deck. Deck IDs, and shorthands such
as Forest/Island, use the engine's land names. A duo deck holds 25 + 25 of
two creatures, and a boss deck 50 of one.

## Key findings

- **Island decides strength at Hard.** Signal Sirens cancel the player's
  summons and refill their owner's hand. At Hard, with the player moving
  first as in Adventure, every duo or boss with them wins at least 62.7% of
  series against the standard deck, and every one without them at most
  30.7%.
- **The Island boss is unbeatable.** It won all 3,400 of its series, in every
  run and seating, and 6,800 of its 6,820 games. It is the boss of one run in
  five.
- **Mountain decks punish weaker play.** Banish crushes Basic and Advanced
  play but fails at Hard. The Mountain boss wins 99.8% of Advanced games but
  31.1% of Hard games, and Mountain/Plains falls from 88.6% to 8.8%.
- **Two bosses have no working ability.** Mimic has nothing to repeat in a
  Plains boss deck, and Reclaim only returns another Gravebloom Dryad. The
  standard deck beats both bosses in at least 87.8% of Advanced and Hard
  games.
- **Five duos are nearly free wins at Hard.** Forest/Plains, Forest/Mountain,
  Forest/Swamp, Mountain/Plains and Plains/Swamp win at most 11.4% of Hard
  games.
- **The map ignores strength.** No deck is more likely than another to come
  early or late, and each non-boss deck is unavoidable on a quarter of maps,
  so difficulty jumps at random.
- **The opponent's AI level matters only for decks with choices.** Against an
  Advanced player, raising the opponent from Basic to Hard lifts the standard
  deck from 30.0% to 93.1% of games, but moves every boss by at most 2.5
  points.
- **Moving first is a handicap at Hard.** The player always moves first. In
  the standard mirror the second player wins 55.2% of Hard games, against
  50.8% at Basic and 51.3% at Advanced.
- **A retry replayed the opponent's deck.** The opponent's deck was never
  reshuffled, so every attempt at a node dealt it the same opening hand and
  draws. Each attempt now reshuffles it; see
  [Recommendations](#recommendations).

## Deck strength summary

Each cell is the deck's game score against the standard deck at the same AI
level, with the standard deck moving first as in Adventure. Bands: Very easy
below 15%, Easy below 40%, Even up to 60%, Hard up to 85% and Extreme above.
Rows are sorted by the Hard score.

| Deck | Basic | Advanced | Hard | Strength or weakness |
|---|---|---|---|---|
| `boss-Island` | 99.7% Extreme | 99.9% Extreme | 99.8% Extreme | Draws with every Siren and cancels the player's summons |
| `dual-Forest-Island` | 86.9% Extreme | 73.9% Hard | 89.8% Extreme | Reclaim returns spent Sirens: the most Intercepts |
| `dual-Island-Swamp` | 61.5% Hard | 50.5% Even | 71.2% Hard | Drain Memory on top of Intercept |
| `dual-Island-Plains` | 69.7% Hard | 49.8% Even | 69.6% Hard | Mimic repeats Listen In: the most extra draws |
| `dual-Island-Mountain` | 85.9% Extreme | 79.5% Hard | 57.2% Even | Banish on top of Intercept; the longest Hard games |
| `standard` | 51.7% Even | 52.2% Even | 56.1% Even | The mirror; moving second helps at Hard |
| `random` | 44.6% Even | 48.8% Even | 53.3% Even | Like the standard deck, with an uneven mix |
| `dual-Mountain-Swamp` | 46.1% Even | 64.1% Hard | 36.7% Easy | Banish and Drain Memory: the best deck without Island at Hard |
| `boss-Mountain` | 93.8% Extreme | 99.8% Extreme | 31.1% Easy | Banish every turn; Hard intercepts more Gargoyles |
| `boss-Swamp` | 55.9% Even | 42.4% Even | 31.1% Easy | Drain Memory every turn |
| `dual-Plains-Swamp` | 21.8% Easy | 19.8% Easy | 11.4% Very easy | Drain Memory only |
| `dual-Mountain-Plains` | 58.5% Even | 88.6% Extreme | 8.8% Very easy | Banish, repeated by Mimic, breaks Advanced play |
| `dual-Forest-Swamp` | 15.6% Easy | 20.2% Easy | 8.1% Very easy | Drain Memory only |
| `boss-Forest` | 33.2% Easy | 12.2% Very easy | 2.6% Very easy | Reclaim only returns another Dryad |
| `dual-Forest-Mountain` | 31.0% Easy | 58.3% Even | 2.3% Very easy | Banish only |
| `boss-Plains` | 33.2% Easy | 12.2% Very easy | 1.6% Very easy | Mimic has nothing to repeat |
| `dual-Forest-Plains` | 9.7% Very easy | 7.2% Very easy | 1.2% Very easy | No disruption at all |

## How run opponents are chosen today

- **Pools.** `buildAdventureOpponentPools` in
  [`adventure-map.ts`](../../src/app/adventure-map.ts) builds 17 decks of 50
  cards:
  - Twelve non-boss decks: the standard deck (ten of each creature), ten duos
    (one for every pair of creatures) and a random deck (each card drawn
    uniformly).
  - Five boss decks, each 50 of one creature.
- **Map.** `generateBranchingAdventureMap` seeds every new run from the clock.
  - It picks one of four fork patterns, each with three non-adjacent two-way
    forks among tiers 1–6.
  - It shuffles the twelve non-boss decks and deals the first nine to tiers
    1–6 in order. The other three sit out.
  - The boss is a random boss deck.
- **No difficulty order.** In 100,000 generated maps, each non-boss deck
  appeared on 75% of maps: unavoidable on a single-node tier on 25% and at a
  fork on 50%, all within half a point. Its mean tier was 3.5. Each boss
  appeared on 20%. These match the exact shuffle odds (9/12, 3/12, 6/12 and
  1/5).
- **Labels.** The map names each roster, such as "Duo: Gravebloom Dryad +
  Signal Siren" or "Boss: Signal Siren specialist", so a player can route
  around a deck at a fork.
- **Player.** The player always uses the standard deck and always moves first.
  It is reshuffled for every attempt from the attempt seed.
- **Opponent deck order.** The opponent's deck is reshuffled for every
  attempt.
  - `deckPairForAdventureGame` in [`adventure.ts`](../../src/app/adventure.ts)
    shuffles a copy of the node's stored deck with a seed derived from the
    attempt seed, so a restarted attempt deals the same order and a retry a
    new one. `legacy-linear` maps keep the stored order.
  - At `a1eec3c`, when these measurements were made, every attempt at a node
    dealt the opponent the same opening hand and draws.
  - A random deck keeps the same cards for the whole run.
- **AI level.** The opponent plays at the lobby's AI level on every tier,
  including the boss, seeded per attempt in
  [`controller.ts`](../../src/app/controller.ts). Nothing scales by tier.
- **Opening hands.** The opponent always draws five cards. Relics can raise the
  player's opening hand to eight cards (Prepared Pack, Scout's Cache) or
  guarantee a chosen creature in it (charms).
- **Chances.** A run starts with three chances and gains one on every third
  consecutive win. A loss costs a chance and retries the node, a draw retries
  it for free, and the run fails at zero chances. Second Wind adds a chance,
  and Guardian Sigil and Streak Anchor soften a loss.
- **Legacy runs.** Unversioned saves load as `legacy-linear` maps that keep
  their stored lineup: six random non-boss decks, then a random boss.

## Method

- **Tool.** `npm run ai:adventure-decks` runs the real engine and AI headless,
  with no UI or browser. A game takes about 3 ms at Basic, 8 ms at Advanced
  and 0.1 s at Hard.
  - The tool is
    [`adventure-decks.tool.ts`](../../src/test/tools/adventure-decks.tool.ts),
    the simulation helpers are in
    [`adventure-deck-sim.ts`](../../src/test/helpers/adventure-deck-sim.ts),
    and the map placement and run model are in
    [`adventure-run-model.ts`](../../src/test/helpers/adventure-run-model.ts).
  - Like `npm run ai:tournament`, it is an opt-in vitest tool, not a
    `cardgame-cli` command:
    [product decision 10](../agent/state-and-persistence.md#adventure-product-decisions)
    keeps Adventure out of the CLI.
- **Decks.** Each game rebuilds the Adventure deck with
  `buildAdventureOpponentPools` and the standard deck with
  `createStarterDeck`, both from the game's seed. Both are therefore
  reshuffled every game, and the random deck is redrawn.
- **Best of three.** A series stops once a side has won two games, or after
  three games, when the side with more wins takes it; equal wins draw the
  series. No game was drawn or unfinished.
- **Seating.** Seating is fixed within a series.
  - `adventure`: the standard deck moves first, as the player does in
    Adventure.
  - `swapped`: the Adventure deck moves first.
- **Levels.**
  - Same level on both sides: 500 series each at Basic and Advanced, and 300
    series at Hard, in both seatings.
  - Stand-in: Advanced plays the standard deck against Basic opponents (500
    series) and Hard opponents (300 series), in the `adventure` seating only.
  - In total: 57,800 series and 133,591 games.
- **Seeds.** Each game's seed derives from its series number and game index,
  the same for every deck and level, so the results reproduce exactly at a
  given revision.
- **Scores.** A score is wins plus half the draws. 95% Wilson intervals are
  within ±4.4 points at 500 series and ±5.7 points at 300 series; the tool's
  reports list every interval.
- **Caveats.**
  - The AI stands in for people.
  - Hard sees the other player's hand, which a human never does.
  - Simulated players have no relics.

## Results

### Series score at each level

This table gives the Adventure deck's series score against the standard deck,
with the same AI level on both sides. The first three columns use the
`adventure` seating, so the standard deck moves first. The last column lets
the Adventure deck move first.

| Deck | Basic | Advanced | Hard | Hard, deck first |
|---|---:|---:|---:|---:|
| `standard` | 52.2% | 54.0% | 59.0% | 42.3% |
| `random` | 41.4% | 48.6% | 53.3% | 44.0% |
| `dual-Forest-Island` | 96.0% | 83.8% | 98.3% | 93.0% |
| `dual-Island-Mountain` | 96.6% | 89.0% | 62.7% | 40.7% |
| `dual-Island-Plains` | 77.4% | 49.8% | 78.3% | 65.3% |
| `dual-Island-Swamp` | 66.6% | 51.2% | 79.7% | 70.7% |
| `dual-Mountain-Swamp` | 44.0% | 71.6% | 30.7% | 37.0% |
| `dual-Mountain-Plains` | 62.4% | 96.4% | 2.0% | 2.7% |
| `dual-Forest-Mountain` | 23.0% | 63.4% | 0.0% | 0.3% |
| `dual-Plains-Swamp` | 12.4% | 10.2% | 3.3% | 4.7% |
| `dual-Forest-Swamp` | 6.8% | 10.2% | 2.3% | 2.3% |
| `dual-Forest-Plains` | 2.2% | 1.8% | 0.0% | 0.0% |
| `boss-Island` | 100.0% | 100.0% | 100.0% | 100.0% |
| `boss-Mountain` | 98.6% | 100.0% | 22.3% | 20.7% |
| `boss-Swamp` | 60.0% | 38.8% | 23.7% | 37.0% |
| `boss-Forest` | 26.6% | 4.2% | 0.3% | 0.0% |
| `boss-Plains` | 26.6% | 4.2% | 0.0% | 0.0% |

The ranking depends on the level:

- **Basic:** the Island and Mountain bosses lead, then Island/Mountain and
  Forest/Island.
- **Advanced:** the Island and Mountain bosses lead, then Mountain/Plains and
  Island/Mountain.
- **Hard:** the Island boss leads, then Forest/Island and the other Island
  duos.

Forest/Island is in the top five at every level, and Forest/Plains is last or
tied for last. The Forest and Plains bosses have identical results at Basic
and Advanced, because their abilities never changed a result there.

### Per-game score against an Advanced player

Each Adventure encounter is a single game, so this table gives game scores.
Advanced plays the standard deck and moves first, and the Adventure deck plays
at the level in each column. The Advanced column is the same-level Advanced
run.

| Deck | Basic opponent | Advanced opponent | Hard opponent |
|---|---:|---:|---:|
| `standard` | 30.0% | 52.2% | 93.1% |
| `random` | 26.3% | 48.8% | 92.8% |
| `dual-Forest-Island` | 70.2% | 73.9% | 97.4% |
| `dual-Island-Mountain` | 67.7% | 79.5% | 97.2% |
| `dual-Island-Plains` | 47.3% | 49.8% | 92.2% |
| `dual-Island-Swamp` | 44.7% | 50.5% | 82.4% |
| `dual-Mountain-Swamp` | 27.9% | 64.1% | 78.1% |
| `dual-Mountain-Plains` | 40.4% | 88.6% | 92.5% |
| `dual-Forest-Mountain` | 10.9% | 58.3% | 73.2% |
| `dual-Plains-Swamp` | 7.4% | 19.8% | 21.3% |
| `dual-Forest-Swamp` | 4.6% | 20.2% | 20.7% |
| `dual-Forest-Plains` | 1.9% | 7.2% | 8.5% |
| `boss-Island` | 99.9% | 99.9% | 100.0% |
| `boss-Mountain` | 97.3% | 99.8% | 99.8% |
| `boss-Swamp` | 42.4% | 42.4% | 44.5% |
| `boss-Forest` | 12.2% | 12.2% | 10.5% |
| `boss-Plains` | 12.2% | 12.2% | 10.0% |

The standard deck at Hard beats Advanced in 93.1% of games, close to the
90.5–92.8% that the
[Adventure difficulty](../implementation/hard-ai-search-roadmap.md#adventure-difficulty)
roadmap item cites.

The opponent's level matters most where the opponent has choices to make.
Every card in a boss deck is the same creature, so Basic and Hard play it
almost alike. Forest/Plains, Forest/Swamp and Plains/Swamp gain at most 16
points from Basic to Hard, and Forest/Plains stays below 9%.

### Seat order

In the standard mirror, the second player wins these shares of the games,
pooled over both seatings:

| Level | Second player's game share | Games |
|---|---:|---:|
| Basic | 50.8% | 2,517 |
| Advanced | 51.3% | 2,493 |
| Hard | 55.2% | 1,497 |

The player always moves first in Adventure, which costs about five points per
Hard game. Moving first also costs the standard, random and Island duo decks
5–22 points of Hard series score (the last column of the series table), while
some decks without Island gain: the Swamp boss gains 13 points.

### Ability use at Hard

Game scores and the Adventure deck's ability uses per game, at Hard in the
`adventure` seating. Turns count both players' turns. Banishes, Drains,
Reclaims and extra draws include the abilities that Mimic repeats.

| Deck | Game score | Turns | Intercepts | Banishes | Drains | Reclaims | Mimics | Extra draws |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `boss-Island` | 99.8% | 14.6 | 2.6 | 0 | 0 | 0 | 0 | 5.3 |
| `dual-Forest-Island` | 89.8% | 20.3 | 4.1 | 0 | 0 | 5.2 | 0 | 2.1 |
| `dual-Island-Swamp` | 71.2% | 20.6 | 2.8 | 0 | 3.9 | 0 | 0 | 3.4 |
| `dual-Island-Plains` | 69.6% | 21.7 | 3.8 | 0 | 0 | 0 | 3.7 | 6.3 |
| `dual-Island-Mountain` | 57.2% | 31.3 | 2.7 | 6.4 | 0 | 0 | 0 | 4.2 |
| `standard` | 56.1% | 25.8 | 2.9 | 2.8 | 2.3 | 3.3 | 1.9 | 1.2 |
| `random` | 53.3% | 26.2 | 2.9 | 2.7 | 2.3 | 3.2 | 2.0 | 1.2 |
| `dual-Mountain-Swamp` | 36.7% | 22.9 | 0 | 4.5 | 3.7 | 0 | 0 | 0 |
| `boss-Mountain` | 31.1% | 26.1 | 0 | 6.6 | 0 | 0 | 0 | 0 |
| `boss-Swamp` | 31.1% | 14.4 | 0 | 0 | 4.0 | 0 | 0 | 0 |
| `dual-Plains-Swamp` | 11.4% | 15.4 | 0 | 0 | 3.7 | 0 | 1.7 | 0 |
| `dual-Mountain-Plains` | 8.8% | 23.5 | 0 | 5.2 | 0 | 0 | 1.9 | 0 |
| `dual-Forest-Swamp` | 8.1% | 14.2 | 0 | 0 | 3.0 | 1.6 | 0 | 0 |
| `boss-Forest` | 2.6% | 11.9 | 0 | 0 | 0 | 2.0 | 0 | 0 |
| `dual-Forest-Mountain` | 2.3% | 19.6 | 0 | 3.1 | 0 | 1.9 | 0 | 0 |
| `boss-Plains` | 1.6% | 11.7 | 0 | 0 | 0 | 0 | 0 | 0 |
| `dual-Forest-Plains` | 1.2% | 11.6 | 0 | 0 | 0 | 1.8 | 0.3 | 0 |

- **Island boss.** Every Signal Siren it summons draws a card (5.3 a game),
  which pays for Intercept's two-card cost (2.6 a game). It wins in under 15
  turns, and the standard deck summons only 3.0 creatures a game against it,
  against 9.6 in the Hard mirror.
- **Island duos.** Intercept slows the player's race to five different
  creatures while the second creature adds pressure. Forest/Island recycles
  Sirens with Reclaim for the most Intercepts, and Island/Plains repeats
  Listen In with Mimic for the most extra draws.
- **Decks without Island.** A duo or boss can win only with five of one
  creature, and without Intercept it cannot stop a summon. Only disruption
  keeps it in the game, and Mountain/Swamp, with both Banish and Drain
  Memory, is the best of them at Hard.
- **Mountain decks.** Below Hard, Banish breaks up the player's five different
  creatures: 7.0–11.4 times a game for the Mountain boss and Mountain/Plains.
  At Hard the standard deck intercepts 4.3 Gargoyles a game against the
  Mountain boss, against 2.4–2.7 at the lower levels, and wins 68.9% of
  games.
- **Forest and Plains bosses.** With no working ability, they play as plain
  racers that move second, and lose the race.

### Run difficulty

A run model estimates how often a stand-in player clears a whole run.

- **Model.** A Markov chain over tier, chances and win streak plays each node
  until it is won or the chances run out.
  - It uses each matchup's per-game results in the `adventure` seating and
    the chance rules: three to start, one more on every third consecutive
    win, and a loss costs one, resets the streak and retries the node.
  - Informed routing takes the fork with the better clear chance. Blind
    routing picks a fork at random.
  - The results average the 100,000 maps behind the placement figures in
    [How run opponents are chosen today](#how-run-opponents-are-chosen-today).
- **Limits.** The model ignores relics and treats retries as independent,
  although at `a1eec3c` a retry repeated the opponent's deck order. It ranks
  run difficulty; it does not predict human results.

| Opponents vs player | Clear, informed | Clear, blind | Island boss | Mountain boss | Forest boss | Plains boss | Swamp boss |
|---|---:|---:|---:|---:|---:|---:|---:|
| Basic vs Basic | 13.0% | 6.7% | 0.2% | 3.7% | 21.7% | 21.7% | 17.6% |
| Basic vs Advanced | 36.7% | 26.7% | 0.2% | 5.1% | 61.5% | 61.4% | 54.8% |
| Advanced vs Advanced | 11.2% | 5.9% | 0.1% | 0.1% | 19.6% | 19.5% | 16.6% |
| Hard vs Advanced | 0.3% | 0.1% | 0.0% | 0.0% | 0.6% | 0.6% | 0.4% |
| Hard vs Hard | 31.0% | 17.2% | 0.2% | 37.1% | 40.3% | 40.4% | 36.9% |

The boss columns give the informed clear rate on maps with that boss.

- **The boss.** The Island boss makes one run in five unwinnable at every
  level, and the Mountain boss nearly does the same below Hard.
- **The route.** Where the boss can be beaten, the six non-boss tiers decide
  the run. Picking the easier fork raises an Advanced player's clear rate
  from 26.7% to 36.7% against Basic opponents, and nearly doubles it in all
  three mirrors.
- **The map.** Maps differ widely. With informed routing, the easiest tenth of
  maps clear at least 77.6% of runs for an Advanced player against Basic
  opponents, and at least 34.0%, 29.5% and 65.0% in the Basic, Advanced and
  Hard mirrors.
- **Levels.** An Advanced player clears 36.7% of runs against Basic opponents
  and 0.3% against Hard ones. A Basic player clears 13.0% against Basic
  opponents.

## Recommendations

1. **Fix the boss pool first.**
   - Remove or rebuild the Island boss. No stand-in won a series against it.
   - Rebuild the Plains and Forest bosses, whose abilities do nothing in a
     single-creature deck, for example as 35 + 15 specialists checked with
     this tool.
   - Keep the Mountain boss off Basic and Advanced runs, where it wins at
     least 93.8% of games.
2. **Order tiers by measured strength, per level.** Deal decks from the
   [strength summary](#deck-strength-summary) bands for the selected AI level,
   weakest first. The bands must follow the level, because Mountain decks
   change bands between Advanced and Hard.
3. **Keep extreme decks off single-node tiers.** An Extreme deck for the
   selected level should appear only at a fork beside an easier deck, so that
   no unavoidable node decides a run.
4. **Reshuffle the opponent's deck for each attempt** from the attempt seed
   when the encounter starts.
   - A restarted attempt keeps its seed, and so its order, so attempts stay
     idempotent and no save format changes.
   - The deck's cards are unchanged, but
     [product decision 8](../agent/state-and-persistence.md#adventure-product-decisions)
     keeps unversioned saves on their exact stored decks. Skip `legacy-linear`
     maps, or get maintainer approval.
   - The schema version can't mark those runs: `migrateLegacyAdventureRun`
     gives a converted run version 2 and a `legacy-linear` map, and its next
     transition saves it that way.
   - **Done:** every attempt on a `linear` or `branching` map reshuffles the
     opponent's deck with `adventureOpponentDeckSeed`; `legacy-linear` maps
     keep the stored order.
5. **Scale the AI level by tier only for decks with choices.** Moving from
   Basic to Hard adds 63–67 points for the standard and random decks, but at
   most 2.5 points for a boss. Tune interactive decks with the level and
   bosses with their cards, passing settings through `chooseAiAction` options
   as the roadmap item describes.
6. **Weigh seat order at Hard.** Moving first costs the player about five
   points per Hard game. The engine always starts seat 0, and the player is
   always seat 0, so moving second needs an engine option or a seat change in
   the app. Consider it only if tier tuning falls short.
7. **Measure again after every change** with the commands below, and update
   this document.

## Reproduce

Add `-- --reporter=verbose` to any command to print one progress line per
deck. On one core, the Hard command takes about 40 minutes and the
Hard-opponent stand-in about 8. Results do not depend on how a run is split:
split by deck with `ADVENTURE_SIM_DECKS` or by matchup, run one process per
CPU, and merge.

```sh
# Same level on both sides, both seatings.
ADVENTURE_SIM_SERIES=500 ADVENTURE_SIM_MATCHUPS=basic,advanced ADVENTURE_SIM_JSON=same-low.json npm run ai:adventure-decks
ADVENTURE_SIM_SERIES=300 ADVENTURE_SIM_MATCHUPS=hard ADVENTURE_SIM_JSON=same-hard.json npm run ai:adventure-decks
# An Advanced player against Basic and Hard opponents, Adventure seating only.
ADVENTURE_SIM_SERIES=500 ADVENTURE_SIM_MATCHUPS=basic:advanced ADVENTURE_SIM_SEATINGS=adventure ADVENTURE_SIM_JSON=standin-basic.json npm run ai:adventure-decks
ADVENTURE_SIM_SERIES=300 ADVENTURE_SIM_MATCHUPS=hard:advanced ADVENTURE_SIM_SEATINGS=adventure ADVENTURE_SIM_JSON=standin-hard.json npm run ai:adventure-decks
# One report from every result file, with map placement and the run model, without playing.
ADVENTURE_SIM_MERGE=same-low.json,same-hard.json,standin-basic.json,standin-hard.json ADVENTURE_SIM_MAPS=100000 ADVENTURE_SIM_OUT=report.md npm run ai:adventure-decks
```

`ADVENTURE_SIM_MAPS` adds the map placement and run model sections behind
[How run opponents are chosen today](#how-run-opponents-are-chosen-today) and
[Run difficulty](#run-difficulty). Map seeds are fixed, so the sections
reproduce exactly; 100,000 maps took about 45 seconds on one core.
