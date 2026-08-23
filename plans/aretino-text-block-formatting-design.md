# Text blocks beyond the psalm verse

Design for named text-block styles in `@aretino-chant/core`.

- **Target:** core `0.22.0`, plus a version bump in Cantores.
- **Scope:** `packages/core/src/verse.js` and its callers. Cantores only consumes.
- **Status:** design agreed. Not yet implemented.

## 1. Where we are

A text block starts at `W:`; every unprefixed line after it is an explicit
break (`parser.js:188`, `parser.js:246-249`). Consecutive blocks accumulate into
`sec.verses` until a blank line, which ends the whole section (`items.js:23`).

`renderVerseLines` then applies one hardcoded shape to all of it
(`verse.js:104-106`):

```js
const lineHeight = fontSize * 1.1;   // within a block
const verseGap   = fontSize * 1.3;   // between blocks
const indentX    = leftX + fontSize * 2;
```

Both explicit breaks and auto-wrapped lines land at `indentX`. That single rule
is right for psalm verses — verse starts stay visible because everything else
is indented — and wrong for everything else:

- **Prose** (a rubric, an instruction). Source line breaks are an editing
  convenience, not typography. They should reflow away; today they are frozen
  as indented breaks.
- **Stanza** (a hymn strophe). Verse lines should align under the stanza
  number, with only an overflow line indenting further. Today a source break
  and a wrapped line look identical.

There is no per-block, per-document or per-host control over any of it.

## 2. Defects — these come first

Four defects found reading `verse.js`. The first two are user-visible, and both
are **prerequisites for the features in §3**, not cleanup to do afterwards.

### 2.1 `~` is not unbreakable in `W:` text — *blocks markers*

`verse.js:36` replaces every `~` with a plain space *before* word splitting:

```js
const processed = lineText.replace(/~/g, ' ');
```

The splitter then breaks lines at it like any other space, so `~` is a
breakable space in verse text. `docs/syntax-reference.md:534` documents the
opposite, with a `W:` example.

**Fix.** Substitute U+00A0. The splitter already breaks only on ASCII spaces
(`verse.js:54`), so nothing else moves.

**Order matters.** `~~` must be recognised *before* `~` is substituted, the
same order `lyrics.js:230` uses. Multi-word markers (§3.2) depend on `~`
actually binding.

### 2.2 Inline glyphs vanish from `W:` text — *blocks manual breaks*

The stress mark `\'` and the accidentals `\b \n \#` parse into segments with
empty `text` and a `glyph` field (`text.js:197-201`). `wrapVerseText` iterates
`seg.text` only, `charsToSegments` (`verse.js:16`) drops the field, and
`renderSegments` ignores glyphs — so they disappear with no warning. The stress
mark is the one glyph psalm pointing actually needs.

**Fix.** Carry glyph segments through as unbreakable one-character words and
render each display line with `renderMixedLabel`, which already places glyph
paths beside text runs.

**Why it blocks `|`.** The manual break (§3.4) rides through the parser as a
segment with empty text and no glyph. The filter at `text.js:224` is
`s.text !== '' || s.glyph`, so today it would be dropped silently — the
identical bug. The fix must widen that filter, not special-case glyphs.

### 2.3 Verse lines carry no class and no source span

Lyrics go through `wrapSrc()` with classes and source offsets; verse lines are
bare `<text>` (`verse.js:128`). Consequences: the editor toolbar scans backwards
for a `W:` line instead of mapping the caret, and Cantores' incipit crop selects
*every* `<text>` element in the SVG.

### 2.4 Text-only scores produce no row markers

`splitRowSVGs` (`renderer.js:1224`) slices at `<!-- aretino-row -->` comments,
emitted per staff row only (`renderer.js:1187`). A score of pure `W:` blocks
yields none, so `renderFirstRow` returns `null` and Cantores renders the whole
SVG and crops by hand. The same gap means a long text block cannot be paginated
onto projector slides.

## 3. The design

One tag. Typography is a named style over a flat set of knobs. `psalm` stays
the default, so every existing score renders byte-identically.

### 3.1 Four styles

`℟` is **not** a style — it is a marker (§3.2), and the surrounding text is
whatever it actually is. A responsory is a psalm, a stanza or prose with a
marker on it.

