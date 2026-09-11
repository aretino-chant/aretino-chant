# Lyric clearance and hyphens

Porting two pieces of engraving from the `abc2svg-cantoreshu` fork
(`~/prog/abc2svg`, see its `FORK.md`) into `@aretino-chant/core`.

- **Target:** core `0.24.0`.
- **Scope:** `text.js`, `glyphs.js`, `measure.js`, `lyrics.js`, `renderer.js`,
  `options.js`. No other package changes.
- **Status:** implemented.

## 1. Where we were

### 1.1 The first lyric line was measured from the wrong two things

```js
// renderer.js
const lowestNoteY = rowLowestNoteY(ctx, row, staffBottomY);
const lyricTopY = Math.max(lowestNoteY + ctx.lyricDistance,
                           staffBottomY + ctx.lyricMinStaffDistance);
let lyricY = lyricTopY + ctx.lyricSize;
```

Three faults, in order of how much they cost:

**The ink was not the drawn ink.** `rowLowestNoteY` walked the notes and took
`pitchY + noteBoxHeight / 2` — the notehead and nothing else. A virga stem
descends to `virgaMaxBelowBottom`, 1.75 SS below the bottom line, and the floor
that was supposed to catch it, `lyricMinStaffDistance`, is 0.75 SS. So a low
virga's stem ran a full staff space into the lyrics. Morae and a below-set ictus
had the same hole. The geometry to get this right was already written and
already used by the drawing — `noteInkBounds` in `glyphs.js` — it simply was not
consulted.

**The clearance was row-wide.** One deep stem anywhere on the row pushed every
syllable of the row down, including syllables standing under notes sitting high
in the staff.

**The letters were assumed to fill the em.** `lyricTopY + ctx.lyricSize` hangs
the baseline a whole font size below the clearance line, as though every
syllable reached the top of its body. Almost none do: `mi` reaches about half
of it. So `lyricDistance` never meant what it said, and a row of short
lower-case chant syllables floated about a quarter of an em lower than asked.

### 1.2 Hyphens were the font's glyph

`emitAlignedSyllables` set a `<text>-</text>` at the midpoint of the gap, and
used `measureText('.')` as a stand-in for how much room a hyphen needs. The
glyph carries side bearings of its own and differs from face to face, so its
drawn length was whatever the face happened to give — and at a singable lyric
size, that is a mark no engraver asked for. There was no control over its
length, thickness or height, and a wide justified gap got one lonely hyphen
adrift in the middle of it.

What Aretino *did* already have, and what the fork also has, is the good part of
the collapse rule: a hyphen with no room goes, the syllables are pulled into one
word, and a Hungarian doubled digraph is repaired when they meet
(`asz-szony` → `asszony`, `hungarianDigraphTransformPair`). That is untouched.

## 2. What was done

### 2.1 Measurement primitives — `text.js`

- `measureTextAscent(text, size, family, bold, italic)` — baseline to the top of
  the letters actually present, from the browser's `actualBoundingBoxAscent`.
  Headless there is no face to measure, so the letters are classed the way
  `measureTextWidth` already estimates widths there: accented capital `0.95`,
  ascender/capital/digit `0.75`, x-height letter `0.52`, baseline punctuation
  nothing. NFD decomposition means one table answers for `á`, `ő` and `û` alike.
- `measureSegmentsAscent` — the tallest across a run, honouring each segment's
  own `$small`/`$large` size.
- `measureXHeight(size, family)` — what the hyphen's height is reckoned in.

Both are memoised per render in `renderer.js`, next to the existing
`measureText` cache, since the first stanza of every row is measured syllable
by syllable.

### 2.2 Real ink — `measure.js`, `glyphs.js`

`computeAutoVirga` moved from `ligature.js` to `glyphs.js` (the leaf module, so
no import cycle) and is now shared: the auto-virga stems the drawing adds are
ink the clearance has to see.

`ligatureLowestInkY` is new, and `rowLowestNoteY` is written in terms of it.
Both go through `noteInkBounds` — the same geometry the drawing uses — including
the group splits an internal mora forces, since those change which note a stem
measures its length from.

### 2.3 The baseline — `measure.js`

```js
firstLyricBaselineY(ctx, spans, inkSpans, staffBottomY, rowLowestY, fallbackAscent)
```

Each syllable is paired with the ink over *its own* horizontal span, cleared by
*its own* measured ascent, and the row takes the lowest baseline any pair needs:

```
baseline = max over syllables s of
             max(ink(span(s)) + lyricDistance, staffBottom + lyricMinStaffDistance)
             + ascent(s)
```

So a tall letter elsewhere adds no height under a stem it never meets, and a
deep stem pushes down only what actually stands over it. Every syllable of the
row still shares one baseline — they are one line of type.

`lyricDistance` and `lyricMinStaffDistance` keep their meaning exactly: the
distance from the ink to the top of the lyric letters. What changed is that both
ends of that measurement are now real.

### 2.4 Layout split — `lyrics.js`

The baseline can only be settled once the syllables' spans are known, and the
spans were computed inside the function that was already writing out SVG. So
`emitAlignedSyllables` is split:

- `layoutRowSyllables(ctx, syllables, ligatures)` → `{ ops, spans, maxX }`.
  All the horizontal work — centering, collision, hyphen decisions, the
  Hungarian transform, extender runs — with no vertical commitment. `ops` is an
  ordered list of `syllable` / `hyphen` / `extender` / `suffix` draw operations
  carrying x positions only.
- `emitLaidOutSyllables(ctx, layout, lyricY)` → the SVG at a settled baseline.
- `emitAlignedSyllables` remains, as the two called in sequence.

