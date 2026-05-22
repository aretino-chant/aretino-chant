# Test Cases

Add test cases freely — any ` ```aretino ``` ` block becomes an interactive editor with live preview.

---

## Scratch Pad

Use this block to experiment freely:

```aretino
(g2) g h i ||
```

---

## Basic Pitches

All letter pitches `a`–`n` on a G2 clef:

```aretino
(g2) a b c d e f g h i j k l m n
w:   a b c d e f g h i j k l m n
```

---

## Clefs

```aretino
(g2) d f g h  (c3) e g h  (f4) i h g
```

---

## Notehead Types

Punctum, virga (uppercase), quilisma (`w` suffix), tenor note (`t` suffix):

```aretino
(g2) d D dw dt ds
w:   punctum virga quilisma tenor small
```

---

## Modifier Suffixes

Mora (`.`), episema (`_`), ictus (`-`), liquescent (`~`):

```aretino
(g2) d d. d_ d- d~
w:   plain mora episema ictus liquescens
```

Combined modifiers:

```aretino
(g2) d_e_d_ d._ d-~
```

---

## Barlines

```aretino
(g2) g h , g h ; g h | g h || g h ||| g h :| g h |:
```

Breath mark:

```aretino
(g2) g h ' g h
```

---

## Ligatures (Neumes)

Podatus (ascending pair), clivis (descending pair):

```aretino
(g2) gh hg
w:   podatus clivis
```

Torculus and porrectus:

```aretino
(g2) ghg hgh
w:   torculus porrectus
```

Longer neumes and automatic virga on peaks:

```aretino
(g2) dfd ihgfghghjijigh
```

Neume-separator gap `/` — visual grouping within one ligature:

```aretino
(g2) fefdc.efdc./feg.gggee/cededdc. c
```

---

## Accidentals

```aretino
(g2) (K:fb#) h h h f h i j ih h_
```

---

## Raised Octave (apostrophe)

```aretino
(g2) g h i j h' i' j'
w:   g h i j h' i' j'
```

---

## Expander `*` and Spacers

```aretino
(g2) d f * g h * g f d  (||)
```

Fixed-width spacers `(sp)` and `=`:

```aretino
(g2) d f (sp2) g = h ==== f
```

---

## Explicit Line Break `(z)` / `(Z)`

```aretino
(g2) h h h g h j i g h. (z) h h h h g e e d. (Z) g g g h g f e d.
w:   O Lord, hear my hum-ble call to you! O Lord, hear my hum-ble call to you! O Lord, hear my hum-ble call to you!
```

---

## Header

```aretino
;title: Opening Prayer
;caption: Vespers
;indent: VII.
%%
(g2) h h h g h j i g h. ||
w: O Lord, hear my hum-ble call to you!
```

---

## Text and Multiple Stanzas

```aretino
(g2) g h i g. hi h g e_d_ , g hi a'g g. ||
w: Al-le-lu-ia, al-le-lu-ia, al-le-lu-ia.
```

---

## Verse Lines (W: Tag)

Psalm verses under an antiphon — the typical liturgical use case:

```aretino
(g2) g hi h g e_d_ , g hi a'g g. ||
w: Al-le-lu-ia, * al-le-lu-ia.
W: Dicsőség az Atyának és Fiúnak * és Szentlélek Istennek.
W: Miképpen kezdetben, most és mindenkor * és mindörökkön örökké. Ámen.
```

Explicit line breaks within a verse (continuation lines are indented):

```aretino
W: Dicsőség az Atyának és Fiúnak * és
Szentlélek Istennek.
W: Miképpen kezdetben,
most és mindenkor * és mindörökkön örökké, Ámen.
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
(g2) h h h g h j i g h. (z) h h h h g e e d. (Z) g g g h g f e d.
w:   O Lord, hear my hum-ble call to you! O Lord, hear my hum-ble call to you! O Lord, hear my hum-ble call to you!
```

---