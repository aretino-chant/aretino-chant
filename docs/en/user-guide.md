# Aretino — User Guide

> Hungarian Catholic Gregorian notation in text format.
> Version: 1.0 · Last updated: 2026-05-18

```aretino
(g2) g h i g. hi h g e_d_ , g hi a'g g. ||
w: Al-le-lu-ia, al-le-lu-ia, al-le-lu-ia.
```

This guide introduces the **Aretino** notation format step by step, with examples.
The format/layout algorithm may still change; we welcome your feedback!

You can try and practice the format on this page. The full-featured editor with all settings is available on our [Score Editor](/score/preview) page.

The Aretino notation format is freely usable; please link to our website in public materials: [Cantores.hu](https://cantores.hu)

---

## Table of Contents

1. [What is Aretino?](#1-what-is-aretino)
2. [Theoretical Background — the "Modernized Metz-Gothic" Transcription](#2-theoretical-background--the-modernized-metz-gothic-transcription)
3. [The Guido Font as Intellectual Predecessor](#3-the-guido-font-as-intellectual-predecessor)
4. [Why Does Aretino Go Further?](#4-why-does-aretino-go-further)
5. [Your First Score](#5-your-first-score)
6. [Header](#6-header)
7. [Clefs](#7-clefs)
8. [Pitch](#8-pitch)
9. [Notehead Types](#9-notehead-types)
10. [Modifier Suffixes (mora, episema, ictus, liquescent)](#10-modifier-suffixes)
11. [Ligatures — Neumes](#11-ligatures--neumes)
12. [Neume-Separator Gap (`/`)](#12-neume-separator-gap)
13. [Bar Lines and Dividers](#13-bar-lines-and-dividers)
14. [Line-End Justification, Manual Spacing, and Line Breaks](#14-line-end-justification-manual-spacing-and-line-breaks)
15. [Accidentals (flat, sharp, natural)](#15-accidentals)
16. [Text and Stanzas](#16-text-and-stanzas)
17. [Longer Examples](#17-longer-examples)
18. [Using the Editor](#18-using-the-editor)
19. [Common Mistakes and Tips](#19-common-mistakes-and-tips)

---

## 1. What is Aretino?

**Aretino** is a text-based format for notating Hungarian Catholic Gregorian practice — following the conventions of László Dobszay and Janka Szendrei:

- **five-line** staff,
- **treble clef** by default,
- traditional **round** noteheads (not square),
- but **Gregorian rhythm** and notation system: mora, episema, liquescence, quilisma, ligatures.

The name alludes to Guido d'Arezzo (in Latin *Guido Aretinus*) — the spiritual successor of the old *Guido HU/EN* TTF font, but an independent, semantic format.

### Design Philosophy in Brief

| Principle | What it means in practice |
|---|---|
| **Position = pitch** | The letter code determines which line or space the note occupies. |
| **Semantic markers** | Episema, mora, etc. are suffix characters, not magic glyph files. |
| **Separate line for text** | The `w:`-prefixed line is independently meaningful. |

---

## 2. Theoretical Background — the "Modernized Metz-Gothic" Transcription

Aretino did not emerge from nothing: it is the heir to nearly four decades of Hungarian Gregorian transcription scholarship. The professional foundation was laid by László Dobszay's essay [On the Transcription of Gregorian Chant](https://egyhazzene.hu/wp-content/uploads/2018/12/gregorian_atiras.pdf) (in Hungarian) and the paleographic work of Janka Szendrei. Below we briefly summarize the principles from which Aretino's current form follows.

### The Core Problem of Transcription

In Dobszay's sharp formulation, the real difficulty of Gregorian transcription is **not** the number of staff lines or the choice of clef — these have changed through the centuries and can be changed today without touching the essence. The genuine question is one of **perspective**:

> "Most early neume notations did not aim to indicate a sequence of pitches…
> but rather what kind of melodic figure the syllables of the text should be sung on.
> The notation is the indication of this melodic figure, and as a unified sign expresses a figure of 3–4 notes."

In other words: a Gregorian melody is sung well by someone who **conceives and renders the melodic figure for a single syllable as a unit** — not building up the melisma note by note. A good modern transcription, therefore, is one that suggests this "neumatic" way of hearing to the reader.

### Two Classic Dead Ends

1. **Reproduction of square notation** — historically faithful, but demands careful reading from today's singer; the four lines and the C-/F-clef are the lesser problem, but the vertically written pes, the curved porrectus line, and the diamond-shaped noteheads mislead the modern reader.
2. **"Modern" transcription with eighth and quarter note values** — makes it obvious that this is a transcription, but the metric rhythmic values **attach false rhythmic conceptions** to the melody.

By the end of the 20th century, both solutions were superseded by a third — the method of **modern stemless round noteheads + slurs**. Dobszay also sharply criticizes this: such a notation presents the melody as a long sequence of individual notes, and plants the same mental image in the singer. Two reasons led to its spread: (1) the scribe does not strongly perceive hearing by melodic figures; (2) computer music notation trivially produces this primitive notation image.

### The Direction of the Solution — Metz-Gothic Notation

There is a medieval notational system that, in agreement with the "modern" perspective, interprets the two axes (horizontal = time, vertical = pitch), **while** preserving the visual cohesion of note groups: **Metz-Gothic notation**. The Budapest Gregorian researchers (above all Janka Szendrei) took this as a basis and, combined with modern round noteheads, developed the system known today as the "Budapest transcription" or "modernized Metz-Gothic."

### The Ten Points of the Modernized Metz-Gothic (Dobszay)

Chapter IV of the essay summarizes the principles in ten points. Aretino essentially encodes this system in text format:

1. **Horizontal = time, vertical = pitch.** (In agreement with the modern perspective.)
2. **Any notehead type** may be used; naturally, modern **round** ones are fine.
3. **Notes belonging to the same neume** are written as **close together** as legibility allows.
4. **The unity of the neume is expressed by a stem descending on the left side of the relatively highest note.** Such a stem is placed on:
   - the 2nd note of the pes, the 1st note of the clivis, the middle note of the torculus, the 1st and 3rd notes of the porrectus, the 3rd note of the scandicus, the 1st note of the climacus — **always the locally highest note**.
   - If the direction changes within the neume, the stem is repeated for each new peak.
5. **Descending groups of notes** (clivis, etc.) are connected by a **thin vertical or slightly oblique connecting line**. Optional for a second, **required for larger intervals**.
6. **Internal grouping of longer melismas** in two ways:
   - either with additional stems (indicating different articulations),
   - or by inserting a **one-notehead-width empty gap** between the small groups.
7. **Note repetitions** may be freely used; if the repeated note starts a descending motion, a stem may be added to the second note.
8. **Comma (plica)** in two ways: a small internal separator, or attached to a note to separate it within the group.
9. **Liquescence** may be indicated with a reduced-size note — or, if such a sign is unavailable, with a note marked with a plica.
10. **The number of staff lines and the choice of clef are independent** of the essence of the system.

Points 4–5 are the heart of the system: the **stem descending from the peak** and the **curved/oblique line connecting descending notes**. This is what makes Gregorian notation both **modernly readable** and **neumatic**.

---

## 3. The Guido Font as Intellectual Predecessor

The first practically usable computer implementation of the modernized Metz-Gothic transcription was the work of **János Bali**: the **Guido** TTF font (the old *Guido HU/EN* font). The name pays homage to Guido d'Arezzo (*Guido Aretinus*) — the medieval father of the pitch system and four-line notation; Aretino inherits its name from this tradition.

### How Did the Guido Work?

The Guido was **not a program but a font** — the user set the font to Guido in a plain word processor (Word, OpenOffice, etc.) and typed the score character by character. The main principles:

- **It did not work on pre-drawn staff lines**: the noteheads brought their corresponding staff-line segments with them.
- **Number keys = punctum** (from one-line C up to two-line A); even number = note on a line, odd = note in a space.
- **Shift** on the same key = **plica** (small comma sign).
- **Letter below the number row** = **virga** (note with stem).
- **Descending second/third/fourth** = combinations of separate key rows.
- The **text was written in a separate line**, and the user **aligned it with spaces** under the notes — the syllable was not attached to the note.

A typical source line in Guido looked like this:

```
<-4--4t---tT4--t4--tg3--tG2--5zZ5--4uU6---7uU6Z5T4
```
![Guido example](/guido-pelda.png)

Every note at every position in every variant required a different keystroke:
`4 t` = pes, `t T 4` = second clivis with connecting line, `5 z Z 5` =
torculus, `4 u U 6` = another torculus, etc. Moreover, certain markings could not be achieved at all (simply not enough characters).

The same thing in Aretino — simply specify the note names and everything is automatic:

```aretino
(g2) g gh hg H/g hf he hih gji jjihg
```

### What Did the Guido Bring?

Revolutionarily much:

- it **ran on anyone's computer**, installation practically zero,
- one could typeset a score within moments,
- it **preserved the principles of Metz-Gothic notation** — stems, curved connecting lines, plica were all accessible,
- and it was inexpensive: no specialist, no typographic engraving needed.

---

## 4. Why Does Aretino Go Further?

The Guido is **character-level, manual typography** — the user "draws" with the keyboard: places every sign manually, adjusts every spacing with spaces, and must know and position which stem belongs to which note. This is **the limitation of the font-based technique**, not a flaw — but the consequence is:

- the notation image is **static**: if syllables are rearranged or the score is resized, the alignment collapses;
- **there is no automation**: stems, connecting lines, neume spacing must all be set by hand;
- **there is no semantic connection between text and notes**: the syllables of "Ky-ri-e" only visually stand below the notes;
- **no line break, no justification**: every line is manually cut;
- **the source is not interpretable**: the character sequence `<-4--4t---tT4` is only a drawing of Guido font positions, not a semantic notation — very cumbersome to edit.

**Aretino** implements the same notational tradition — the modernized Metz-Gothic transcription — as a **semantic, text-based format**. What this entails:

| Aspect | Guido (TTF font) | Aretino (semantic format) |
|---|---|---|
| **Representation** | every variant of a notehead is a separate character | noteheads always mean the same thing; there are modifier characters |
| **Virga, stemming** | placed by the user, always manually | **automatic**: the renderer places a stem on every local maximum, but can also be set manually |
| **Descending connecting line** | separate key combination | **automatic**: the renderer draws it for every descent, adjusted by interval |
| **Neume spacing** | manual — with spaces and hyphens | **automatic**: the renderer positions the neumes |
| **Line-end justification** | none | **automatic** and manual line justification (`(z)` directives) |
| **Syllable–note alignment** | user aligns with spaces | **automatic**: syllable goes under the corresponding neume |
| **Multiple stanzas** | each stanza is a separate line, aligned manually | `w:` lines, each aligned automatically |
| **Scaling** | font point size changes it | arbitrary, with automatic re-layout, enabling different display sizes |
| **Layout/re-typesetting** | none — the line only fits as many characters as typed | **automatic line breaking** at the margin, with clef repetition |
| **Source portability** | TTF-font-dependent, meaningless without the font | plain UTF-8 text, readable and editable without the font |
| **Extensibility** | practically impossible | unlimited |

### Summary of the Concept

Guido specifies how the Gregorian score should look. Aretino tries to describe what the score means musically: where the syllables, neumes, accents, melodic connections, and notational phenomena are. This is the difference between copying a score image and recording a true musical source. One gives a pretty picture; from the other, the machine also understands what is happening in the melody — and produces a prettier picture.

Moreover, the aesthetic appearance of the score and adherence to stemming rules depend on the editor in Guido's case; Aretino makes it possible to produce an aesthetically pleasing, rule-conforming notation automatically, simply by specifying the notes.

### What Does Aretino Preserve from the Tradition?

Everything that is essential to the Dobszay–Szendrei school:

- **round noteheads**, five-line system, modern clefs (point 10);
- **virga stem** (point 4) — automatically, on every local maximum;
- **descending connecting line** (point 5) — automatically, adjusted by interval;
- **neume grouping with a notehead-width gap** (point 6) — the `/` operator;
- **mora, episema, liquescence, quilisma** (points 8–9) — as suffix characters;
- **independence of the staff-line and clef question** (point 10) — the clef can be changed without affecting the `a–m` notation.

Aretino therefore does **not break** with the tradition — on the contrary: it **automates the essence**, so the user only needs to focus on the musical content.

---

## 5. Your First Score

```aretino
(g2) d f g h.
```

This draws a treble clef (G on the 2nd line) and then four punctums — the last with a mora (duration dot).

A minimal example with text and header:

```aretino
;title: First Attempt
%%
(g2) d f g h.
w:   This is a test.
```

The three main building blocks:

1. **Header** — optional; `;key: value` lines, closed by `%%`.
2. **Melody line** — notes, ligatures, bar lines. The first parenthesized element is the clef (`(g2)`, `(f4)`, `(c3)`).
3. **Text line** — prefixed with `w:`, directly beneath the melody.

---

## 6. Header

Header lines begin with a semicolon (`;key: value`), and `%%` closes the header:

| Key | Description |
|---|---|
| `title` | Title, centered, bold. |
| `caption` | Caption, right-aligned, italic. |
| `indent` | Indentation at the beginning of the first line. If a value is given (e.g. `I.d`), it appears in lowercase. |


```aretino
;title: Opening Prayer
;caption: Vespers
;indent: VII.
%%
(g2) h h h g h j i g h. ||
w: O Lord, hear my hum-ble call to you!
```

The header is **optional** — you can start immediately with the melody line.

---

## 7. Clefs

The clef is specified in parentheses: letter + line number.

| Source | Clef | Note |
|---|---|---|
| `(g2)` | G-clef on line 2 | Treble clef |
| `(f4)` | F-clef on line 4 | Bass clef |
| `(c3)` | C-clef on line 3 | Small square C-sign (not a traditional alto clef). |

The clef is usually the first element of the melody line. You can also change the clef mid-line:

```aretino
(g2) d f g h  (c3) e g h (f4) i h g
```

After a line break, the renderer automatically draws the current clef.

---

## 8. Pitch

Notes are represented by the lowercase letters **a–m**. The letter always indicates the same line or space, **regardless of the clef**:

```aretino
a b c d e f g h i j k l m
w: a b c d e f g h i j k l m
```

So in treble clef, `c` is C on line 1, `g` is B on line 3, etc.
In bass clef, the same `c` on line 1 becomes E (because the clef changes, but the line position does not).

### Raised Octave — Apostrophe

```aretino
a' b' c' d' e' f' g' h'
w: a' b' c' d' e' f' g' h'
```

---

## 9. Notehead Types

A **suffix character** immediately after the letter modifies the base form of the notehead:

| Source | Name | Appearance |
|---|---|---|
| `d` | **punctum** | filled round notehead, no stem |
| `D` | **virga** | punctum with a downward stem on the left (capital letter!) |
| `dw` | **quilisma** | striped, zigzag-contour notehead |
| `dt` | **tenor note** | open notehead with vertical bars on both sides |
| `ds` | **small note** | reduced-size notehead |

### Examples

```aretino
(g2) d D dw dt ds
```

Left to right: punctum, virga, quilisma, tenor note — all at the same pitch (D).

The **virga** often appears automatically on ligature peaks (see the [Ligatures](#11-ligatures--neumes) section), but can also be used manually to indicate the internal grouping of longer melismas.

The **quilisma** always occurs within a ligature:

```aretino
(g2) dfwg
```

Here `w` after `f` indicates that the `f` is a quilisma.

---

## 10. Modifier Suffixes

Combinable suffixes after the notehead, **without a space**:

| Suffix | Name | Meaning |
|---|---|---|
| `.` | **mora** | to the right of the notehead; indicates a long note |
| `_` | **episema** | short horizontal line above the notehead. Consecutive episemata are merged by the system. |
| `-` | **ictus** | small vertical line above the notehead (in the space) |
| `~` | **liquescent** | small "tail" at the upper right of the notehead |

```aretino
(g2) d d. d_ d- d~ d_e_d_
```

---

## 11. Ligatures — Neumes

Notes written **consecutively without a space** form a ligature (neume). This is one of the most fundamental mechanisms in Aretino.

| Source | Name | Meaning |
|---|---|---|
| `df` | **podatus** | ascending two-note figure, with an arc from lower to upper |
| `fd` | **clivis** | descending two-note figure, with a calligraphic curved line |
| `dfd` | **torculus** | three-note: up-down |
| `fdf` | (valley three-note) | down-up — rendered as a unique ligature |
| `dfgf` | longer neume | arbitrarily long ligature |

### Single Note vs. Ligature

```aretino
df fd dfd fdf dfgf
```

- `d f g` → three **separate** punctums (separated by spaces).
- `df g` → one **podatus** (`df` together), then a separate `g`.
- `dfg` → one **three-note ligature** (torculus-like, ascending twice).

```aretino
d f g | df g | dfg
```


### Automatic Virga on Peaks

The renderer automatically places a virga stem on every ligature peak (local maximum) — this need not be marked manually. For example, with `dfd` (torculus), the `f` (peak) is automatically drawn with a virga stem.

```aretino
dfd ihgfghghjijigh
```

## 12. Neume-Separator Gap

The `/` (slash) inserts a **small breathing gap** within a ligature — making the internal grouping of the melisma visible. The notes before and after `/` still **belong to one ligature**; they are merely visually separated.

```aretino
(g2) fefdc.efdc./feg.gggee/cededdc. c

```

You **cannot** put spaces around `/` within a ligature — that would break the ligature into separate neumes.

---

## 13. Bar Lines and Dividers

| Source | Name | Function |
|---|---|---|
| `,` | short bar line (quarter bar) | small caesura, breath |
| `;` | half bar line | end of a phrase section |
| `\|` | full bar line | end of a sentence |
| `\|\|` | double bar line | end of a section |
| `:\| \|: :\|:` | repeat sign | repetition |
| `\|\|\|` | final bar line | classical ending |
| `'` | small breath mark | breath |

```aretino
' , ; | || :| |||
```

Bar lines can also be written in parentheses: `(,)`, `(;)`, `(|)`, `(||)`, `(:|)`, `(|||)` — the effect is the same, but the parenthesized form may be familiar to users of traditional GABC.

If something appears in parentheses in the text, it is aligned under the next bar line; in the example below, `(*)` indicates that an asterisk should be written under the short bar line.

```aretino
(g2) (K:fb#) h h h f h i j ih h_ , h h h f g hg e d. d. ; f f f g e g f_ , e d e e e g f d. d. || (Z) ht i ht g ht ||
w: Men-je-tek, és vi-gyé-tek hí-rül: (*) föl-tá-madt az Úr, al-le-lu-ja! Néz-zé-tek ü-res sír-ját, a-hol nyu-go-dott, al-le-lu-ja!
```

---

## 14. Line-End Justification, Manual Spacing, and Line Breaks

The Aretino renderer tries to distribute neumes/syllables favorably, but sometimes manual intervention is needed.

### Asterisk `*` — Distribution for Justified Lines

The `*` is an empty "flexible" spacer that lets you influence where a justified line has more breathing room:

```aretino
(g2) d f * g h * g (z) f d  (||)
```

Multiple `*` can be used in one line; the remaining space is evenly distributed among them.

### Spacer `(sp)` and `=` — Fixed-Size Gap

If you want a **fixed**-width gap (not flexible like `*`), use the `(sp)` directive. A multiplier can also be given: `(sp2)` = 2× base width, `(sp0.5)` = half width; `=` is equivalent to `(sp)`.

```aretino
(g2) d f (sp2) g = h ==== f
```

### Explicit Line Break `(z)` and `(Z)`

The renderer breaks lines automatically: if a line doesn't fit, it moves the next note to a new line. Explicit line breaks can also be requested:

| Source | Effect |
|---|---|
| `(z)` | line break suggestion, **justified** — the line fills to the margin |
| `(Z)` | line break suggestion, **not** justified — the line is left-aligned |

Use the `(z)` form where the end of a phrase naturally calls for a line break.

```aretino
(g2) g h i j (z) g h i j (Z) g h i j ||
```


---

## 15. Accidentals

| Source | Name | Meaning |
|---|---|---|
| `(bx)` | flat | a single flat at the height of the `i` note (line 3, B note) |
| `(by)` | natural | cancels the preceding alteration |
| `(b#)` | sharp | raised by a semitone |

The letter before `b` gives the pitch height: `(ebx)` = flat on E, `(fbx)` = flat on F, etc. If just `(bx)`, it appears on the B note (line 3, `i` height).

### Example

```aretino
(g2) (ibx) (sp) (iby) (sp) (ib#) (sp) : h (ibx) hih fgh. g(ibx)hih
```

Accidentals are kept together with the following neume. (Accidentals may also be used within a neume.)

### Key Signature — `(K:...)`

The key signature is placed after the clef. The renderer automatically displays it after the clef at the beginning of each new line, even if the clef is only written once at the start of the piece.

| Source | Meaning |
|---|---|
| `(K:bx)` | flat key signature on line 3 (B note, `i` height) |
| `(K:ebx)` | flat on the E note |
| `(K:bx ebx)` | multiple accidentals — separated by spaces |
| `(K:)` | cancel key signature |

```aretino
;title: Example with Key Signature
%%
(g2) (K:mb# jb# ) d e f g h i j k (||)
```

The `(K:bx)` is repeated at the beginning of each new line. A subsequent `(K:…)` token changes the key signature from that point (it appears in place, and the new sign also appears at the beginning of subsequent lines). `(K:)` cancels the key signature.

---

## 16. Text and Stanzas

### Syllable Alignment

The renderer **automatically aligns** syllables to notes: each syllable is placed under the center of the corresponding neume (or standalone punctum). Hyphenated syllabification (`Ky-ri-e`) marks syllable boundaries; the hyphens between notes appear automatically where there is room.

The rule is simple: **one syllable — one neume or one standalone note**.
A ligature (e.g. `df`) counts as a single unit, so one syllable is assigned to it; a standalone punctum (e.g. `d` with spaces on both sides) also counts as one unit, and one syllable is assigned to it.

```aretino
(g2) dghfe ed , g hg ghj h hghgfg(ibx)ihig fhgfgfe e:
w: Hús-vét ün-ne-pe e-lőtt tör-tént:
```

The layout algorithm tries to place the text economically and aesthetically. This means that where possible, it tries to merge syllables. Individual syllables are centered under a punctum, and left-aligned under neumes, tenor notes, and mora-marked punctums.

### Multiple Stanzas

Multiple `w:` lines can be written under the melody line — each new line is a stanza:

```aretino
(g2) d c d f g f e d. ,
w: Vic-ti-mae pas-cha-li lau-des
w: Praise to the Pas-chal Vic-tim now.
```

### Multiple Words on One Note (`~`)

If multiple words (syllables) need to be written **on a single note** — for example, under a reciting tenor note —, connect them with `~` without spaces:

```aretino
(g2) f g ht h g h :
w: God is Lord, King~of~all, praise him!
```

The `~` sign can also be used to skip notes, leaving text out:

```aretino
f g ; h g
w: ~ ~ text
```

### Stanza Numbering

To avoid disrupting text layout with stanza numbers, R., V., or other markings, use `~~` to connect them. For the first stanza, manual spacing may be needed.

```aretino
(g2) = g g g h g gj j ' jt
w: 1.~~Ki-rá-lyok-nak Ki-rá-lya (†) és~Atyja...
```

### Special Characters

Some characters are rendered specially:

| Syntax | Result | Description |
|--------|--------|-------------|
| `+`    | †      | Dagger (obelus) |
| `++`   | ‡      | Double dagger |
| `\R`   | ℟      | Responsory sign |
| `\V`   | ℣      | Versicle sign |

```aretino
c d e f g h
w: \V + \R ++
```

### Text Formatting

Formatting delimiters can be nested freely:

| Syntax | Effect |
|--------|--------|
| `{text}` | **bold** |
| `<text>` | *italic* |
| `[text]` | underline |
| `\red{text}` | red text |
| `\color:green{text}` | colored text (any CSS color name or `#rrggbb`) |

Use `\` to escape a literal `{`, `<`, `[`, or `\`.

```aretino
(g2) g h i g. hi h g e_d_ , g hi a'g g. ||
w: {\R.:}~~Al-le-lu-ia, <al-le-lu-ia>, al-le-lu-ia.
```

Nesting example — bold italic:

```aretino
(g2) g h i h g ||
w: {<bold and italic>still bold}
```

---

## 17. Longer Examples

### Simple Kyrie

```aretino
;title: Lord, have mercy (XVI.)
%%
(g2) (K:ibx) h h h g h fg h ||
w: Lord, have mer-cy up-on us! (<3x>)

h h h g h fg h ||
w: Christ, have mer-cy up-on us! (<3x>)

h h h g h fg h ||
w: Lord, have mer-cy up-on us! (<2x>)

h g i g f gh h ||
w: Lord, have mer-cy up-on us!
```

**What can be observed here?**

- The clef only needs to be given in the first line — the renderer places it automatically at the beginning of new systems.
- Blank lines **start a new section**.
- Text is aligned under the bar line.

### Antiphon with Psalm Tone

```aretino
;title: Asperges me
%%
(g2) (K:mb#) d e g f gh h , i j i h i h ge d | d e gfgh h , i g ge ggfg h g e d d ||
w: As-per-ges me Do-mi-ne hys-so-po et mun-da-bor la-va-bis me et su-per ni-vem de-al-ba-bor.

f g ht gs ht g h i- gs g | ht i h gs- gf e ||
w: ~ ~ ~ † (*)
```
---

## 18. Using the Editor

The Aretino format is available in the [score editor](/score/preview) — select the **Aretino** option in the format chooser. A live preview appears below the source.

### Elements of the Settings Bar

| Control | What it adjusts |
|---|---|
| **Zoom** | The preview zoom level (display only). |
| **Score size** | The physical size of the staff system in points (default 100). |
| **Text size** | The font size of the liturgical text. |
| **Text font** | Pre-provided, freely usable font families. |
| **Page ratio** | The aspect ratio of the exported page (`auto` = data-size based). |
| **Line spacing** | Adjusts the vertical spacing between staff systems (0 = default). |

### Page Break

If the page ratio is set to `16:9`, `4:3`, or `1:1`, you can start a new page (slide) in the source with the `%pagebreak` instruction. The break point is only active for the corresponding ratio:

| Instruction | When does it break? |
|---|---|
| `%pagebreak` | at every fixed ratio |
| `%pagebreak169` | only at 16:9 ratio |
| `%pagebreak43` | only at 4:3 ratio |
| `%pagebreak11` | only at 1:1 ratio |

In `auto` mode, all `%pagebreak` lines are ignored — the score appears as a single unit.

### Export

The score can be exported in SVG and PNG format and also copied as an image. This makes it possible to produce professional print output in word processors and desktop publishing software.

---

## 19. Common Mistakes and Tips

### "The ligature doesn't join up"

**Symptom:** an unintentionally long gap appears between two notes.  
**Cause:** there is a space between the notes.  
**Solution:** write them together — instead of `d f` (two punctums), write `df` (podatus).

### "Too many virga stems appeared"

**Symptom:** unwanted stems appear on ligature peaks.  
**Cause:** this is normal behavior — auto-virga places a stem on every peak.  
**Solution:** if you intentionally don't want a virga peak, rewrite the ligature as separate punctums (with spaces) where you don't want the automatic stem.

### "The text doesn't align with the notes"

**Symptom:** syllables are not under the correct unit.  
**Cause:** the syllabification is probably off — either hyphens are missing (`Kyrie` instead of `Ky-ri-e`), or you wrote a ligature where separate notes were needed (or vice versa).  
**Solution:** check that each syllable corresponds to **exactly one** neume or standalone note. If multiple notes are needed for one syllable, write them in a ligature (together without a space).

### "The modifier doesn't appear on the right note"

**Symptom:** mora or episema doesn't appear where it should.  
**Cause:** the suffix character applies only to the note **immediately before it**.  
**Solution:** `df.` → the mora belongs to `f`. If you want it on `d`, write `d.f` (but note: in a ligature without a space, `d.` modifies the earlier note, and `f` is the next note).

### "An empty line appeared in the middle of the score"

**Symptom:** an unexpected break or broken alignment between two sections.  
**Cause:** a blank line **starts a new section** in the parser.  
**Solution:** if you don't want a new section, don't leave a blank line between the melody and text.

## 20. Feedback and Bug Reports

The Aretino format and the renderer software are developed by volunteer developers as part of the Szent József Hackathon.
The source code is freely available on [GitHub](https://github.com/szentjozsefhackathon/cantores), where bugs can be reported and development suggestions are also welcome.

If you have questions or suggestions, write to us at [info@cantores.hu](mailto:info@cantores.hu) or on our [Facebook](https://www.facebook.com/people/Cantoreshu/61588419360930/) page.