| Style | Source breaks | Break indent | Wrap indent | Line height | Extras |
|---|---|---|---|---|---|
| `psalm` | honoured | 2 em | 2 em | 1.10 | today's behaviour, unchanged |
| `prose` | reflowed | 0 | 0 | 1.25 | optional justify |
| `stanza` | honoured | 0 | 1.5 em | 1.15 | — |
| `rubric` | reflowed | 0 | 0 | 1.10 | 0.85 × size, red |

`rubric` stays a style of its own rather than `prose` plus inline markup. It
differs in size (so it has its own leading and gap arithmetic) and colour, but
the real argument is semantic: a named style is a hook for suppressing rubrics
on projector output, setting them in another face, or excluding them from
incipit and search. `\red{...}` gives nothing to query.

### 3.2 Markers

A marker is separated from the body by `~~`:

```aretino
W(stanza): 1.~~Ó jöjj, ó jöjj, Emmánuel,
W(psalm):  ℟.~~Dicsőség az Atyának és Fiúnak
W(prose):  Előénekes~és~nép:~~Az áldozás alatt a nép énekelhet…
```

This is not a new meaning for `~~`. In lyrics it splits a syllable's display
prefix from its alignment text (`lyrics.js:221`), and the prefix hangs left of
the note centre (`renderer.js:550`). A `W:` marker is the same device without a
note to hang from.

`~` binds a multi-word marker into one unit; `~~` makes it hang. So `1.~Elsö`
is an ordinary non-breaking pair and `1.~~Elsö` is a marker plus body.

Consequences worth stating, because they remove machinery earlier drafts had:

- **No marker grammar.** No integer / `℟` / trailing-colon pattern to match, so
  no false positive on prose opening `1978. évben…`, and no escape hatch needed
  for it.
- **No `markerHang` knob and no per-style default.** A marker hangs when `~~` is
  present, in any style. Numbered psalm verses — rare, but real — need no
  option flipped.
- **No compatibility risk.** Nothing in the corpus uses `~~` in a `W:` line.

#### The text column

Define **run** = a maximal stretch of consecutive `W:` blocks of the same style
within a section. A run is bounded by the section and by a style change,
nothing else. Two different psalms belong in two sections.

A run has one text column, shared by every block in it:

```
markerColumn = leftMargin + min( widest marker in run + textMarkerGap, textMaxIndent )
```

With no markers in the run, `markerColumn = leftMargin` and everything below
reduces to today's arithmetic.

All indents are then measured **from `markerColumn`, not from `leftMargin`**:

- first line of a block starts at `markerColumn` (after its marker, if any)
- a source break lands at `markerColumn + breakIndent`
- a wrapped line lands at `markerColumn + wrapIndent`

One formula, and each style keeps its own character: a marked `stanza` puts
verse lines flush at the column with overflow indented 1.5 em, while a marked
`psalm` keeps its 2 em.

Run scope — rather than section scope — means `1.` and `10.` align across a
hymn's stanzas, while a wide role label in a neighbouring responsory does not
drag the hymn's numbers across the page.

#### When a marker exceeds the cap

The column clamps at `textMaxIndent`; the marker overhangs it. That block's
first line starts after the marker rather than at the column, and its wrapped
lines still return to the column. Printed books set wide role labels this way
already.

If the first word does not fit in what remains, the line breaks and the body
starts at the column on the next line. That is ordinary wrapping, not a new
threshold — but it does need a change: `verse.js:72-75` force-places a word on
an empty line regardless of width, so today an overrunning marker would push
text past the staff instead of breaking.

Default `textMaxIndent` is **8 em**, additionally capped at 30% of the available
width so a narrow projector column cannot produce a two-word gutter.

### 3.3 Gaps

A gap is a property of the **seam between two blocks**, not of a block, so one
number per style cannot express it: `psalm → psalm` and `psalm → prose` are
different seams.

Each style carries three numbers, and the seam resolves as:

| Seam | Value |
|---|---|
| within a run (same style, adjacent) | `style.gapWithin` |
| at a style change | `max(prev.gapAfter, next.gapBefore)` |

| Style | `gapWithin` | `gapBefore` | `gapAfter` |
|---|---|---|---|
| `psalm` | 1.30 | 1.30 | 1.30 |
| `prose` | 1.50 | 1.60 | 1.60 |
| `stanza` | 1.60 | 1.60 | 1.60 |
| `rubric` | 1.20 | 1.80 | 1.60 |

All multiples of `lyricSize`. `psalm.gapWithin` is today's `verseGap`, so
consecutive psalm verses are unchanged.