A pleasant side effect: the Hungarian transform used to re-render the previous
syllable's SVG string in place at a tracked `parts[]` index. It now just rewrites
the recorded op.

### 2.5 Hyphen strokes — `lyrics.js`

`hyphenGeometry(ctx)` and `hyphenRoom(ctx)` mirror the fork's `hyphen_geom()`
and `hyphen_room()`. The stroke's length gives way to the room there is, between
`lyricHyphenMinLen` and `lyricHyphenMaxLen`, so a stretched row draws a long
stroke and a tight one a short stroke without either moving a notehead. A gap
wider than `lyricHyphenRepeat` font sizes carries several strokes at full length
rather than one adrift in the white.

The spread is **not** the fork's, in two ways; both are fixes to carry back
upstream.

*The white is even.* abc2svg leaves half a stroke of air at each end and whatever
is left over between the strokes, so a run reads as a group shoved against the
syllables. Here, with `k` strokes of length `l` in a gap of width `w`, the air
before the first, between each pair and after the last is all
`(w - k*l) / (k + 1)` — which for a single stroke is simply centring it, so the
two cases are the one formula.

*The gap is between the syllables, not between the neumes.* A melisma written
`Al- - le` holds `Al` over two neumes, and `expandSyllablesForLigatures` puts an
empty slot on the second. That slot is not a syllable — it sets no letters — so
it must not break the hyphen run in two and have each half spread over its own
neume. `layoutRowSyllables` carries a `pendingHyphenLeft` across such slots and
closes the gap only at the next syllable that has letters, so the run spans the
whole distance from `Al` to `le` and is spread evenly across it. A slot of bare
punctuation does have ink and does close the run.

The same slot no longer contributes a span to the baseline solve: it draws
nothing, so it has no letters to clear.

`hyphenRoom` is what the note-spacing pass now reserves for a mandatory `=`
hyphen (it used to reserve `measureText('.')`), so the spacing and the lyric
layout reach the same verdict.

Strokes carry `class="aretino-lyric-hyphen"`; the extender line, which had no
class, now carries `aretino-lyric-extender`.

## 3. Options

`lyricLineSkip`, `lyricHyphenMinLen`, `lyricHyphenMaxLen`, `lyricHyphenWidth`,
`lyricHyphenSpace`, `lyricHyphenPos`, `lyricHyphenRepeat` — registered in
`options.js`, so they work both as API options and as `%option:` header lines,
and documented in `docs/api.md`.

Defaults are the fork's: `.17 / .33 / .04 / .05 / .55`, stanza advance `1.2`
(which was already hardcoded), repeat at `4`.

`lyricHyphenRemove` was **not** ported. The fork needs it because upstream
abc2svg buys hyphen room from the note spacing; Aretino already expresses the
same intent per-syllable with the `=` mandatory hyphen, which is finer grained
and already reserves its room.

## 4. The default clearance

Measuring both ends exposed that `lyricDistance` had never been carrying its
stated weight. At `0.2` SS it is 1.3px at the default staff size — nothing. It
only ever looked adequate because the baseline was hung a whole font size below
the clearance line, and the quarter-em of air between a letter's top and the top
of its em box was silently doing the work. Take that away, as measuring the real
ascent does, and `0.2` SS is a collision.

It was in fact already a collision before any of this. For
`(g2) (K:B) a_gb'ag/a_C CCCagaga a. ;` / `w: Haec di-es (\red{*})`, the old code
put the top of `Haec` at 1.25 SS below the bottom line and the virga stem it
stands under reached 1.30 SS — the letters overlapped the stem, and were only
saved elsewhere by the em-box slack. The old `rowLowestNoteY` could not see the
stem at all, so nothing pushed the line down.

Two changes:

- `noteInkBounds` adds half the stem's stroke width to a virga's reach. The stem
  is drawn `stroke-linecap="round"`, so its ink stands half a stroke past the
  endpoint the bounds reported, and that half stroke is precisely what a
  clearance measured against real ink runs into.
- `lyricDistance` defaults to `0.5` SS.

`0.5` is set against `lyricMinStaffDistance`, which is `0.75`: a row with a stem
hanging beneath the staff must not be given *less* air than a row with nothing
hanging at all. It also only bites where it should — when the notes sit in the
staff the `0.75` floor governs and `lyricDistance` is not consulted, so ordinary
rows keep the tighter setting and only rows with ink below the staff move.

Letter top below the bottom staff line, in staff spaces:

| | before | now |
|---|---|---|
| in-staff, lower-case | 1.67 | 1.00 |
| in-staff, accented capital | 0.80 | 1.00 |
| virga stem below the staff | 1.67 | **2.32** |
| `Haec dies` | 1.25 | **1.82** |

The first two rows are the tighter engraving result, and the tops now align
whatever the letters are, the baseline moving instead. The last two are the
collisions, fixed.

## 5. What this changes in existing scores

Deliberately, per the decision taken when this was started: lyrics follow the
letters that are there. A row of short lower-case syllables rises about a
quarter of an em closer to the music; a row carrying capitals or Hungarian
accents stays about where it was; a row with a low virga drops by up to a staff
space, which it should always have done.

`test/fixtures/psalm-verse.svg` was regenerated for this.

## 6. Not done

- The syllable spans the baseline is solved from come from the ligature
  positions, before the collision pass nudges a syllable sideways. The fork does
  the same (`s.x - ly.shift`), and being a few pixels out in x only means one
  extra ligature's ink is considered.
- Lyrics set *above* the staff have no equivalent path here; Aretino does not
  offer them.
