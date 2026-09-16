# Lone syllables at a line break

Design for issue #34, keeping a line break from leaving one syllable of a word
by itself at either side of the break.

- **Target:** core `0.25.0`.
- **Scope:** `layout.js`, `measure.js`, `renderer.js`, `lyrics.js`, `options.js`,
  plus docs and test cases. No other package changes: the editor, the VS Code
  preview and the CLI pick up the new options through `options.js`.
- **Status:** design. Not started.

## 1. Where we are

### 1.1 The line breaker cannot see words

`layoutRows` (`layout.js`) is a greedy fill. It walks the items, adds each one's
`measureItem` width plus the `levelingNeed` reserve, and breaks before the first
item that does not fit. Automatic rows are justified (`finalize(true)`). The
only thing it knows about lyrics is the width each syllable adds to its neume
(`syllableExtra`, set in `renderer.js`).

So it breaks in the middle of a word wherever the width runs out:

```
… kö-                      … könyörülje-
nyörüljetek …              tek …
```

Both are bad engraving. The singer reads one syllable, then has to jump to
the next line for the rest of the word, or finds one syllable waiting at the
start of the next line.

### 1.2 One precedent, for recitations only

A wrapping tenor recitation already keeps a lone word off either side of a
break (`layout.js`, the `recitationGlyphless` branch). A break before piece `p`
of an `N`-word phrase is allowed only when `p === 0` or `2 ≤ p ≤ N-2`, and when
the break isn't allowed it moves words to the next row. It never condenses and
never checks how far the row it leaves behind gets stretched. This design
applies the same rule to syllables, with a proper cost model, and leaves the
recitation rule as it is (§8).

### 1.3 What condensing can use today

The width a row needs is `Σ measureItem + levelingNeed`. That leaves two places
to find room:

- **The leveling reserve.** `levelingNeed` sets aside enough space to raise
  every leveled gap to the widest non-outlier floor (`levelingTarget`, cut off at
  `gapOutlierThreshold`, default 2 SS). The row is justified in the end anyway,
  so `justificationWaterLevel` evens out whatever space is left, whatever the
  threshold. The threshold only decides whether the line breaker *accepts* a
  fit. Lowering it for one row doesn't change how anything is drawn. It
  lets the row accept gaps that can't all be brought to the same width.
- **The natural advance.** A neume with a short syllable takes
  `singleNoteAdvance` (1.9 SS × `noteSpacing`), leaving about 0.73 SS of white
  space after a 1.17 SS notehead. `syllableExtra` is zero there, so the gap is
  wider than the lyrics need. Nothing reclaims that space today: the renderer
  clamps `gapExtras` at zero.

## 2. The rule

A **word** is a run of lyric slots joined by `hyphenAfter` (including the
placeholder slots a melisma or an extender adds, see
`expandSyllablesForLigatures`). A **syllable** is a slot that carries text. A
placeholder slot belongs to the syllable before it. Slots with no real lyric
(`realLyric === false`, e.g. a bare `*`) are not part of any word.

When a word of `n` syllables is broken with `b` syllables before the break and
`n − b` after:

- **orphan:** `b === 1`, one syllable left at the end of the line (`kö-`)
- **widow:** `n − b === 1`, one syllable at the start of the next line (`-tek`)

That gives the same arithmetic as the recitation rule. A break inside a word is
legal only at `2 ≤ b ≤ n−2`. Words of two or three syllables can't be broken
legally at all. `kö-nyö | rül-je-tek` and `könyö-rül | je-tek` are fine.
`kö | nyörüljetek` and `könyörülje | tek` are not.

A break in the middle of a neume (a `/` split inside a melisma) keeps the
syllable with the head. So the break counts as falling after that syllable,
and `b` is the head's syllable number. A split inside a word's last syllable
therefore gives `n − b = 0`. That isn't a widow: the next line starts with notes,
not a syllable.

**Every stanza counts.** A break's violations are added up across the stanzas,
since stanzas can have different words at the same neume. One stanza with a lone
syllable is a flaw on the page even if the others read well.

**Manual breaks are never touched.** `(z)` and `(Z)` are the author's decision.
A candidate row never moves content across them, and the break before them is
not scored.

## 3. Algorithm

We still go line by line, as the issue allows. Each automatic break the greedy
fill proposes is checked, and only a break that leaves a lone syllable triggers
a local search. A score with none renders exactly as today.

### 3.1 Candidates

