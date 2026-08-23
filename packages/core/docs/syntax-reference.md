# Aretino — Syntax Reference

A complete, terse description of the **Aretino** chant source format: every
token the parser recognizes and what it renders to.

This is a *reference*, not a tutorial. For a step-by-step introduction with
musical background, see the User Guide (published separately at
[aretino-chant.github.io](https://aretino-chant.github.io)). For the JavaScript
API that parses and renders this format, see the [API Reference](./api.md).

The grammar here mirrors `parseAretino` ([src/parser.js](../../src/parser.js))
and the directive handling in `renderAretino`
([src/renderer.js](../../src/renderer.js)). Where the two disagree, the source
wins — please file an issue.

---

## Contents

1. [Document structure](#1-document-structure)
2. [Header](#2-header)
3. [Line types](#3-line-types)
4. [Pitch](#4-pitch)
5. [Noteheads](#5-noteheads)
6. [Modifiers](#6-modifiers)
7. [Ligatures (neumes)](#7-ligatures-neumes)
8. [Parenthesized notes](#8-parenthesized-notes)
9. [Braces and spanning marks](#9-braces-and-spanning-marks)
10. [Bar lines](#10-bar-lines)
11. [Clefs](#11-clefs)
12. [Accidentals](#12-accidentals)
13. [Layout: breaks, expander, spacers](#13-layout-breaks-expander-spacers)
14. [Lyrics](#14-lyrics)
15. [Text blocks](#15-text-blocks)
16. [Text formatting](#16-text-formatting)
17. [Labels](#17-labels)
18. [Embedding in Markdown](#18-embedding-in-markdown)

---

## 1. Document structure

A source file is plain UTF-8 text. Line endings are normalized (`\r\n` → `\n`).
A document is an optional **header** followed by a **body**:

```
%key: value          ← header lines (optional)
%key: value
%%                    ← optional end-of-header marker
(g2) g a b ||         ← body: music, lyrics, verse, and blank lines
w: text
```

The header ends at the first `%%` line, or — if there is no `%%` — at the first
line that is neither a `%key: value` line nor blank. If no `%key:` lines and no
`%%` are found, the whole file is body (parsing starts at line 0).

The parser is **forgiving**: any character it doesn't recognize inside a music
line is skipped silently, so a half-typed source still renders.

---

## 2. Header

Each header line is `%` `key` `:` `value`. Keys are trimmed; values are trimmed.

```aretino
%title: Opening Prayer
%caption: Vespers
%option: lyricDistance=0.5
%option: hideRepeatClef=true
%indent: VII.
%%
(g2) a a a g a C b g a. ||
w: O Lord, hear my hum-ble call to you!
```

| Key | Alias | Renders as |
|---|---|---|
| `title` | Bold centered heading above the score |
| `caption` | Italic heading, right-aligned |
| `indent` | Mode/incipit label drawn in the first-line indent |
| `transpose` | — | Transpose the rendered score by a signed number of semitones |
| `option` | — | Renderer option, one per line; repeatable |

`option` headers set renderer options from the source. Write one option per
header line, using either `name=value` or `name: value`:

```aretino
%option: lyricDistance=0.5
%option: lyricSize=12
%option: hideRepeatClef=true
%%
(g2) a a a g a C b g a. ||
w:   O Lord, hear my hum-ble call to you!
```

Numbers are parsed as JavaScript numbers; booleans accept `true`/`false`,
`1`/`0`, `yes`/`no`, and `on`/`off`. Recognised option names are the same names
accepted by `renderAretino(source, options)`. If the same renderer option is set
more than once in headers, the later header wins; explicit API options passed to
`renderAretino` override source headers.

`transpose` shifts the **rendered** music by a signed whole number of semitones
(`%transpose: 1` up a semitone, `%transpose: -2` down a whole tone) — the source
text is left unchanged. Notes move to the matching staff positions, the key
signature is transposed (and one is added when the source had none), and inline
accidentals are added where the new key needs them — once per bar — while
accidentals the new key now covers are dropped. The target key is the
enharmonically simplest one (fewest sharps/flats; ties prefer flats). A
transposition that pushes a note past the `A`–`G` letter range renders it with
ledger lines using the [octave-shift markers](#octave-shift-markers-notes-above-g--below-a)
(`^`/`v`) rather than clamping it to the staff edge.

```aretino
%transpose: 2
%%
(g2) c d e f g          % rendered a whole tone higher, in D major
w:   trans-posed up
```

Unknown keys are stored in the AST `header` object but not drawn. The `%%`
marker is optional but recommended once a header is present, to separate it
unambiguously from the body.

Currently supported options: dpi, staffSpaceMm, lyricSize, textFont, noteSpacing, gapOutlierThreshold, lyricDistance, lyricMinStaffDistance, hideRepeatClef, canvasHeight, staffGap, virgaStemLength, virgaStemDescentBelowPrev, virgaMaxBelowBottom, textStyle, textMaxIndent, textMarkerAlign

---

## 3. Line types

Each body line is classified by its prefix:

| Prefix | Type | Meaning |
|---|---|---|
| `w:` | lyrics | Syllable text aligned under the **preceding** music line |
| `W:` | verse | Free-flowing psalm/verse text (not note-aligned) |
| `W(style):` | verse | The same, set in a named [text block style](#15-text-blocks) |
| `n:` | music continuation | More music for the same note-aligned lyric stream |
| *(blank)* | blank | Vertical spacing |
| *(anything else)* | music | A sequence of music tokens |

The space after `w:` / `W:` / `n:` is optional and stripped (`w: text` and
`w:text` are equivalent).

**Continuation lines.** An unprefixed line has special meaning depending on what
came before it:

- After a `w:` line, it continues that lyric line (joined with a space).
- After a `W:` line, it belongs to the same text block — an explicit line
  break in `psalm` and `stanza`, reflowed away in `prose` and `rubric`.
- Otherwise it is parsed as a new music line.
- `n:` explicitly switches back to music after `w:` lines. Following `w:` lines
  then continue the previous note-aligned lyric lines, in order, instead of
  starting new verses.

```aretino
(g2) c d e f
w: first phrase
n: g h i j
w: second phrase
```

This is equivalent to writing:

```aretino
(g2) c d e f g h i j
w: first phrase second phrase
```

```aretino
W: Dicsőség az Atyának és Fiúnak * 
és Szentlélek Istennek.
```

---

## 4. Pitch

A pitch is one of 14 diatonic positions, low to high. Notes in the **normal
octave** (`c d e f g a b`) use lowercase; notes **outside** it use uppercase.
The letter names the staff position; the active [clef](#11-clefs) maps it to a
sound.

```aretino
(g2) A B c d e f g a b C D E F G
w:   A B c d e f g a b C D E F G
```

| Suffix | Name | Effect |
|---|---|---|
| `'` | virga | Apostrophe after a note draws it as a virga |

### Octave-shift markers (notes above G / below A)

The 14 letters run out at `A` (lowest) and `G` (highest). For the rare extreme
notes beyond either end, **prefix** the pitch letter with an octave-shift
marker: `^` raises the note one octave (7 staff positions), `v` lowers it one.
Markers stack, so `^^c` is two octaves above middle `c`. Ledger lines are drawn
automatically.

The scale simply continues past each end, so the natural minimal spelling is:

| Region | Spelling | Notes |
|---|---|---|
| above `G` | `^a ^b ^C ^D ^E ^F ^G` | the step above `G` is `^a`, then `^b`, then the high letters one octave up |
| below `A` | `vg vf ve vd vc vB vA` | the step below `A` is `vg` (an octave below middle `g`), then `vf`, … |

```aretino
(g2) g a b C D E F G ^a ^b ^C
w:   up and over the top
```

```aretino
(g2) A vg vf ve vd
w:   down below the bottom
```

A marker only counts when it directly precedes a pitch letter (it may be glued
inside a ligature, e.g. `g^a^bg`); a stray `^` or `v` with no note after it is
ignored.

```aretino
(g2) e f g a b
w:   e f g a b
```

A bare `'` that does **not** follow a pitch is a [breath mark](#10-bar-lines),
not a virga.

---

## 5. Noteheads

The notehead *shape* is set by trailing shape suffixes:

| Form | Shape | Example |
|---|---|---|
| pitch letter | punctum | `d` |
| letter + `'` | virga | `d'` |
| letter + `w` | quilisma | `dw` |
| letter + `t` | tenor note | `dt` |

```aretino
(g2) d d' dw dt ds
w:   punctum virga quilisma tenor small
```

The `s` suffix marks a **small** (cue-sized) note. It is technically a modifier
(see below) rather than a shape, so it combines with any shape.

---

## 6. Modifiers

Modifiers are suffix characters attached to a note. A note can carry several;
they accumulate in order.

| Suffix | Modifier | Sign |
|---|---|---|
| `.` | mora | Dot (lengthening) |
| `_` | episema | Horizontal episema |
| `-` | ictus | Vertical ictus stroke |
| `~` | plica | small plica added |
| `s` | small | Cue-sized note |

```aretino
(g2) d d. d_ d- d~
w:   plain mora episema ictus plica
```

Combine freely; suffixes may repeat and interleave with the octave mark `'`:

```aretino
(g2) d_e_d_ d._ d-~
```

---

## 7. Ligatures (neumes)

Adjacent pitch letters with no whitespace between them form **one ligature**
(neume) — the notes are beamed/grouped and laid out together. Whitespace ends
the ligature.

```aretino
(g2) ga ag
w:   podatus clivis
```

```aretino
(g2) gag aga
w:   torculus porrectus
```

Longer runs work too; the renderer adds a virga on melodic peaks automatically:

```aretino
(g2) dfd bagfgagaCbCbga
```

### Neume-separator gap (`/`)

A `/` inside a run of notes is a **visual cut**: the groups on either side stay
in the same ligature token but are drawn with a small separating gap.
Whitespace around the `/` is ignored.

```aretino
(g2) fefdc.efdc./feg.gggee/cededdc. c
```

In the AST, a ligature's `groups` array holds one entry per `/`-separated group;
`gaps` records each cut.

---

## 8. Parenthesized notes

Wrapping one or more notes in `[` … `]` renders typographical parentheses around
them. The brackets may span a single note, a ligature, or several
whitespace-separated notes or neumes.

```aretino
(g2) g [a] b
w:   plain opt plain
```

```aretino
(g2) ga [ag] gag [aga] g
w:   pod  cliv torc porr end
```

```aretino
(g2) g [a b C] g [b a] g.
w:   a  b c d e  f g h.
```

The `[` and `]` are separate tokens in the AST (`paren-open` / `paren-close`);
everything between them is rendered normally and the parenthesis glyphs scale
vertically to fit.

---

## 9. Braces and spanning marks

A `{` … `}` pair draws a visual mark over the notes it spans. The opening token
selects the shape:

| Opening token | Shape | Drawn |
|---|---|---|
| `{` | Overbrace (curly brace pointing down) | above the notes |
| `\arc{` | Arc (smooth curve) | above the notes |
| `\line{` | Straight line | above the notes |
| `\slur{` | Slur, dashed | below the notes |
| `\slurSolid{` | Slur, solid | below the notes |

The closing `}` may be followed by a label in double quotes:

| Syntax | Label |
|---|---|
| `}` | No label |
| `}"Text"` | Label in double quotes |

The quotes are required — an unquoted `}Word` is not a label. The `}` closes the
span without one, and the letters that follow are read as ordinary notation, so
`}melisma` silently adds an `e` and an `a` notehead to the line.

Labels are drawn for `{`, `\arc{` and `\line{`. A label on a slur close parses
but is not rendered.

Spans can cross system breaks; the renderer continues the mark on the next row
automatically.

```aretino
(g2) { g a b C } { a b C D }"melisma"
```

```aretino
(g2) \arc{ g a b } \line{ C D E F }
```

```aretino
(g2) { g a b C }"1." g { a b C D }"2." g
```

```aretino
(g2) \slur{f A} \slurSolid{A g}
```

In the AST, the opening token is `{ type: 'brace-open', kind: 'brace' | 'arc' | 'line' | 'slur' | 'slurSolid' }` and the closing token is `{ type: 'brace-close', label? }`.


---

## 10. Bar lines

Bar lines and dividers are written as the literal symbols below, or by wrapping
the same symbol in parentheses (`(|)`, `(||)`, …) — useful to keep them from
attaching to a neighbouring spacer or expander.

```aretino
(g2) g a , g a ; g a | g a || g a ||| g a :| g a |:
```

| Symbol | Kind |
|---|---|
| `,` | quarter bar (minor division) |
| `;` | half bar |
| `\|` | full bar |
| `\|0` | empty bar (invisible, same width as full bar) |
| `\|\|` | double bar |
| `\|\|\|` | triple bar |
| `\|:` | repeat start |
| `:\|` | repeat end |
| `:\|:` | repeat both |
| `'` | breath mark |

```aretino
(g2) g a ' g a
```

---

## 11. Clefs

A clef is a directive `(` `letter` `line` `)` — the clef letter (`g`, `f`,
or `c`, case-insensitive) plus the staff line it sits on.

```aretino
(g2) d f g a  (c3) e g a  (f4) b a g
```

| Directive | Clef |
|---|---|
| `(g2)` | G (treble) clef on line 2 |
| `(c3)` | C clef on line 3 |
| `(f4)` | F clef on line 4 |

A clef can appear anywhere in a music line; the last clef before a row is the
one redrawn at the start of wrapped rows.

---

## 12. Accidentals

An accidental is a single symbol, optionally prefixed by the target pitch
letter:

| Symbol | Meaning |
|---|---|
| `b` | flat |
| `n` | natural |
| `#` | sharp |

So `f#` is a sharp on `f`, `bb` a flat on `b`, `n` a natural (on the default
pitch). An accidental is always drawn exactly where it is written. Outside key
signatures, it remains in force for notes on the same staff position until the
next barline or another accidental on that same position.

If a measure wraps to a new system, the renderer repeats the active accidental
before the first neume on the new system that contains an affected note.
Accidentals come in three placements:

**Inline** — a directive `(…)` immediately before a note applies to that note:

```aretino
(g2) (f#) f f
```

**Key signature** — `(K: …)` sets a running signature for the rest of the line.
List one or more accidentals separated by spaces. An empty `(K:)` clears it.

```aretino
(g2) (K:f#) a a a f a b C ba a_
```

**Key signature shortcuts** — `(Kb)` one flat, `(Kbb)` two flats, `(K#)` one sharp, `(K##)` two sharps, `(K)` clear:

```aretino
(g2) (Kb) b C D b | (Kbb) b C D b | (K#) b C D b | (K##) b C D b | (K) b C D b
```


**Standalone directive** — an accidental directive on its own (not glued to a
note) draws the sign at that position.

When the pitch letter is omitted, the position defaults to the reciting
position `b` — so `(b)` is a flat on `b`. Name the pitch explicitly whenever you
mean another position.

---

## 13. Layout: breaks, expander, spacers

These tokens control horizontal spacing and line breaking; they produce no
sound.

| Token | Name | Effect |
|---|---|---|
| `(z)` | justified break | Force a line break **and** justify the row to the margin |
| `(Z)` | ragged break | Force a line break without justifying |
| `*` | expander | Absorbs slack — stretches to push surrounding content apart when the row is justified |
| `(sp)` `(spN)` | spacer | Fixed-width gap; `N` (may be fractional) scales the width |
| `=` `==` `===` | spacer | Fixed-width gap; width scales with the number of `=` |

```aretino
(g2) d f * g a * g f d  (||)
```

```aretino
(g2) d f (sp2) g = a ==== f
```

Explicit breaks let one logical line render as several rows with controlled
justification:

```aretino
(g2) a a a g a C b g a. (z) a a a a g e e d. (Z) g g g a g f e d.
w:   O Lord, hear my hum-ble call to you! O Lord, hear my hum-ble call to you! O Lord, hear my hum-ble call to you!
```

---

## 14. Lyrics

A `w:` line carries syllable text aligned under the music line above it. A `W:`
line carries free verse text.

```aretino
(g2) g a b g. ab a g e_d_ , g ab A'g g. ||
w: Al-le-lu-ia, al-le-lu-ia, al-le-lu-ia.
```

| Construct | Meaning |
|---|---|
| *(space)* | Word boundary — syllables of different words don't get a hyphen |
| `-` | Syllable boundary **within** a word — spaces after the hyphen are ignored, joined syllables butt together, and a hyphen appears only if the neumes leave room |
| `\-` | Literal hyphen inside one syllable — useful when multiple words are sung on the same note, e.g. `only-begotten` |
| `=` | Mandatory syllable boundary **within** a word — like `-`, but the hyphen is always shown and doesn't collapse when spacing is tight |
| `_` | Extender line — holds the syllable over its own neume; each additional `_` extends it over one more following neume |
| `\_` | Literal underscore inside one syllable |
| `~` | Renders as a literal (non-breaking) space — keeps a multi-word unit in one syllable, e.g. `(unbreakable~space)` |
| `~~` | Splits a syllable's display text from its alignment text; in a `W:` block, a [marker](#15-text-blocks) from its body |
| `*` | Flex / asterisk — a verse division mark, kept as a literal `*` |

Extender underscores follow the syllable they extend: `ro_` holds `ro` over its
own neume, `ro__` extends through the next neume, `ro___` through the next two,
and so on. Trailing punctuation after the underscores belongs to the far end of
the extender line:

```aretino
(g2) g g g g
w: ro___.
```

`W:` verse lines flow as ordinary text (psalm tone style) and accept the same
[text formatting](#16-text-formatting) as lyrics. See
[text blocks](#15-text-blocks) for their typography:

```aretino
(g2) g ab a g e_d_ , g ab A'g g. ||
w: Al-le-lu-ia, * al-le-lu-ia.
W: Dicsőség az Atyának és Fiúnak * és Szentlélek Istennek.
W: Miképpen kezdetben, most és mindenkor * és mindörökkön örökké. Ámen.
```

---

## 15. Text blocks

A `W:` line opens a **text block**: free-flowing text that is not aligned to
notes. Unprefixed lines after it belong to the same block, and consecutive
blocks stack until a blank line ends the section.

### Styles

A block is set in a named style, chosen parenthetically before the colon.
`W:` on its own means `psalm`, so existing scores are unaffected. An
unrecognised name falls back to the default rather than failing the parse.

| Style | Source line breaks | Break indent | Wrap indent | Notes |
|---|---|---|---|---|
| `psalm` | kept | 2 em | 2 em | the default — verse starts stay visible |
| `prose` | reflowed | 0 | 0 | a rubric or instruction set as running text |
| `stanza` | kept | 0 | 1.5 em | a hymn strophe; only an overflow line indents |
| `rubric` | reflowed | 0 | 0 | 85% size, red |

```aretino
W(prose): Az áldozás alatt a nép énekelhet, vagy a kántor
zsoltárt énekelhet — ez a sor folyószövegként tördelődik.

W(stanza): Ó jöjj, ó jöjj, Emmánuel,
csak téged áhít Izrael,

W: Dicsőség az Atyának és Fiúnak *
és Szentlélek Istennek.
```

In `prose` and `rubric` a source line break is an editing convenience: the
block reflows to the column width. In `psalm` and `stanza` it is kept as a
break.

Each style also carries its own line height and its own spacing between
blocks. Where two styles meet, the seam takes the larger of what the block
above claims below itself and what the block below claims above itself — so a
rubric opens air around itself without any other style having to know it
exists.

The document default is set with `%option: textStyle=prose` (or the
`textStyle` renderer option); a `W(style):` marker on a block always wins over
either.

### Markers

`~~` separates a **marker** — a verse number, a `℟`, a role label — from the
body of the block. The marker hangs at the left margin and the body starts at
a text column shared by every block of the same style in a row:

```aretino
W(stanza): 1.~~Ó jöjj, ó jöjj, Emmánuel,
W(stanza): 10.~~Ó jöjj, ó jöjj, Adonáj,
W: \R.~~Dicsőség az Atyának és Fiúnak
W(prose): Előénekes~és~nép:~~Az áldozás alatt a nép énekelhet…
```

Because the column is shared, `1.` and `10.` line up across a hymn's stanzas.
It is shared only within a run of blocks of one style, so a wide role label in
a neighbouring block cannot drag a hymn's numbers across the page. `~` binds a
multi-word marker into one unit — `1.~Elsö` is an ordinary non-breaking pair,
`1.~~Elsö` is a marker plus body.

A marker wider than `textMaxIndent` (8 em by default, and never more than 30%
of the available width) overhangs the column; if no word fits beside it, the
body starts at the column on the next line.

Markers hang flush left by default. `%option: textMarkerAlign=right` (or the
`textMarkerAlign` renderer option) sets them flush against the text column
instead, so a short `1.` ends where a long `Refrén.` ends:

```aretino
%option: textMarkerAlign=right
%%
W(stanza): 1.~~Első versszak | Második sor
W(stanza): Refrén.~~Második versszak
```

The widest marker of the run still starts at the left margin, and one that
overhangs a capped column starts there too. A host can set the alignment for
one style only, with `textStyles: { stanza: { markerAlign: 'right' } }`.

### Manual line break

`|` breaks a line inside a block, exactly as a source newline does — so in
`prose` and `rubric`, where source newlines reflow away, it is the break that
survives. Surrounding spaces are trimmed, and inline formatting may span it.
`\|` is a literal pipe.

```aretino
W(prose): <Az áldozás alatt | a nép énekelhet>
```

---

## 16. Text formatting

Lyric (`w:`) and verse (`W:`) text supports inline formatting. Styles nest.

| Syntax | Result |
|---|---|
| `{text}` | **bold** |
| `<text>` | *italic* |
| `[text]` | underline |
| `\red{text}` | red text |
| `\color:NAME{text}` | text in color `NAME` |
| `\R` | responsory sign ℟ |
| `\V` | versicle sign ℣ |
| `+` | dagger † |
| `++` | double dagger ‡ |
| `\X` | literal `X` — escape any special character (`\{`, `\<`, `\\`, …) |

```aretino
(g2) c d e f g | a
w: <italic> {bold} [underlined] {<[nested]>} \{escaped\} (\red{{bold red}}) \color:green{green}
```

```aretino
W: {Gloria} Patri, et \V Filio, * et Spiritui Sancto.
W: \R Sicut erat in principio, * et nunc et semper.
W: + dagger ++ double~dagger (unbreakable~space)
```

---

## 17. Labels

You can add labels above notes with the syntax `f"Label"`. Formatting tags are supported as well.

## 18. Embedding in Markdown

The dev test page (and any host that adopts the same convention) recognizes
fenced code blocks tagged `aretino` and turns each into a live editor with a
rendered preview. The fence info string after the language word carries
per-block layout options:

````markdown
```aretino
(g2) g h i ||
```

```aretino fixed width=18cm
(g2) h h h g h j i g h. ||
w:   O Lord, hear my hum-ble call to you!
```
````

| Option | Meaning |
|---|---|
| `fixed` | Non-responsive: lay out to a fixed physical width, line breaks stay put |
| `width=Ncm` / `width=Nmm` | Target physical width (used with `fixed`) |

These fence options are a host-integration concern (see
[dev/main.js](../../dev/main.js)); source-level renderer options should be
written with repeatable `%option:` headers.

---