The max rule is CSS margin collapsing, chosen because it composes: `rubric`
claims air above itself without every other style having to know rubrics exist,
and a fifth style later needs no matrix rewrite. `psalm → psalm` collapses to
1.30 while `psalm → prose` opens to 1.60, which is the register change the seam
should show.

### 3.4 Manual break

`|` breaks a line inside a block, with surrounding whitespace trimmed.

This is the established line-break character for free text in this format —
`renderer.js:319, 359, 369, 385, 386` split `title`, `subtitle`, `rubric`,
`caption` and `indent` on it with exactly `.split('|').map(l => l.trim())`.
Reusing it in `W:` is consistent rather than novel, and it touches no escape
namespace (`\n` is the natural sign, `text.js:197`). `\|` already yields a
literal pipe through the default branch at `text.js:205`; no code needed.

**Semantics: `|` is a source newline spelled inline.** Identical behaviour, no
rules of its own. In `psalm` and `stanza` it indents to `breakIndent` exactly as
hitting enter does; in `prose` and `rubric`, where source newlines reflow away,
it is the only break that survives — which is what makes reflow safe to choose.

Automatic breaking at `*` and `†` is **rejected**. They are musical division
marks; whether one deserves a break depends on the pointing and the column
width, and breaking on them would make output width-dependent in a book that
gets proofread once.

**The split happens after parsing, never before.** Inline formatting can span a
break:

```aretino
W: <Az áldozás alatt | a nép énekelhet>
```

Pre-splitting the raw source puts `<` in one piece and `>` in the other, so the
second parses unbalanced and loses its italic. The break rides through as a
segment — `{ text: '', break: true }`, alongside the existing
`{ text: '', glyph: 'flat' }` — and `wrapVerseText` flushes the current display
line when it reaches one in the flat char stream it already builds
(`verse.js:40-45`). No pre-pass, and the `firstX` / `contX` logic needs no
special-casing because it is already driven by position in the stream.

### 3.5 Syntax and precedence

Style is selected parenthetically, matching the format's existing "directives
live in parentheses" idiom. Nothing valid today can contain `W(` before the
colon, so the change is additive.

```aretino
W(prose): Az áldozás alatt a nép énekelhet, vagy a kántor
zsoltárt énekelhet — ez a sor folyószövegként tördelődik.

W(stanza): 1.~~Ó jöjj, ó jöjj, Emmánuel,
csak téged áhít Izrael,

W: Dicsőség az Atyának és Fiúnak *
és Szentlélek Istennek.
```

The parser regex at `parser.js:188` becomes `/^\s*W(\([a-z]+\))?:/`, and an
unrecognised style name falls back to the default rather than failing the parse.

Precedence, most specific first:

**block marker → renderer option → `%option:` → `psalm`**

Two new entries in `HEADER_RENDERER_OPTION_TYPES` (`options.js:5`):

- `textStyle: 'string'` — the document default, e.g. `%option: textStyle=prose`
- `textMaxIndent: 'number'`

Per-style knobs are **not** added to that whitelist — twelve fields × four
styles is not a header vocabulary. Hosts that need to tune a preset pass a
`textStyles` object as a renderer option, merged over the built-in presets:

```js
renderAretino(src, { textStyle: 'prose', textStyles: { prose: { gapBefore: 2.0 } } })
```

Preset fields: `breaks`, `breakIndent`, `wrapIndent`, `lineHeight`,
`gapWithin`, `gapBefore`, `gapAfter`, `align`, `size`, `color`,
`markerGap`, `maxIndent`.

### 3.6 Justification

`align: 'justify'` stays opt-in, and never applies to a block's last line.

The PDF path is librsvg, which ignores `textLength` and is unreliable for
`word-spacing`. Justify by emitting one `<text>` per word at a computed `x` —
the converter already depends on per-node coordinates.

Keep it opt-in because wrap points are computed with the browser canvas but
shaped by Pango in the PDF. Baked-in wraps already give a slightly ragged right
edge; under justification that becomes visibly uneven word spacing.

## 4. Implementation sketch

**`text.js`**
- Widen the filter at `:224` to keep break segments: `s.text !== '' || s.glyph || s.break`.
- Emit `{ text: '', break: true }` for `|`; leave `\|` on the default branch.

