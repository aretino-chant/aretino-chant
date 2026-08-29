# Test Cases

Add test cases freely — any ` ```aretino ``` ` block becomes an interactive editor with live preview.

---

## Scratch Pad

Use this block to experiment freely:

```aretino
(g2) c c e f g a g f g g. | a C b g a g f g g. | g a g e_ f gf d c. c. ||
w: Ma-gasz-tal-juk az U-rat mind-nyá-jan, és di-csér-jük e-gyütt szent ne-vét, mert jó az Úr az Őt fé-lők-höz!
```

---

## Basic Pitches

All letter pitches `a`–`n` on a G2 clef:

```aretino
(g2) A B c d e f g a b C D E F G
w:   A B c d e f g a b C D E F G
```

---

## Clefs

```aretino
(g2) d f g a  (c3) e g a  (f4) b a g
```

---

## Notehead Types

Punctum, virga (uppercase), quilisma (`w` suffix), tenor note (`t` suffix):

```aretino
(g2) d d' dw dt ds
w:   punctum virga quilisma tenor~text~for~multiple~syllables small
```

---

## Modifier Suffixes

Mora (`.`), episema (`_`), ictus (`-`), plica (`~`):

```aretino
(g2) d d. d_ d- d~
w:   plain mora episema ictus plica
```

Combined modifiers:

```aretino
(g2) d_e_d_ d._ d-~
```

---

## Barlines

```aretino
(g2) g a , g a ; g a | g a || g a ||| g a :| g a |: :|: ,2
w: (,) (;) (|) (||) (|||) (:|) (|:) (:|:) (,2)
```

Dotted barline and invisible barline:

```aretino
(g2) g a |? g a |0 g a
w: (dotted) (invisible)
```

Breath mark:

```aretino
(g2) g a ' g h
```