Let `G` be the greedy break, and `W` the span of neumes covered by the words
that `G` breaks (in any stanza). The candidates are:

- **`G` itself.** It is always allowed.
- **Push forward.** Breaks after `G`, up to and including the end of `W`. The
  row takes in more neumes and has to be condensed (§3.3). Candidates are tried
  in order, stopping at the first one that can't be condensed enough, because
  the needed condensing only grows.
- **Pull back.** Breaks before `G`, down to and including the start of `W`.
  The row gives up neumes and is stretched when justified (§3.4). A candidate
  must leave at least one neume on the row.

Only positions where the greedy fill could break count (before a neume, or
before an accidental glued to its neume). Positions in the middle of a neume
aren't candidates, except `G` when `G` itself is one. Push forward takes in the
whole rest of that neume, and pull back gives up the whole neume. No candidate
crosses a manual break, a clef or key signature change, or a recitation phrase.
A parenthesised group stays whole.

### 3.2 Cost

```
cost = 1000 · violations + badness
badness = 100 · x³          x = how much of its limit the candidate uses (0…1)
```

- `violations`: orphans plus widows at this break, counted over all stanzas.
- A candidate with `x > 1` is not feasible and is dropped. `G` is always
  scored, and its `x` is the stretch it already has.
- A pull-back candidate also pays a fixed **10**. That makes the more compact
  result win a near tie. It covers the issue's `megszen-tel` example: fitting
  `tel` on the first line beats moving `megszen` down, unless that means
  condensing a lot more than it means stretching.
