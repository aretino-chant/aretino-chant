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
15. [Text formatting](#15-text-formatting)
16. [Labels](#16-labels)
17. [Embedding in Markdown](#17-embedding-in-markdown)

---

## 1. Document structure

A source file is plain UTF-8 text. Line endings are normalized (`\r\n` → `\n`).
A document is an optional **header** followed by a **body**:

```
%key: value          ← header lines (optional)
%key: value
%%                    ← optional end-of-header marker
(g2) g h i ||         ← body: music, lyrics, verse, and blank lines
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
(g2) h h h g h j i g h. ||
w: O Lord, hear my hum-ble call to you!
```

| Key | Alias | Renders as |
|---|---|---|
| `title` | Bold centered heading above the score |
| `caption` | Italic heading, right-aligned |
| `indent` | Mode/incipit label drawn in the first-line indent |
| `option` | — | Renderer option, one per line; repeatable |

`option` headers set renderer options from the source. Write one option per
header line, using either `name=value` or `name: value`:

```aretino
%option: lyricDistance=0.5
%option: lyricSize=12
%option: hideRepeatClef=true
%%
(g2) h h h g h j i g h. ||
w:   O Lord, hear my hum-ble call to you!
```

Numbers are parsed as JavaScript numbers; booleans accept `true`/`false`,
`1`/`0`, `yes`/`no`, and `on`/`off`. Recognised option names are the same names
accepted by `renderAretino(source, options)`. If the same renderer option is set
more than once in headers, the later header wins; explicit API options passed to
`renderAretino` override source headers.

Unknown keys are stored in the AST `header` object but not drawn. The `%%`
marker is optional but recommended once a header is present, to separate it
unambiguously from the body.

Currently supported options: dpi, staffSpaceMm, lyricSize, lyricFont, noteSpacing, lyricDistance, hideRepeatClef, canvasHeight, staffGap

---

## 3. Line types

Each body line is classified by its prefix:

| Prefix | Type | Meaning |
|---|---|---|
| `w:` | lyrics | Syllable text aligned under the **preceding** music line |
| `W:` | verse | Free-flowing psalm/verse text (not note-aligned) |
| `n:` | music continuation | More music for the same note-aligned lyric stream |
| *(blank)* | blank | Vertical spacing |
| *(anything else)* | music | A sequence of music tokens |

The space after `w:` / `W:` / `n:` is optional and stripped (`w: text` and
`w:text` are equivalent).

**Continuation lines.** An unprefixed line has special meaning depending on what
came before it:

- After a `w:` line, it continues that lyric line (joined with a space).
- After a `W:` line, it becomes an explicit line break within the verse
  (rendered indented).
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

A pitch is a single letter `a`–`n` (14 diatonic positions, low to high). The
letter names the staff position; the active [clef](#11-clefs) maps it to a sound.

```aretino
(g2) a b c d e f g h i j k l m n
w:   a b c d e f g h i j k l m n
```

| Suffix | Name | Effect |
|---|---|---|
| *(lowercase)* | punctum | Round notehead (default) |
| *(uppercase)* | raised octave | Shift an octave up |
| `'` | virga | Apostrophe after a note draws it as a virga |

```aretino
(g2) g h i j h' i' j'
w:   g h i j h' i' j'
```

A bare `'` that does **not** follow a pitch is a [breath mark](#10-bar-lines),
not an octave mark.

---

## 5. Noteheads

The notehead *shape* is set by the letter case and by trailing shape suffixes:

| Form | Shape | Example |
|---|---|---|
| lowercase letter | punctum | `d` |
| uppercase letter | punctum (octave up) | `D` |
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
| `~` | liquescens | Liquescent reduction |
| `s` | small | Cue-sized note |

```aretino
(g2) d d. d_ d- d~
w:   plain mora episema ictus liquescens
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
(g2) gh hg
w:   podatus clivis
```

```aretino
(g2) ghg hgh
w:   torculus porrectus
```

Longer runs work too; the renderer adds a virga on melodic peaks automatically:

```aretino
(g2) dfd ihgfghghjijigh
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
(g2) g [h] i
w:   plain opt plain
```

```aretino
(g2) gh [hg] ghg [hgh] g
w:   pod  cliv torc porr end
```

```aretino
(g2) g [h i j] g [i h] g.
w:   a  b c d e  f g h.
```

The `[` and `]` are separate tokens in the AST (`paren-open` / `paren-close`);
everything between them is rendered normally and the parenthesis glyphs scale
vertically to fit.

---

## 9. Braces and spanning marks

A `{` … `}` pair draws a visual mark **above** the notes it spans. Three shapes
are available:

| Opening token | Shape |
|---|---|
| `{` | Overbrace (curly brace pointing down) |
| `\arc{` | Arc (smooth curve) |
| `\line{` | Straight line |

The closing `}` may be followed by a quoted or unquoted label:

| Syntax | Label |
|---|---|
| `}` | No label |
| `}"Text"` | Label in double quotes |
| `}Word` | Label up to the next space |

Spans can cross system breaks; the renderer continues the mark on the next row
automatically.

```aretino
(g2) { g h i j } { h i j k }"melisma"
```

```aretino
(g2) \arc{ g h i } \line{ j k l m }
```

```aretino
(g2) { g h i j }"1." g { h i j k }"2." g
```

In the AST, the opening token is `{ type: 'brace-open', kind: 'brace' | 'arc' | 'line' }` and the closing token is `{ type: 'brace-close', label? }`.

---

## 10. Bar lines

Bar lines and dividers are written as the literal symbols below, or by wrapping
the same symbol in parentheses (`(|)`, `(||)`, …) — useful to keep them from
attaching to a neighbouring spacer or expander.

```aretino
(g2) g h , g h ; g h | g h || g h ||| g h :| g h |:
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
(g2) g h ' g h
```

---

## 11. Clefs

A clef is a directive `(` `letter` `line` `)` — the clef letter (`g`, `f`,
or `c`, case-insensitive) plus the staff line it sits on.

```aretino
(g2) d f g h  (c3) e g h  (f4) i h g
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

So `f#` is a sharp on `f`, `ib` a flat on `i`, `n` a natural (on the default
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
(g2) (K:f#) h h h f h i j ih h_
```

**Standalone directive** — an accidental directive on its own (not glued to a
note) draws the sign at that position.

When the pitch letter is omitted, the position defaults to the reciting
position `i` — so `(b)` is a flat on `i`. Name the pitch explicitly whenever you
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
(g2) d f * g h * g f d  (||)
```

```aretino
(g2) d f (sp2) g = h ==== f
```

Explicit breaks let one logical line render as several rows with controlled
justification:

```aretino
(g2) h h h g h j i g h. (z) h h h h g e e d. (Z) g g g h g f e d.
w:   O Lord, hear my hum-ble call to you! O Lord, hear my hum-ble call to you! O Lord, hear my hum-ble call to you!
```

---

## 14. Lyrics

A `w:` line carries syllable text aligned under the music line above it. A `W:`
line carries free verse text.

```aretino
(g2) g h i g. hi h g e_d_ , g hi a'g g. ||
w: Al-le-lu-ia, al-le-lu-ia, al-le-lu-ia.
```

| Construct | Meaning |
|---|---|
| *(space)* | Word boundary — syllables of different words don't get a hyphen |
| `-` | Syllable boundary **within** a word — spaces after the hyphen are ignored, joined syllables butt together, and a hyphen appears only if the neumes leave room |
| `~` | Renders as a literal (non-breaking) space — keeps a multi-word unit in one syllable, e.g. `(unbreakable~space)` |
| `~~` | Splits a syllable's display text from its alignment text |
| `*` | Flex / asterisk — a verse division mark, kept as a literal `*` |

`W:` verse lines flow as ordinary text (psalm tone style) and accept the same
[text formatting](#15-text-formatting) as lyrics:

```aretino
(g2) g hi h g e_d_ , g hi a'g g. ||
w: Al-le-lu-ia, * al-le-lu-ia.
W: Dicsőség az Atyának és Fiúnak * és Szentlélek Istennek.
W: Miképpen kezdetben, most és mindenkor * és mindörökkön örökké. Ámen.
```

---

## 15. Text formatting

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
(g2) c d e f g | h
w: <italic> {bold} [underlined] {<[nested]>} \{escaped\} (\red{{bold red}}) \color:green{green}
```

```aretino
W: {Gloria} Patri, et \V Filio, * et Spiritui Sancto.
W: \R Sicut erat in principio, * et nunc et semper.
W: + dagger ++ double~dagger (unbreakable~space)
```

---

## 16. Labels

You can add labels above notes with the syntax `f"Label"`. Formatting tags are supported as well.

## 17. Embedding in Markdown

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
