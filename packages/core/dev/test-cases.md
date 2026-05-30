# Test Cases

Add test cases freely — any ` ```aretino ``` ` block becomes an interactive editor with live preview.

---

## Scratch Pad

Use this block to experiment freely:

```aretino
(g2) g a b ||
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
w:   punctum virga quilisma tenor small
```

---

## Modifier Suffixes

Mora (`.`), episema (`_`), ictus (`-`), liquescent (`~`):

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

Inline uppercase accidentals:

```aretino
(g2) (Fb) F (fn) f (C#) C  (An)A
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

## Explicit Line Break `(z)` / `(Z)`

```aretino
(g2) a a a g a j b g a. (z) a a a a g e e d. (Z) g g g a g f e d.
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
(g2) a a a g a j b g h. ||
w: O Lord, hear my hum-ble call to you!
```

---

## Text and Multiple Stanzas

```aretino
(g2) g a b g. ab a g e_d_ , g ab ag g. ||
w: Al-le-lu-ia, al-le-lu-ia, al-le-lu-ia.
w: Al-le-lu-ja, al-le-lu-ja, al-le-lu-ja.
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