- **Row count guard.** Reject a pull-back candidate if a plain greedy fill of the
  rest of the section, starting from that candidate, needs more rows than the
  same fill starting from `G`. A lone syllable is better than an extra line
  (issue: *"we allow orphaned and widowed syllables instead of having too many
  lines"*). A push-forward candidate can't add rows, so it isn't checked.

The lowest cost wins. Every feasible legal candidate costs less than 1000, so a
lone syllable is kept only when no feasible alternative exists. Among feasible
alternatives, the one that bends the spacing least wins.

### 3.3 Condensing, in two stages

For a candidate row with items `R`, `avail` from `rowItemsAvailable()` and
`T = gapOutlierThreshold`:

**Stage 1: accept a less even row.** Find the largest `t ∈ [Tmin, T]` such that
`Σw + levelingNeed(R, t) ≤ avail`. `levelingNeed` is a step function of `t`: it
only changes where `t` passes one of the row's own target floors, and it never
decreases as `t` grows. So we only need to check `Tmin` and the floors in
`(Tmin, T]`, and the answer is exact. Condensing then costs

```
x = 0.5 · (T − t) / (T − Tmin)
```

The weight 0.5 keeps stage 1 cheaper than any use of stage 2. The row is drawn
as today: justified by water-fill, with nothing new in the renderer.

**Stage 2: shrink the white space between neumes.** Stage 2 applies when even
`Tmin` isn't enough. The leveling reserve is dropped, and the deficit
`D = max(0, Σw − avail)` is taken out of the leveled neume-to-neume gaps (the
ones where `isLevelingTargetGap` is true). Each gap can give up at most

```
cap = min(width − syllableNeed, (1 − wrapCondenseMin) · w0)
w0  = singleNoteAdvance − noteBoxWidth        (the natural white space)
```

where `syllableNeed` is what the lyrics really need (§5.2). So a gap already
set by a syllable gives up nothing, and a gap set by the neume keeps at least
`wrapCondenseMin` of its natural white space. The deficit is taken evenly from
every gap, each capped at its own `cap`. That's the same water-fill as
`justificationWaterLevel`, run on the caps. It is not feasible when
`Σ cap < D`. The cost is

```
x = 0.5 + 0.5 · δ / ((1 − wrapCondenseMin) · w0)
```

where `δ` is how much each gap gives up. Stage 2 always costs more than stage 1.

### 3.4 Stretching

A pulled-back row is justified by water-fill, as usual. With `E` the leftover
space and `k` the number of leveled gaps:

```
x = (E / k) / (wrapStretchMax · w0)
```

This is the extra white space each gap gets, compared with its natural white
space. With the default `wrapStretchMax = 1` a gap may at most double. A row
with few gaps quickly becomes infeasible. On a projector slide with three neumes
per row, that's what makes the algorithm give up and keep the lone syllable.

### 3.5 Worked cases from the issue

| greedy break | candidates | expected |
|---|---|---|
| `könyörülje \| tek` (widow) | push `tek` (1 syllable, condensed); pull to `könyö \| rüljetek` or ` \| könyörüljetek` | push, if condensing one syllable is feasible |
| `kö \| nyörüljetek` (orphan) | push to `könyö \| rüljetek`; pull to ` \| könyörüljetek` | whichever bends less; pull if pushing is infeasible |
| `megszen \| tel` (widow, 3 syllables) | push `tel`; pull to ` \| megszentel` | push when feasible (compact) |
| `meg \| szentel` (orphan) | push `szentel` (2 syllables); pull `meg` | usually pull: pushing two syllables is rarely feasible |
| any, on a narrow slide | all infeasible, or all add a row | `G`: the lone syllable stays |

## 4. Options

Registered in `options.js` (so they also work as `%option:` header lines) and
documented in `docs/api.md`.

| option | type | default | meaning |
|---|---|---|---|
| `avoidLoneSyllables` | boolean | **true** | Turn §3 on. `false` gives exactly today's breaks. |
| `gapOutlierThresholdMin` | SS | **1.0** | Lowest `gapOutlierThreshold` stage 1 may use for a row. Clamped to `≤ gapOutlierThreshold`. |
| `wrapCondenseMin` | fraction | **0.75** | Share of the natural white space between neumes that stage 2 must keep. `1` turns stage 2 off. |
| `wrapStretchMax` | fraction | **1.0** | Most extra white space a pulled-back row may add per gap, as a multiple of the natural white space. |

The defaults are starting values. Set them from the test cases in §6 before
release, and record the final values and the reasons for them in this section.

## 5. Implementation

Steps 1–2 change no behaviour, and the existing tests must stay green after
them.

### 5.1 Make the row fill restartable (`layout.js`)

Split the body of `layoutRows` into a `fillRow(state, bound)` routine:

- `state` is everything the loop carries across a row start: the item index, a
  pending ligature tail, the running and row-start clef and key signature,
  `isFirstRow`, and `clefRowsDrawn`.
- `bound` is either nothing (greedy), `{ stopBefore: j }` (pull back) or
  `{ through: j }` (push forward: items up to `j` count as fitting, and §3.3
  decides afterwards whether that's affordable).

The row is filled once greedily. On a violation each candidate is filled again
from the same snapshot. Every candidate therefore goes through the same fill
code with its special cases (glued accidentals, atomic parentheses, carrying a
barline, recitation wrapping, splitting at `/`). The alternative, patching the
greedy row the way the barline-carry branch does today, would need all of those
special cases written a second time.

This also gives the row count guard its greedy fill for free: call `fillRow` to
the end of the section with the option off.

`layoutRowsWithCourtesyAccidentals` doesn't change. The decisions are
deterministic, so the fixed-point loop still converges (or hits its cap of 8
passes, as now).

### 5.2 Record words and syllable needs (`renderer.js`, `lyrics.js`)

- `expandSyllablesForLigatures` marks its placeholder slots `continuation: true`.
  Today they can only be recognised by their empty text.
- In the loop that reserves room for syllables (the `ligInfo` pass), attach to
  each ligature `it.lyricWord = [ { word, pos, len } | null ]`, one entry per
  stanza. `pos` is the number of the syllable sung on this neume.
  Recitation pieces get `null`, since they have their own rule.
- In the same loop, store `it.syllableNeed = currRight + nextLeftIntrusion + gap`,
  the value that `syllableExtra` is currently derived from. Stage 2 needs it.

### 5.3 Scoring and condensing primitives (`measure.js`)

These go next to `levelingNeed`, so the line breaker and the renderer read the
same code:

- `breakViolations(left, right)`: the orphans and widows of a break between two
  ligatures. For each stanza, if both have the same `word`, `b = left.pos` and
  `n − b = len − left.pos`. This works whether `right` is the next syllable or a
  continuation of the same one.
- `levelingNeed(ctx, rowItems, threshold = ctx.gapOutlierThreshold)`: the
  threshold becomes a parameter.
- `condenseGaps(ctx, rowItems, deficit)`: returns the per-gap reduction, or
  `null` when not feasible. Used for scoring and for drawing.

### 5.4 The search (`layout.js`)

`chooseBreak(state, greedyRow)` builds the candidates (§3.1), scores them (§3.2)
and returns the chosen row. A stage 2 row carries `condense: deficit`.

### 5.5 Drawing a stage 2 row (`renderer.js`)

When `row.condense > 0`, the row is justified with `extra = 0`, and its
`gapExtras` are the negatives of `condenseGaps(…)`. The `Math.max(0, …)` clamp
moves into the positive branch. Syllables are unaffected, because `cap` never
goes below `syllableNeed`.

### 5.6 Docs and release

`docs/api.md` (options), `docs/syntax-reference.md` (one paragraph near
`(z)`/`(Z)`: manual breaks are exempt), a *Lone Syllables* section in
`dev/test-cases.md`, `CHANGELOG.md`, and the core `0.25.0` version bump.

## 6. Tests

Each layout test renders its fixture twice, with `avoidLoneSyllables: false`
and `true`. The `false` render asserts the lone syllable really occurs at that
width. Without that check, a later metric change could silently turn the test
into a no-op. A helper reads each row's syllables back from `splitRowSVGs`.

**Scoring (unit tests, `measure.js`)**

1. `breakViolations` for words of 1–6 syllables at every position. Only
   `2 ≤ b ≤ n−2` is clean.
2. A break in the middle of a melisma counts with the head's syllable. A
   split inside the last syllable is clean.
3. With two stanzas, where one breaks legally and the other doesn't, the
   violations add up.
4. Non-lyric slots (`*`, `+`) and recitation pieces aren't words.
5. `levelingNeed` never decreases in `threshold`.
6. `condenseGaps` never takes a gap below `syllableNeed`, never takes more than
   the cap, and returns `null` when the caps can't cover the deficit.

**Layout**

7. Widow `könyörülje | tek`: pushing forward keeps `-tek` on the first row,
   with the same row count.
8. Orphan `kö | nyörüljetek`: the result is `könyö | rüljetek` or the whole word
   moves. There is no lone `kö`.
9. `megszen | tel`: `megszentel` stays whole on the first row.
10. `meg | szentel`, where pushing is infeasible: the whole word moves down and
    the row it left is justified.
11. Stage 1 only: a fixture where the row fits after lowering the threshold.
    Assert that no gap is narrower than its natural advance.
12. Stage 2: a fixture that needs compression. Assert that every compressed gap
    keeps at least `wrapCondenseMin · w0` and that no syllables overlap.
13. The stretch limit: a pull-back that would more than double the gaps is
    rejected, and the lone syllable stays.
14. The row count guard: a section whose last row is full keeps the lone
    syllable instead of adding a row.
15. `(z)` just after a lone syllable: the break is untouched.
16. A score with no violations renders byte-identical with the option on and
    off.
17. `%option: avoidLoneSyllables=false` in the header works like the API option.

**Situations that can't be fixed (projection)**

18. A large `lyricSize` on a narrow `width` (about 2–3 syllables per row): no
    crash and no endless loop. Every syllable is drawn once, and the row count
    is the same as with the option off.
19. A word wider than a whole row: it overflows as today, and candidates never
    produce an empty row.
20. A single-neume row that can't be condensed or stretched: the greedy result
    is kept.

**Existing behaviour that must hold**

21. The current recitation orphan/widow tests, the `/` melisma wrapping tests
    and the leveling tests pass unchanged.
22. Courtesy accidentals are still correct after a push forward or pull back (an
    accidental repeated at the new row start).
23. `test/fixtures/psalm-verse.svg`: check whether it changes. If it does,
    review the new breaks by eye before regenerating it.

## 7. What this changes in existing scores

With the default `true`, some breaks move. The only rows that change are the
ones that ended or started with a lone syllable, plus the rows after them. A
score without lone syllables, or where every fix is infeasible, renders exactly
as before (test 16). The option can be turned off for anyone who needs the old
breaks exactly.

## 8. Not done

- **The recitation rule stays separate.** It works on words with no cost model.
  Merging it with §3 is a natural follow-up, but it would change recitation
  layouts, which have their own tests and users.
- **The threshold is fixed at one syllable.** "Two syllables left alone" is
  not configurable. Add it only if someone asks.
- **No global optimisation.** The search is local to each break, and the row
  count guard uses a plain greedy fill. A whole-section Knuth–Plass pass could
  do better on hard pages, but it wouldn't be line by line, and a local search
  catches the common cases.
- **Language rules.** Words come only from the author's hyphens. There is no
  hyphenation dictionary and no special handling for single-letter syllables
  (`a-men`).