Plica barline (positioned at the last note's pitch):

```aretino
(g2) g a ~ g b ~ a f ~ g
w:   (g) (i) (h)
```

---

## Ligatures (Neumes)

Podatus (ascending pair), clivis (descending pair):

```aretino
(g2) ga ag
w:   podatus clivis
```

Torculus and porrectus:

```aretino
(g2) gag aga
w:   torculus porrectus
```

Longer neumes and automatic virga on peaks:

```aretino
(g2) dfd CagfgagaCbCbga
```

Suppress auto-virga with backtick `` ` `` (peak loses stem, loosens connection without extra space):

```aretino
(g2) bag C`bg
```

Neume-separator gap `/` — visual grouping within one ligature:

```aretino
(g2) fefdc.efdc./feg.gggee/cededdc. c
```

A plica on a non-final note of a run cuts the ligature exactly like `/` — the
second and third groups below are spaced identically, while the first stays tight:

```aretino
(g2) gab g. || g/ab g. || g~ab g.
```

---

## Accidentals

Current spelling — `b` flat, `n` natural, `#` sharp:

```aretino
(g2) (K:f#) a a a f a b C ba a_
```

Inline, standalone, and natural cancelling a key-signature accidental:

```aretino
(g2) (K:fb) f f (fn) f f  (C#) b C
```

Uppercase accidental pitches for octave shifts:

```aretino
(g2) (K:F# C#) b C D b C D
```

Key signature shortcuts — `(Kb)` one flat, `(Kbb)` two flats, `(K#)` one sharp, `(K##)` two sharps, `(K)` clear:

```aretino
(g2) (Kb) b C D b | (Kbb) b C D b | (K#) b C D b | (K##) b C D b | (K) b C D b
```

Inline uppercase accidentals:

```aretino
(g2) (Fb) F (fn) f (C#) C  (An)A
```

An accidental holds until the next barline. When the measure wraps to a new row,
the renderer repeats it before the first neume on that row that it affects:

```aretino
(g2) g (bb) b a g b a g. (z) b a g b. ||
w: O Lord, hear my hum-ble call to you a-gain now.
```

---

## Parenthesized Notes

Individual parenthesized notes:

```aretino
(g2) g [a] b [c] g
w:   plain opt plain opt plain
```

Parenthesized neume (ligature):

```aretino
(g2) ga [ag] gag [aga] g
w:   pod  cliv torc porr end
```

Parenthesized note group (multiple notes in parens):

```aretino
(g2) g [a b C] g [b a] g.
w:   a  b c d e  f g h.
```

Mixed: lyrics with parenthesized syllables:

```aretino
(g2) a b [a] a a a [ga] a. ||
w:   Glo-ri-\(a\) ex-cel-\(sis\)
```

---

## Raised Octave (uppercase)

```aretino
(g2) g a b C D E F
w:   g a b C D E F
```

## Octave-Shift Markers (`^` / `v`)

The 14 letters run out at `A` and `G`. Prefix a pitch with `^` to raise it an
octave or `v` to lower it; ledger lines are drawn automatically:

```aretino
(g2) g a b C D E F G ^a ^b ^C ^D
w:   up and o-ver the top of the staff and be-yond
```

```aretino
(g2) e d c B A vg vf ve vd
w:   down be-low the bot-tom of the range here
```

Markers stack (`^^c` is two octaves up) and work glued inside a ligature:

```aretino
(g2) c ^^c ^^^c | g^a^bg ga^bC vgvfg
```

---

---

## Expander `*` and Spacers

```aretino
(g2) d f * g a * g f d  (||)
```

Fixed-width spacers `(sp)` and `=`:

```aretino
(g2) d f (sp2) g = a ==== f
```

---

## Gap Leveling and Outlier Syllables

Neume gaps on a line level to the widest lyric-forced gap — except outliers.
A gap whose floor exceeds `gapOutlierThreshold` (in staff-spaces) keeps its
own width locally instead of widening every other gap on the line. Here the
gaps around "Extraordinarily" stay wide while all other gaps stay uniform:

```aretino
(g2) g g g g g g
w: no no Extraordinarily no no no
```

Raising `gapOutlierThreshold` past the widest gap turns the outlier rule off —
now "Extraordinarily" widens every gap on the line:

```aretino
%option: gapOutlierThreshold=100
%%
(g2) g g g g g g
w: no no Extraordinarily no no no
```

---

## Spacing Without Lyrics

A gap is leveled/justified only where real lyric text sits on one of its sides.
A bare psalm melody keeps the default neume advance even across a `(z)` break:

```aretino
(g2) g g g g a g. g f g g. (z) g g g g a g. g f g g. ||
```

Division marks (`*`, `+`, `\V`, `~`, punctuation) reserve their own room but do
not count as sung text, so this row is not justified:

```aretino
(g2) g g g g a g. (z) g f g g. ||
w: * + * \V ~ .
```

The same row with sung syllables under it justifies as usual:

```aretino
(g2) g g g g a g. (z) g f g g. ||
w: Di-cső-ség az A-tyá-nak
```

`%option: justifyWithoutLyrics=true` restores the older, unconditional
justification:

```aretino
%option: justifyWithoutLyrics=true
%%
(g2) g g g g a g. g f g g. (z) g g g g a g. g f g g. ||
```

---

## Explicit Line Break `(z)` / `(Z)`

```aretino
(g2) a a a g a C b g a. (z) a a a a g e e d. (Z) g g g a g f e d.
w:   O Lord, hear my hum-ble call to you! O Lord, hear my hum-ble call to you! O Lord, hear my hum-ble call to you!
```

---

## Header

```aretino
%title: Opening Prayer
%caption: Vespers
%indent: VII.
%rubric: During procession
%%
(g2) a a a g a C b g a. ||
w: O Lord, hear my hum-ble call to you!
```

## Transpose

`%transpose: N` shifts the rendered music by `N` semitones, leaving the source
text alone. The key signature is transposed — or added where the source had
none — and inline accidentals appear where the new key needs them:

```aretino
%transpose: 2
%%
(g2) c d e f g a g f | e_ d. c. ||
w: Trans-posed up a whole tone, with key sig-na-ture.
```

```aretino
%transpose: -3
%%
(g2) (K:bb) f g a b C b a g f. ||
```

---

## Repeated Clef and Bare Key Signature

`hideRepeatClef=true` drops the clef normally redrawn at the start of a wrapped
row. The key signature still repeats, and keeps its inset from the staff edge:

```aretino
%option: hideRepeatClef=true
%%
(g2) (K:bb) a a a g a C b g a. (z) b a g f g a g. ||
w: O Lord, hear my hum-ble call to you! O Lord, hear my call.
```

---

## Other Renderer Options

Any option accepted by `renderAretino` can be set from the header, one per line:

```aretino
%option: lyricSize=14
%option: lyricDistance=1.5
%option: noteSpacing=1.6
%%
(g2) a a a g a C b g a. ||
w: O Lord, hear my hum-ble call to you!
```

---

---

## Text and Multiple Stanzas

```aretino
(g2) g a b g. ab a g e_d_ , g ab ag g. ||
w: Al-le-lu-ia, al-le-lu-ia, al-le-lu-ia.
w: Al-le-lu-ja, al-le-lu-ja, al-le-lu-ja.
```

## Music Continuation (`n:`)

`n:` switches back to music after `w:` lines. The `w:` lines that follow
continue the previous note-aligned lyric lines, in order, instead of starting
new stanzas — so this renders as two stanzas over one continuous melody:

```aretino
(g2) g a b g.
w: Al-le-lu-ia,
w: Al-le-lu-ja,
n: ab a g e_d_ ||
w: al-le-lu-ia.
w: al-le-lu-ja.
```

## Prefix Text Alignment (`~~`)

Text before `~~` is a prefix rendered to the left of the note; the part after `~~` is centred under the note.
The preceding note must advance far enough that the prefix text doesn't collide with it.
The first note of a row must also have enough pre-gap so the prefix doesn't go past the left margin.

```aretino
(g2) g a b c d e f
w: a longlongprefix~~b c d e f g
```

## Split Melisma (Multi-group syllable)

Double (or more) hyphens assign multiple note groups to one syllable.
`Al--le` means "Al" spans 2 note groups; `lu---ia` means "lu" spans 3.

```aretino
(g2) cd ef ga gf ef ed c. (z)
w: Al- - le -lu - - - ia.
```

---

## Text and formatting

```aretino
(g2) c d e f g | a
w: <italic> {bold} [underlined] {<[nested]>} \{escaped\} (\red{{bold red}}) \color:green{green}
```

```aretino
(g2) c d e f | g
w: normal \small{small text} normal \large{large text} normal
```

```aretino
at b |
w: This~is~a~very~very~long~text~sung~on~the~same~note~so~probably~won't~fit~on~one~line~unless~it~does~so~I~need~really~long text
```

```aretino
(c4) gfgfg gfgfg g g
w: a__ b ro_.`;
```

---

## Syllable Boundaries and Extenders

`-` is a collapsible hyphen, `=` a mandatory one, `\-` a literal hyphen inside a
single syllable, and `~` a non-breaking space that binds words into one syllable:

```aretino
(g2) g a g a g a g a
w: col-lapse man=da-to-ry on\-ly two~words
```

Extender underscores hold a syllable over following neumes — `ro_` over its own,
`ro__` over one more, `ro___` over two more — with trailing punctuation set at
the far end of the line:

```aretino
(g2) g g g g g g
w: ro_ ro__ ro___.
```

---

## Braces and Spanning Marks

`{ … }` draws an overbrace; `\arc{`, `\line{`, `\slur{` and `\slurSolid{` select
other shapes. A quoted label after the closing `}` is drawn for brace, arc and
line:

```aretino
(g2) { g a b C } g { a b C D }"melisma" g.
```

```aretino
(g2) \arc{ g a b } C \line{ C D E F } g.
```

Slurs are drawn below the notes (dashed, and solid):

```aretino
(g2) \slur{f a} g \slurSolid{a g} f.
```

```aretino
(g2) { g a b C }"1." g { a b C D }"2." g.
```

A span crossing a row break continues on the next row:

```aretino
(g2) { g a b C a b C (z) D a b C a b } g.
```

---

## Labels
```aretino
(g2) c"<Label:>" d e f g | a
```

Inline accidental glyphs in labels (`\b` flat, `\n` natural, `\#` sharp):
```aretino
(g2) c"! \b ! \n ? \# ." d e f | a
```

Stress mark glyph in labels (`\'`):
```aretino
(g2) {c d e}"\' stress" f g | a
```

## Verse Lines (W: Tag)

Psalm verses under an antiphon — the typical liturgical use case:

```aretino
(g2) (K:B) a_gb'ag/a_C CCCagaga a. ;
w: Haec di-es (\red{*})
W: <This is the day the Lord has made; let us rejoice and be glad.>
W: <\V. Give thanks to the Lord, for he is good, for his mercy endures forever.>
```

Explicit line breaks within a verse (continuation lines are indented):

```aretino
W: Glory be to the Father and to the Son, *
and to the Holy Spirit,
W: as it was in the beginning is now, *
and ever shall be world without end. Amen
```

Verse lines with formatting (bold, italic, liturgical signs):

```aretino
W: {Gloria} Patri, et \V Filio, * et Spiritui Sancto.
W: \R Sicut erat in principio, * et nunc et semper.
W: + dagger ++ double~dagger (unbreakable~space)
```

## Text Block Styles

`W(style):` sets a block's typography. `psalm` (the default) and `stanza` keep
source line breaks; `prose` and `rubric` reflow them. The seam between two
styles takes the larger of the two spacings:

```aretino
W(prose): Az áldozás alatt a nép énekelhet, vagy a kántor
zsoltárt énekelhet — ez a sor folyószövegként tördelődik.

W(stanza): Ó jöjj, ó jöjj, Emmánuel,
csak téged áhít Izrael,

W(rubric): A pap a nép felé fordul.

W: Dicsőség az Atyának és Fiúnak *
és Szentlélek Istennek.
```

`%option: textStyle=` sets the document default; a `W(style):` marker still wins.
`|` is a manual line break — the break that survives reflowing in `prose`:

```aretino
%option: textStyle=prose
%%
W: Ez a blokk folyószöveg, mert a dokumentum alapstílusa prose. | Ez a sor a kézi töréstől kezdődik.
W(psalm): Ez a blokk viszont zsoltárstílusú, mert a blokk jelölése erősebb.
```

---

## Text Block Markers

`~~` splits a marker — a verse number, a `℟`, a role label — from the block body.
The marker hangs at the left margin and the bodies share a text column across
blocks of the same style, so `1.` and `10.` line up:

```aretino
W(stanza): 1.~~Ó jöjj, ó jöjj, Emmánuel,
W(stanza): 10.~~Ó jöjj, ó jöjj, Adonáj,
W: \R.~~Dicsőség az Atyának és Fiúnak
W(prose): Előénekes~és~nép:~~Az áldozás alatt a nép énekelhet.
```

`textMarkerAlign=right` sets the markers flush against the text column instead
of the left margin, so a short `1.` ends where a long `Refrén.` ends:

```aretino
%option: textMarkerAlign=right
%%
W(stanza): 1.~~Első versszak
W(stanza): Refrén.~~Második versszak
```

---

---

## Fixed Width (Non-Responsive)

This block lays out to a fixed physical width of 18 cm — its line breaks stay
put no matter how wide the editor is, unlike the responsive blocks above:

```aretino fixed width=18cm
(g2) a a a g a C b g a. (z) a a a a g e e d. (Z) g g g a g f e d.
w:   O Lord, hear my hum-ble call to you! O Lord, hear my hum-ble call to you! O Lord, hear my hum-ble call to you!
```

---

## Per Row Rendering

Each row of the piece is rendered as a separate SVG (via `splitRowSVGs`). The Kyrie VIII has four rows.

```aretino perrow
%indent: 5
%rubric: Kyrie VIII.
(g2) f (bb)abC C.D'CbC. F'DC-bCDC. , (bb)C'ag-fba g- g f. || a a'gf-ef.(bb)f`ab`C'.D'CbC. , (bb)C'ag-fba g- g f. || F- E F'ED-EFC.(bb)FCD'./ab`C'. , (bb)C'ag-fba g- g f. || F- E F'ED-EFC. , FEF'ED-EFC.(bb)FCD'./ab`C'. , (bb)C'ag-fba g- g f. ||
w: KY-ri-e *~~ e-lé-i-son. (<iij.>) Chri-ste e-lé-i-son. (<iij.>) Ký-ri-e e-lé-i-son. (<ij.>) Ký-ri-e (*) ~ (**) e-lé-i-son.
W: KYRIE ELEISON! CHRISTE ELEISON! KYRIE ELEISON!
```

Per row with `staffGap=1` — lyrics must not be clipped between rows (staff gap is measured from lyric bottom, not staff line):

```aretino perrow
%option: staffGap=1
(g2) f (bb)abC C.D'CbC. F'DC-bCDC. , (bb)C'ag-fba g- g f. || a a'gf-ef.(bb)f`ab`C'.D'CbC. , (bb)C'ag-fba g- g f. || F- E F'ED-EFC.(bb)FCD'./ab`C'. , (bb)C'ag-fba g- g f. || F- E F'ED-EFC. , FEF'ED-EFC.(bb)FCD'./ab`C'. , (bb)C'ag-fba g- g f. ||
w: KY-ri-e *~~ e-lé-i-son. (<iij.>) Chri-ste e-lé-i-son. (<iij.>) Ký-ri-e e-lé-i-son. (<ij.>) Ký-ri-e (*) ~ (**) e-lé-i-son.
W: KYRIE ELEISON! CHRISTE ELEISON! KYRIE ELEISON!
```

---

## First Row With Headers

Only the first row, including the rubric header (via `splitRowSVGs()[0]`):

```aretino firstrow
%indent: 5
%rubric: Kyrie VIII.
(g2) f (bb)abC C.D'CbC. F'DC-bCDC. , (bb)C'ag-fba g- g f. || a a'gf-ef.(bb)f`ab`C'.D'CbC. , (bb)C'ag-fba g- g f. || F- E F'ED-EFC.(bb)FCD'./ab`C'. , (bb)C'ag-fba g- g f. || F- E F'ED-EFC. , FEF'ED-EFC.(bb)FCD'./ab`C'. , (bb)C'ag-fba g- g f. ||
w: KY-ri-e *~~ e-lé-i-son. (<iij.>) Chri-ste e-lé-i-son. (<iij.>) Ký-ri-e e-lé-i-son. (<ij.>) Ký-ri-e (*) ~ (**) e-lé-i-son.
W: KYRIE ELEISON! CHRISTE ELEISON! KYRIE ELEISON!
```

---

## First Row Without Headers

Only the first staff row, with no title/rubric content (via `renderFirstRow`):

```aretino firstrow noheader
%indent: 5
%rubric: Kyrie VIII.
(g2) f (bb)abC C.D'CbC. F'DC-bCDC. , (bb)C'ag-fba g- g f. || a a'gf-ef.(bb)f`ab`C'.D'CbC. , (bb)C'ag-fba g- g f. || F- E F'ED-EFC.(bb)FCD'./ab`C'. , (bb)C'ag-fba g- g f. || F- E F'ED-EFC. , FEF'ED-EFC.(bb)FCD'./ab`C'. , (bb)C'ag-fba g- g f. ||
w: KY-ri-e *~~ e-lé-i-son. (<iij.>) Chri-ste e-lé-i-son. (<iij.>) Ký-ri-e e-lé-i-son. (<ij.>) Ký-ri-e (*) ~ (**) e-lé-i-son.
W: KYRIE ELEISON! CHRISTE ELEISON! KYRIE ELEISON!
```