**`verse.js`** — most of the change.
- Replace `~` handling at `:36` with `~~`-aware splitting, then U+00A0 for `~`.
- Extract the marker (text before `~~`) and measure it.
- Two passes over a run: measure markers → derive `markerColumn` → wrap and emit.
- Carry glyph and break segments through `charsToSegments` and the word splitter.
- Flush the display line on a break segment.
- Fix `:72-75` so an overrunning first word breaks instead of overflowing.
- Take presets and column from a resolved style object rather than the three
  constants at `:104-106`.
- Emit lines through `wrapSrc()` with classes and source offsets (defect 2.3).

**`parser.js`** — style capture at `:188`; verse item gains `style`, `srcStart`, `srcEnd`.

**`items.js`** — `pending.verses.push(item)` rather than `item.lines`, so style
survives grouping. Group into runs at render time, not here.

**`renderer.js`** — emit `<!-- aretino-row -->` markers for text-only scores
(defect 2.4); resolve the style chain and pass it to `renderVerseLines`.

**`options.js`** — `textStyle`, `textMaxIndent`.

## 5. Compatibility

Additive throughout. Only the two user-visible defect fixes change existing
output, and both change it toward what the documentation already promises.

| Change | Effect on existing scores |
|---|---|
| `psalm` default preset | none — identical output to 0.21.1 |
| `W(style):` syntax, `textStyle` options | none — unset falls back to the preset |
| `~~` markers | none — unused in `W:` today |
| `\|` manual break | none — unused in `W:` today |
| AST verse item gains `style`, `srcStart`, `srcEnd` | none — `sec.verses` shape change stays internal; dual-shape for one minor |
| Defect 2.1 — `~` | changes output where `~` appears in `W:`, to the documented behaviour |
| Defect 2.2 — glyphs | changes output where `\'` `\b` `\n` `\#` appear in `W:` — they currently vanish |
| Defects 2.3 / 2.4 | none — Cantores' fallback branch becomes dead code, not wrong code |

## 6. Testing

`packages/core/test/` has exactly one assertion touching `W:` today
(`renderer.test.js:753`). Needed coverage:

- style parsing, unknown-style fallback, and the full precedence chain
- indent positions per preset, break vs wrap distinguished
- reflow (`prose`, `rubric`) vs honoured breaks (`psalm`, `stanza`)
- line height and the three-number gap resolution, including `psalm → psalm`
  against `psalm → prose`
- marker column shared across a run; `1.` and `10.` aligned
- marker column *not* shared across a style change
- marker over `textMaxIndent`: overhang, then the break when no word fits
- `~` binding a multi-word marker (depends on 2.1)
- `|` break, including one spanning inline formatting (depends on 2.2)
- `\|` as a literal pipe
- both defect fixes directly
- a regression fixture asserting byte-identical output for an existing score

## 7. Cantores follow-up

Separate repository; referenced by name.

1. Add `aretinoTextStyle` to `aretinoFields` and a select in the Aretino
   settings panel — the document default, persisted per score like the other
   Aretino settings.
2. Let the editor toolbar cycle the `W(style):` marker on the current block. It
   already resolves the caret's block type as `verse`.
3. Once 2.4 lands, delete `cropAretinoVerseToFirstLines` — `renderFirstRow`
   will work for text-only scores.

## 8. Decisions

Questions raised during review, and how they were resolved.

| Question | Resolution |
|---|---|
| Should `prose` reflow source breaks, or honour them un-indented? | **Reflow.** Honouring them makes `prose` into `stanza` with no indent and forbids hard-wrapping the source. `\|` covers the deliberate break. |
| How are stanzas separated, given a blank line ends the section? | **They aren't, separately.** Consecutive same-style blocks form a run with `gapWithin`. No new separator. |
| Is `rubric` its own style, or `prose` plus markup? | **Its own style** — size, colour, and a semantic hook for suppression and extraction. |
| Should `psalm` auto-break at `*` and `†`? | **No**, not even as a preferred break point. Musical marks, not typographic ones; auto-breaking makes output width-dependent. |
| Two different psalms in a row? | **Two sections.** A blank line is the right author signal; no intra-section separator. |
| Does `resp` earn its own style? | **No.** `℟` is a marker; the style is whatever the text is. |
| How is a marker recognised? | **`~~`, explicitly.** No pattern grammar — see §3.2. |
| What spells the manual break? | **`\|`**, matching the five header fields that already split on it. |
| What if a role marker is very wide? | **Clamp the column at `textMaxIndent`** and let the marker overhang. |
