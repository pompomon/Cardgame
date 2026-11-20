# Adventure deck strength

> [!IMPORTANT]
> AI-versus-AI measurements at `a1eec3c`, made with
> `npm run ai:adventure-decks`, then of the rebuilt boss decks and of
> Advanced opponents against a Hard player. The rules and the AI did not
> change between them. They are not human win rates. Rerun the tool after any
> change to the rules, the AI or the opponent pools.

Every Adventure opponent deck played best-of-three series against the
standard deck (ten of each creature), which the player always uses. The
results are for ordering tiers, rebalancing opponent decks and setting
per-tier difficulty; see [Recommendations](#recommendations). The
[boss rebuild](#boss-rebuild) replaced the boss decks after the first
measurements, and [level-ordered maps](#level-ordered-maps) now deal a new
run's decks weakest first for its AI level.

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
two creatures. A boss deck held 50 of one creature until the
[boss rebuild](#boss-rebuild), and now pairs its signature creature with
support.

## Key findings

- **Island decides strength at Hard.** Signal Sirens cancel the player's
  summons and refill their owner's hand. At Hard, with the player moving
  first as in Adventure, every duo with them wins at least 62.7% of series
  against the standard deck, and every duo without them at most 30.7%.
- **Fifty of one creature made broken bosses.** The old Island boss won all
  3,400 of its series, in every run and seating, and 6,800 of its 6,820
  games, so one run in five could not be won. Mimic had nothing to repeat in
  the old Plains boss, and Reclaim only returned another Gravebloom Dryad in
  the old Forest boss: the standard deck beat both in at least 87.8% of
  Advanced and Hard games.
- **The rebuilt bosses are beatable at every level.** Each pairs its signature
  creature with support chosen by simulation, and wins 46.4–75.0% of games
  against the standard deck at the same level; see
  [Boss rebuild](#boss-rebuild).
- **Mountain decks punish weaker play.** Banish crushes Basic and Advanced
  play but fails at Hard. Mountain/Plains wins 88.6% of Advanced games but
  8.8% of Hard games, and the old Mountain boss fell from 99.8% to 31.1%.
- **Five duos are nearly free wins at Hard.** Forest/Plains, Forest/Mountain,
  Forest/Swamp, Mountain/Plains and Plains/Swamp win at most 11.4% of Hard
  games.
- **The map ignored strength.** No deck was more likely than another to come
  early or late, and each non-boss deck was unavoidable on a quarter of maps,
  so difficulty jumped at random. New maps deal the weakest decks first for
  the run's AI level and put Extreme decks only at forks. In the mirrors,
  tiers 1–2 now end 0.2–8.8% of informed runs, down from 22.6–33.5%, while
  blind clear rates move by at most 0.8 points; see
  [Level-ordered maps](#level-ordered-maps).
- **The opponent's AI level matters only for decks with choices.** Against an
  Advanced player, raising the opponent from Basic to Hard lifts the standard
  deck from 30.0% to 93.1% of games, but moved every old boss by at most 2.5
  points. The rebuilt bosses have choices, and gain 11.2–47.3 points.
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
Rows are sorted by the Hard score. Boss rows are the rebuilt decks;
[Results](#results) gives the old ones.

| Deck | Basic | Advanced | Hard | Strength or weakness |
|---|---|---|---|---|
| `dual-Forest-Island` | 86.9% Extreme | 73.9% Hard | 89.8% Extreme | Reclaim returns spent Sirens: the most Intercepts |
| `dual-Island-Swamp` | 61.5% Hard | 50.5% Even | 71.2% Hard | Drain Memory on top of Intercept |
| `boss-Island` | 66.3% Hard | 58.1% Even | 70.3% Hard | Sirens with six of each other creature: nearly half its Hard wins are five different |
| `dual-Island-Plains` | 69.7% Hard | 49.8% Even | 69.6% Hard | Mimic repeats Listen In: the most extra draws |
| `boss-Swamp` | 73.0% Hard | 60.5% Hard | 60.2% Hard | Mostly Drain Memory, with a few Sirens |
| `dual-Island-Mountain` | 85.9% Extreme | 79.5% Hard | 57.2% Even | Banish on top of Intercept; the longest Hard games |
| `standard` | 51.7% Even | 52.2% Even | 56.1% Even | The mirror; moving second helps at Hard |
| `boss-Plains` | 71.2% Hard | 46.4% Even | 55.3% Even | Mimic repeats Listen In, much like Island/Plains |
| `boss-Forest` | 75.0% Hard | 63.5% Hard | 54.9% Even | Mostly Reclaim, with a few Sirens |
| `boss-Mountain` | 62.4% Hard | 73.1% Hard | 54.1% Even | Banish and Drain Memory: strongest at Advanced |
| `random` | 44.6% Even | 48.8% Even | 53.3% Even | Like the standard deck, with an uneven mix |
| `dual-Mountain-Swamp` | 46.1% Even | 64.1% Hard | 36.7% Easy | Banish and Drain Memory: the best deck without Island at Hard |
| `dual-Plains-Swamp` | 21.8% Easy | 19.8% Easy | 11.4% Very easy | Drain Memory only |
| `dual-Mountain-Plains` | 58.5% Even | 88.6% Extreme | 8.8% Very easy | Banish, repeated by Mimic, breaks Advanced play |
| `dual-Forest-Swamp` | 15.6% Easy | 20.2% Easy | 8.1% Very easy | Drain Memory only |
| `dual-Forest-Mountain` | 31.0% Easy | 58.3% Even | 2.3% Very easy | Banish only |
| `dual-Forest-Plains` | 9.7% Very easy | 7.2% Very easy | 1.2% Very easy | No disruption at all |

## How run opponents are chosen today

- **Pools.** `buildAdventureOpponentPools` in
  [`adventure-map.ts`](../../src/app/adventure-map.ts) builds 17 decks of 50
  cards:
  - Twelve non-boss decks: the standard deck (ten of each creature), ten duos
    (one for every pair of creatures) and a random deck (each card drawn
    uniformly).
  - Five boss decks, each its signature creature, the plurality, with
    support from `ADVENTURE_BOSS_LAND_COUNTS`; see
    [Boss rebuild](#boss-rebuild). Until then each was 50 of one creature,
    and runs started before the rebuild keep those stored decks.
- **Map.** `generateBranchingAdventureMap` seeds every new run from the clock
  and orders it for the AI level selected when the run starts.
  - It picks one of four fork patterns, each with three non-adjacent two-way
    forks among tiers 1–6.
  - It shuffles the twelve non-boss decks and takes the first nine. The other
    three sit out.
  - It deals them to tiers 1–6 weakest first, by their band at that level in
    `ADVENTURE_DECK_BANDS`
    ([`adventure-difficulty.ts`](../../src/app/adventure-difficulty.ts)),
    copied from the [strength summary](#deck-strength-summary). Each Extreme
    deck sits at one of the latest forks, beside an Even or easier deck.
  - The boss is a random boss deck.
- **Difficulty order.** Each non-boss deck appears on 75% of maps and each
  boss on 20%, the exact shuffle odds, and the levels share each seed's nine
  decks, forks and boss. Very easy decks have a mean tier of 1.0–1.8, and no
  Extreme deck is ever unavoidable. Until
  [level ordering](#level-ordered-maps), every deck was unavoidable on a
  single-node tier on 25% of maps, with a mean tier of 3.5.
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
  The run doesn't store the level, which the lobby keeps for the session
  only, starting at Basic. A level changed during a run changes how the
  opponents play, but the map keeps the order of the level the run started
  at.
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
  - The [boss rebuild](#boss-rebuild) measured the new boss decks the same
    way, with the same series numbers: 17,000 series and 41,504 games.
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

These results are from `a1eec3c`, before the [boss rebuild](#boss-rebuild),
so their `boss-*` rows are the old decks of fifty of one creature. The boss
rebuild gives the new bosses in the same forms.

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

- **Basic:** the old Island and Mountain bosses lead, then Island/Mountain
  and Forest/Island.
- **Advanced:** the old Island and Mountain bosses lead, then
  Mountain/Plains and Island/Mountain.
- **Hard:** the old Island boss leads, then Forest/Island and the other
  Island duos.

Forest/Island is in the top five at every level, and Forest/Plains is last or
tied for last. The old Forest and Plains bosses had identical results at
Basic and Advanced, because their abilities never changed a result there.

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
Every card in an old boss deck was the same creature, so Basic and Hard
played it almost alike. Forest/Plains, Forest/Swamp and Plains/Swamp gain at most 16
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
some decks without Island gain: the old Swamp boss gains 13 points.

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

- **Old Island boss.** Every Signal Siren it summoned drew a card (5.3 a
  game), which paid for Intercept's two-card cost (2.6 a game). It won in
  under 15 turns, and the standard deck summoned only 3.0 creatures a game
  against it, against 9.6 in the Hard mirror.
- **Island duos.** Intercept slows the player's race to five different
  creatures while the second creature adds pressure. Forest/Island recycles
  Sirens with Reclaim for the most Intercepts, and Island/Plains repeats
  Listen In with Mimic for the most extra draws.
- **Decks without Island.** A duo or old boss can win only with five of one
  creature, and without Intercept it cannot stop a summon. Only disruption
  keeps it in the game, and Mountain/Swamp, with both Banish and Drain
  Memory, is the best of them at Hard.
- **Mountain decks.** Below Hard, Banish breaks up the player's five different
  creatures: 7.0–11.4 times a game for the old Mountain boss and
  Mountain/Plains. At Hard the standard deck intercepts 4.3 Gargoyles a game
  against the old Mountain boss, against 2.4–2.7 at the lower levels, and
  wins 68.9% of games.
- **Old Forest and Plains bosses.** With no working ability, they played as
  plain racers that move second, and lost the race.

### Run difficulty

A run model estimates how often a stand-in player clears a whole run.

- **Model.** A Markov chain over tier, chances and win streak plays each node
  until it is won or the chances run out.
  - It uses each matchup's per-game results in the `adventure` seating and
    the chance rules: three to start, one more on every third consecutive
    win, and a loss costs one, resets the streak and retries the node.
  - Informed routing takes the fork with the better clear chance. Blind
    routing picks a fork at random.
  - The results average 100,000 maps dealt in shuffled order, as maps were
    before [level ordering](#level-ordered-maps).
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

- **The boss.** The old Island boss made one run in five unwinnable at every
  level, and the old Mountain boss nearly did the same below Hard. The
  rebuilt bosses fix this; see [Boss rebuild](#boss-rebuild).
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

## Boss rebuild

[Recommendation 1](#recommendations) asked for bosses that a player can
always beat. Each boss is now its signature creature, the plurality of its
deck, with support creatures chosen by simulation. One composition serves
every level. A boss keeps its `boss-<Land>` ID and `mono` kind, and the map
still names it "Boss: <creature> specialist" after its signature creature,
so the save format and the interface are unchanged.

| Boss | Deck | Basic | Advanced | Hard | Old Basic | Old Advanced | Old Hard |
|---|---|---:|---:|---:|---:|---:|---:|
| `boss-Forest` | 45 Forest, 5 Island | 75.0% | 63.5% | 54.9% | 33.2% | 12.2% | 2.6% |
| `boss-Island` | 26 Island, 6 of each other land | 66.3% | 58.1% | 70.3% | 99.7% | 99.9% | 99.8% |
| `boss-Mountain` | 26 Mountain, 20 Swamp, 4 Island | 62.4% | 73.1% | 54.1% | 93.8% | 99.8% | 31.1% |
| `boss-Plains` | 28 Plains, 22 Island | 71.2% | 46.4% | 55.3% | 33.2% | 12.2% | 1.6% |
| `boss-Swamp` | 45 Swamp, 5 Island | 73.0% | 60.5% | 60.2% | 55.9% | 42.4% | 31.1% |

Cells are game scores against the standard deck at the same AI level, with
the standard deck moving first. The old columns are the decks of fifty of one
creature.

- **Target.** A boss should be among the hardest nodes of a run but never
  decide it alone: Even or Hard at every level, 40–85% of games, and near
  60%. The rebuilt bosses win 46.4–75.0%, so a player as strong as the AI
  wins at least one boss game in four.
- **One table for every level.** `ADVENTURE_BOSS_LAND_COUNTS` in
  [`adventure-map.ts`](../../src/app/adventure-map.ts) holds the five
  compositions. A test keeps the signature creature the plurality and first
  in the boss's lands, which name the boss on the map.

### Series score, rebuilt bosses

Series scores against the standard deck at the same AI level, as in
[Series score at each level](#series-score-at-each-level). Adventure plays
single games with the player moving first, so the game scores above set run
difficulty.

| Boss | Basic | Advanced | Hard | Hard, deck first |
|---|---:|---:|---:|---:|
| `boss-Forest` | 85.6% | 71.2% | 58.7% | 42.3% |
| `boss-Island` | 74.2% | 61.4% | 78.3% | 71.3% |
| `boss-Mountain` | 69.0% | 82.4% | 56.7% | 46.3% |
| `boss-Plains` | 80.8% | 42.8% | 57.3% | 53.0% |
| `boss-Swamp` | 83.6% | 66.0% | 66.0% | 69.7% |

### Against an Advanced player

Game scores with Advanced playing the standard deck and moving first, as in
[Per-game score against an Advanced player](#per-game-score-against-an-advanced-player).

| Boss | Basic opponent | Advanced opponent | Hard opponent |
|---|---:|---:|---:|
| `boss-Forest` | 62.6% | 63.5% | 75.8% |
| `boss-Island` | 48.1% | 58.1% | 95.4% |
| `boss-Mountain` | 44.0% | 73.1% | 89.5% |
| `boss-Plains` | 43.7% | 46.4% | 88.3% |
| `boss-Swamp` | 58.8% | 60.5% | 70.0% |

The rebuilt bosses have choices, so the opponent's level now matters for
them, as it does for the standard deck (30.0%, 52.2% and 93.1%). An Advanced
player beats a Hard boss in 4.6–30.0% of games.

### Ability use at Hard, rebuilt bosses

| Boss | Game score | Turns | Intercepts | Banishes | Drains | Reclaims | Mimics | Extra draws |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `boss-Island` | 70.3% | 24.8 | 3.7 | 1.5 | 1.4 | 1.9 | 1.1 | 4.4 |
| `boss-Swamp` | 60.2% | 16.0 | 0.9 | 0 | 4.3 | 0 | 0 | 0.0 |
| `boss-Plains` | 55.3% | 20.6 | 3.4 | 0 | 0 | 0 | 3.2 | 5.1 |
| `boss-Forest` | 54.9% | 15.2 | 1.9 | 0 | 0 | 4.3 | 0 | 0.0 |
| `boss-Mountain` | 54.1% | 27.0 | 0.9 | 5.8 | 3.9 | 0 | 0 | 0.2 |

- **Island boss.** Six of each other creature let it win with five different
  creatures, which it did in 244 of its 504 Hard wins. The old boss won only
  with five Sirens.
- **Forest and Plains bosses.** Their abilities now have targets: the
  Forest boss reclaims 4.3 times a game, and the Plains boss mimics 3.2
  times, with 22 Signal Sirens to copy.
- **Mountain boss.** Twenty Memory Vampires add Drain Memory to Banish, and
  four Sirens a few Intercepts.

### Run difficulty with the rebuilt bosses

The [run model](#run-difficulty) on the same maps, with the rebuilt bosses:

| Opponents vs player | Clear, informed | Clear, blind | Island boss | Mountain boss | Forest boss | Plains boss | Swamp boss |
|---|---:|---:|---:|---:|---:|---:|---:|
| Basic vs Basic | 13.9% | 7.1% | 15.0% | 16.1% | 12.2% | 13.5% | 12.8% |
| Basic vs Advanced | 50.9% | 36.3% | 52.9% | 54.4% | 45.2% | 54.5% | 47.4% |
| Advanced vs Advanced | 13.3% | 7.0% | 13.9% | 10.4% | 12.8% | 16.0% | 13.4% |
| Hard vs Advanced | 0.2% | 0.0% | 0.1% | 0.1% | 0.3% | 0.1% | 0.3% |
| Hard vs Hard | 29.6% | 16.0% | 24.6% | 31.5% | 31.4% | 31.3% | 29.2% |

- **No boss decides a run.** In each mirror, the informed clear rates on
  maps with each boss are within 6.9 points of each other, where they
  spread over 19.5–40.2 points before.
- **Overall clear rates barely moved** in the mirrors: the Island boss became
  beatable, and the Forest and Plains bosses harder. An Advanced player
  against Basic opponents clears 50.9% of runs, up from 36.7%.
- **The route still decides most runs.** Recommendations 2 and 3 address the
  six non-boss tiers; see [Level-ordered maps](#level-ordered-maps).

### How the bosses were chosen

- **Candidates.** The tool's `mix-<Land><count>-…` deck IDs build any 50-card
  deck, such as `mix-Forest45-Island5`; see [Reproduce](#reproduce).
- **Screen.** All in the `adventure` seating:
  - Round 1: 95 candidates at Basic, Advanced and Basic against Advanced,
    200 series each, and 18 of them at Hard and Hard against Advanced, 100
    series each.
  - Round 2: 50 candidates near the best of round 1, and 17 at Hard.
- **Confirmation.** 11 finalists on fresh seeds, from series 10,001: 300
  series at Basic, Advanced and Basic against Advanced, and 200 at Hard and
  Hard against Advanced. Scores moved by −6.3 to +5.2 points from the
  screen, 1.9 down on average, so the choice used the confirmation scores.
  Each boss is a finalist inside the target at all three levels, chosen for
  scores near 60% and a deck unlike a duo.
- **Measurement.** The five chosen decks, measured like the other decks in
  [Method](#method).

What the screen showed, in screen scores:

- **Five Sirens make a boss work.** Forest 45 + Island 5 won 64.7% of
  Advanced games, and with 5 Gargoyles or 5 Doppelgängers instead of the
  Sirens, 10.6%. Swamp 45 won 61.6% with 5 Sirens and 44.7% with 5
  Gargoyles.
- **Most 35 + 15 specialists failed**, the shape recommendation 1 suggested:
  - Too strong: Forest 35 + Island 15 and Mountain 35 + Island 15 won 91.2%
    and 93.4% of Basic games, Mountain 35 + Swamp 15 and Mountain 35 +
    Plains 15 won 91.3% and 99.3% of Advanced games, and Island 35 + Swamp
    15 won 91.1% of Hard games.
  - Too weak: Forest 35 with 15 Mountain, Plains or Swamp, and Plains 35 +
    Swamp 15, won at most 19.2% of Advanced games.
  - Swamp 35 + Island 15 passed, but Swamp 45 + Island 5 was nearer 60% at
    Hard: 65.2% against 72.8%.
- **Fewer Sirens brought the Island boss down at Hard.** Island 30 + Swamp
  20, Island 30 + Plains 20 and a five-land deck with 30 Island won
  79.1–81.7% of Hard games. With 26 Island, the five-land deck won 73.7%.
- **A few Sirens rescued the Mountain boss at Hard.** Mountain 30 + Swamp 20
  won 80.5% of Advanced games but 36.8% of Hard games. Trading 4 Gargoyles
  for Sirens gave 74.5% and 51.2%.
- **The Plains boss needed Sirens, not Gargoyles.** Plains decks with 8–15
  Gargoyles won 7.1–13.3% of Hard games, even with 10–12 Sirens. Plains 28
  + Island 22 won 53.5%.

### Options considered

- **Chosen: a signature creature with support**, one composition for every
  level, which keeps the map, saves and interface unchanged.
- **Per-level compositions** could hit the target more tightly, but the map
  would need the run's AI level when it is built, and a level change during
  a run would leave the boss tuned for another level.
- **35 + 15 specialists** mostly failed; see above.
- **Removing the Island boss** fixes one boss of five.
- **A lower AI level for the boss** moved the old bosses by at most 2.5
  points.
- **Handicaps, such as a smaller opening hand for the boss,** give the
  Forest and Plains bosses no working ability, and Sirens refill a hand.
- **26 Island + 24 Plains for the Island boss** scored like the chosen
  five-land deck, but nearly repeats the Island/Plains duo.

### Caveats

- The Plains boss, 28 + 22, is close to the Island/Plains duo, 25 + 25.
- The Mountain boss is the weakest at Hard and the strongest at Advanced.
- A Hard boss beats an Advanced player in 70.0–95.4% of games, as the Hard
  standard deck does in 93.1%.
- Runs started before the rebuild keep their stored bosses, including the
  old Island boss.

## Level-ordered maps

[Recommendations 2 and 3](#recommendations) asked for tiers ordered by
measured strength at the selected AI level, with Extreme decks only at forks.
New maps now do both. Stored maps keep their decks and order, so runs
started before keep their shuffled maps, and the save format is unchanged.

- **Bands.** `ADVENTURE_DECK_BANDS` in
  [`adventure-difficulty.ts`](../../src/app/adventure-difficulty.ts) holds
  each non-boss deck's band at each level, copied from the
  [strength summary](#deck-strength-summary). Change a band only with new
  measurements here.
- **Same decks at every level.** The seed picks the fork pattern, the nine
  decks and the boss as before. No level has more than two Extreme decks for
  the three forks, so every level deals the same decks for a seed, each in
  its own order.
- **Order.** `generateBranchingAdventureMap` deals decks from tier 1 on,
  weakest band first, in shuffled order within a band. Each Extreme deck
  sits at one of the latest forks, beside the strongest remaining Even or
  easier deck, so a player can always route around it. A new seed purpose,
  `forkLanes`, picks which lane of a fork holds which deck.
- **Level.** The map is ordered for the AI level selected when the run
  starts; see [How run opponents are chosen today](#how-run-opponents-are-chosen-today).

### Placement

Each cell is a band's mean tier, then how often each of its decks is
unavoidable, on a single-node tier, over the tool's 100,000 map seeds. Every
non-boss deck is still on 75% of maps. Before level ordering, every deck's
mean tier was 3.5, and it was unavoidable on 25% of maps.

| Maps | Very easy | Easy | Even | Hard | Extreme |
|---|---|---|---|---|---|
| Basic | 1.0, 19% | 1.7, 26% | 4.1, 18% | 4.8, 65% | 4.9, 0% |
| Advanced | 1.0, 19% | 1.4, 17% | 3.6, 25% | 4.8, 41% | 5.7, 0% |
| Hard | 1.8, 26% | 3.3, 21% | 4.6, 18% | 5.1, 48% | 5.7, 0% |

### Run model on ordered maps

The [run model](#run-difficulty) with the rebuilt bosses, on the same map
seeds dealt in shuffled order and ordered for the opponents' level. The
Advanced vs Hard row, Advanced opponents against a Hard player, was measured
for the ramp below.

| Opponents vs player | Informed, shuffled | Informed, ordered | Blind, shuffled | Blind, ordered | Informed p10–p90, shuffled | Informed p10–p90, ordered |
|---|---:|---:|---:|---:|---|---|
| Basic vs Basic | 13.9% | 15.1% | 7.1% | 7.9% | 4.5–26.9% | 8.8–22.6% |
| Basic vs Advanced | 50.9% | 55.2% | 36.3% | 39.1% | 31.5–72.0% | 43.4–67.7% |
| Advanced vs Advanced | 13.3% | 10.7% | 7.0% | 6.7% | 4.3–25.1% | 5.7–17.4% |
| Advanced vs Hard | 92.1% | 91.1% | 87.6% | 87.0% | 84.0–98.5% | 82.7–98.1% |
| Hard vs Advanced | 0.2% | 0.1% | 0.0% | 0.0% | 0.0–0.5% | 0.0–0.2% |
| Hard vs Hard | 29.6% | 25.6% | 16.0% | 16.8% | 8.5–53.8% | 15.2–38.2% |

Where informed runs end:

| Opponents vs player | Maps | Tier 1 | Tier 2 | Tier 3 | Tier 4 | Tier 5 | Tier 6 | Boss | Clear |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Basic vs Basic | Shuffled | 10.8% | 19.5% | 15.6% | 12.4% | 10.8% | 6.4% | 10.6% | 13.9% |
| Basic vs Basic | Ordered | 0.3% | 4.3% | 16.7% | 19.0% | 20.0% | 11.7% | 13.0% | 15.1% |
| Basic vs Advanced | Shuffled | 3.7% | 8.1% | 7.6% | 6.6% | 7.2% | 4.3% | 11.7% | 50.9% |
| Basic vs Advanced | Ordered | 0.0% | 0.7% | 4.5% | 6.8% | 10.4% | 7.8% | 14.6% | 55.2% |
| Advanced vs Advanced | Shuffled | 12.6% | 20.9% | 16.7% | 12.7% | 10.6% | 6.3% | 7.0% | 13.3% |
| Advanced vs Advanced | Ordered | 0.3% | 8.5% | 19.0% | 24.2% | 20.3% | 10.5% | 6.5% | 10.7% |
| Hard vs Advanced | Shuffled | 38.6% | 34.1% | 15.1% | 7.4% | 3.2% | 1.1% | 0.4% | 0.2% |
| Hard vs Advanced | Ordered | 9.3% | 21.4% | 27.7% | 28.5% | 10.6% | 2.1% | 0.3% | 0.1% |
| Hard vs Hard | Shuffled | 7.9% | 14.7% | 11.6% | 9.6% | 10.0% | 5.8% | 10.7% | 29.6% |
| Hard vs Hard | Ordered | 0.0% | 0.2% | 3.5% | 14.8% | 23.9% | 19.1% | 12.8% | 25.6% |

- **A ramp instead of a lottery.** In the mirrors, tiers 1–2 end 0.2–8.8% of
  informed runs, down from 22.6–33.5%; most runs now end on tiers 3–6 or at
  the boss.
- **Maps are more alike.** In the Hard mirror, the 10th and 90th percentile
  maps give an informed run a 15.2% and a 38.2% clear chance, against 8.5%
  and 53.8%. The spread narrows in every mirror.
- **Difficulty barely moves.** Blind clear rates move by at most 0.8 points
  in the mirrors. Informed rates fall 2.6 and 4.0 points in the Advanced and
  Hard mirrors: apart from the Extreme forks, a fork now pairs decks of
  similar strength, so choosing a fork gains less.
- **Hard decks are often unavoidable late.** Extreme decks take the latest
  forks, so Hard-band decks sit on single-node tiers on 41–65% of maps, up
  from 25%. The clear rates above include this.
- **Hard opponents still beat an Advanced player.** Ordering moves where
  those runs end, from tiers 1–2 to tiers 3–4, but 0.1% still clear.

### Orders considered

A screen of generator variants with the run model, not kept in the tool,
chose the order:

- **Chosen: weakest first, with each Extreme deck at one of the latest
  forks** beside the strongest Even or easier deck.
- **Sorting alone** puts the strongest decks last, where a player often
  can't route around an Extreme deck, against recommendation 3.
- **Pairing each Extreme deck with the easiest deck** moves the easiest
  decks late, so 15.6% of runs in the Basic mirror still ended on tiers 1–2.
- **The three strongest decks as fork alternatives to easy decks** make them
  optional, with no reward for taking them. That nearly doubled the informed
  clear rate in the Hard mirror, to 52.1%, which changes run difficulty
  rather than its order.

### A lower level for early tiers

[Recommendation 5](#recommendations) would scale the AI level by tier. The
run model can play a run's first tiers one level lower, when the lower level
was measured against the same player:

| Opponents vs player | Maps | All tiers | Tiers 1–2 one level lower | Tiers 1–3 one level lower |
|---|---|---:|---:|---:|
| Advanced vs Advanced | Shuffled | 13.3% | 21.0% | 26.5% |
| Advanced vs Advanced | Ordered | 10.7% | 13.0% | 17.1% |
| Hard vs Advanced | Shuffled | 0.2% | 0.7% | 1.4% |
| Hard vs Advanced | Ordered | 0.1% | 0.1% | 0.1% |
| Hard vs Hard | Shuffled | 29.6% | 43.5% | 52.5% |
| Hard vs Hard | Ordered | 25.6% | 25.9% | 28.0% |

Cells are informed clear rates. On shuffled maps, a lower level on tiers 1–3
would add 13.2 and 22.9 points in the mirrors. Ordered maps already put the
weakest decks first, so it adds at most 6.4 points there, and nothing for an
Advanced player against Hard opponents. Basic has no lower level.

## Recommendations

1. **Fix the boss pool first.**
   - Remove or rebuild the Island boss. No stand-in won a series against it.
   - Rebuild the Plains and Forest bosses, whose abilities do nothing in a
     single-creature deck, for example as 35 + 15 specialists checked with
     this tool.
   - Keep the Mountain boss off Basic and Advanced runs, where it wins at
     least 93.8% of games.
   - **Done:** the [boss rebuild](#boss-rebuild) gives every boss its
     signature creature with support. Each wins 46.4–75.0% of games against
     the standard deck at the same level, and the Mountain boss stays on
     every run.
2. **Order tiers by measured strength, per level.** Deal decks from the
   [strength summary](#deck-strength-summary) bands for the selected AI level,
   weakest first. The bands must follow the level, because Mountain decks
   change bands between Advanced and Hard.
   - **Done:** new maps deal decks weakest first for the AI level selected
     when the run starts; see [Level-ordered maps](#level-ordered-maps).
3. **Keep extreme decks off single-node tiers.** An Extreme deck for the
   selected level should appear only at a fork beside an easier deck, so that
   no unavoidable node decides a run.
   - **Done:** each Extreme deck sits at one of the latest forks, beside an
     Even or easier deck.
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
   Basic to Hard adds 63–67 points for the standard and random decks, but
   moved an old boss by at most 2.5 points. The rebuilt bosses have choices
   and gain 11.2–47.3 points. Tune interactive decks with the level, passing
   settings through `chooseAiAction` options as the roadmap item describes.
   - **Deferred:** on ordered maps, playing tiers 1–3 one level lower adds
     at most 6.4 points to the informed clear rate; see
     [A lower level for early tiers](#a-lower-level-for-early-tiers). The
     [roadmap trigger](../implementation/hard-ai-search-roadmap.md#adventure-difficulty),
     player feedback or a target win rate, has not fired, and a lower level
     would silently change what the selected level means.
6. **Weigh seat order at Hard.** Moving first costs the player about five
   points per Hard game. The engine always starts seat 0, and the player is
   always seat 0, so moving second needs an engine option or a seat change in
   the app. Consider it only if tier tuning falls short.
   - **Not done:** it waits for tier tuning.
7. **Measure again after every change** with the commands below, and update
   this document.
   - **Done** for the rebuilt bosses and level-ordered maps.

## Reproduce

Add `-- --reporter=verbose` to any command to print one progress line per
deck. On one core, the Hard command takes about 40 minutes, the
Hard-opponent stand-in about 8 and the Hard player against Advanced
opponents about 11. Results do not depend on how a run is split:
split by deck with `ADVENTURE_SIM_DECKS` or by matchup, run one process per
CPU, and merge.

```sh
# Same level on both sides, both seatings.
ADVENTURE_SIM_SERIES=500 ADVENTURE_SIM_MATCHUPS=basic,advanced ADVENTURE_SIM_JSON=same-low.json npm run ai:adventure-decks
ADVENTURE_SIM_SERIES=300 ADVENTURE_SIM_MATCHUPS=hard ADVENTURE_SIM_JSON=same-hard.json npm run ai:adventure-decks
# An Advanced player against Basic and Hard opponents, Adventure seating only.
ADVENTURE_SIM_SERIES=500 ADVENTURE_SIM_MATCHUPS=basic:advanced ADVENTURE_SIM_SEATINGS=adventure ADVENTURE_SIM_JSON=standin-basic.json npm run ai:adventure-decks
ADVENTURE_SIM_SERIES=300 ADVENTURE_SIM_MATCHUPS=hard:advanced ADVENTURE_SIM_SEATINGS=adventure ADVENTURE_SIM_JSON=standin-hard.json npm run ai:adventure-decks
# A Hard player against Advanced opponents, for the ramp, Adventure seating only.
ADVENTURE_SIM_SERIES=300 ADVENTURE_SIM_MATCHUPS=advanced:hard ADVENTURE_SIM_SEATINGS=adventure ADVENTURE_SIM_JSON=hard-player.json npm run ai:adventure-decks
# One report from every result file, with map placement and the run model on level-ordered maps, without playing.
ADVENTURE_SIM_MERGE=same-low.json,same-hard.json,standin-basic.json,standin-hard.json,hard-player.json ADVENTURE_SIM_MAPS=100000 ADVENTURE_SIM_RAMP_TIERS=2,3 ADVENTURE_SIM_OUT=report.md npm run ai:adventure-decks
# The same maps dealt in shuffled order, as before level ordering.
ADVENTURE_SIM_MERGE=same-low.json,same-hard.json,standin-basic.json,standin-hard.json,hard-player.json ADVENTURE_SIM_MAPS=100000 ADVENTURE_SIM_RAMP_TIERS=2,3 ADVENTURE_SIM_MAP_ORDER=shuffled ADVENTURE_SIM_OUT=report-shuffled.md npm run ai:adventure-decks
```

The [boss rebuild](#boss-rebuild) screened candidate decks and confirmed the
finalists on fresh seeds. A `mix-` deck ID lists lands in the order Forest,
Island, Mountain, Plains, Swamp, with counts that sum to 50. The rebuilt
bosses were then measured with the commands above and
`ADVENTURE_SIM_DECKS=boss-Forest,boss-Island,boss-Mountain,boss-Plains,boss-Swamp`.

```sh
# Screen candidates in the Adventure seating.
ADVENTURE_SIM_DECKS=mix-Forest45-Island5,mix-Island5-Swamp45 ADVENTURE_SIM_SERIES=200 ADVENTURE_SIM_MATCHUPS=basic,advanced,basic:advanced ADVENTURE_SIM_SEATINGS=adventure ADVENTURE_SIM_JSON=screen.json npm run ai:adventure-decks
# Confirm finalists on fresh seeds.
ADVENTURE_SIM_DECKS=mix-Forest45-Island5 ADVENTURE_SIM_SERIES=300 ADVENTURE_SIM_SEED_START=10001 ADVENTURE_SIM_MATCHUPS=basic,advanced,basic:advanced ADVENTURE_SIM_SEATINGS=adventure ADVENTURE_SIM_JSON=confirm.json npm run ai:adventure-decks
ADVENTURE_SIM_DECKS=mix-Forest45-Island5 ADVENTURE_SIM_SERIES=200 ADVENTURE_SIM_SEED_START=10001 ADVENTURE_SIM_MATCHUPS=hard,hard:advanced ADVENTURE_SIM_SEATINGS=adventure ADVENTURE_SIM_JSON=confirm-hard.json npm run ai:adventure-decks
```

`ADVENTURE_SIM_MAPS` adds the map placement and run model sections behind
[How run opponents are chosen today](#how-run-opponents-are-chosen-today),
[Run difficulty](#run-difficulty) and
[Level-ordered maps](#level-ordered-maps). `ADVENTURE_SIM_RAMP_TIERS` adds
the runs whose first tiers play one level lower, and
`ADVENTURE_SIM_MAP_ORDER=shuffled` deals maps as Run difficulty does. Map
seeds are fixed, so the sections reproduce exactly. On one core, 100,000
maps with both ramps took about two and a half minutes for each map order.
