# Changelog

Important (probably breaking) changes are listed here.

### 2026-09-17

- **A melisma written as one `/`-split neume keeps its hyphens.** Such a neume
  carries one syllable however many groups it has, so a word held over it drew
  a single hyphen beside the syllable's letters and none at all on the rows the
  neume was broken across. The hyphen run is now spread over the whole held
  passage and carried across each row break, as it already was for a melisma
  written as separate neumes. A word broken at a row end also spreads its
  trailing hyphens over the last neume instead of setting one beside the
  letters.

### 2026-09-16

- **Line breaks avoid lone syllables.** An automatic break no longer leaves one
  syllable of a word alone at the end of a line or at the start of the next
  when a nearby break fits: the row is condensed to take the syllable in, or
  the word moves to the next line. Breaks in scores that had lone syllables
  (and the rows after them) can move. Manual `(z)`/`(Z)` breaks are unchanged,
  and the lone syllable stays when fixing it would stretch or squeeze the
  spacing too far or add a line. Set the new `avoidLoneSyllables` renderer
  option to false (or `%option: avoidLoneSyllables=false`) for the previous
  breaks; `gapOutlierThresholdMin`, `wrapCondenseMin` and `wrapStretchMax` tune
  how far the spacing may bend.
- **Tenor recitations may break next to a wide word.** A recited phrase used to
  wrap only with at least two words on each side of the break, so a phrase of
  three words never wrapped. With `avoidLoneSyllables`, a word at least
  `recitationLoneWordMin` (2.25 em) wide may now stand alone at the break
  (`mert Krisztus | halála lett`). A short word is never left alone
  (`Krisztus halála | lett`), even when keeping it company adds a line.

### 2026-08-26

- **Neume gaps are only leveled and justified around real lyrics.** A gap with
  no lyric text on either side now keeps the default neume advance instead of
  being stretched, so a bare psalm melody — or one carrying nothing but
  division marks such as `*`, `+` or `~` — is laid out with even, default
  spacing rather than spread across the row. Set the new
  `justifyWithoutLyrics` renderer option (or `%option:
  justifyWithoutLyrics=true`) to restore the previous behaviour.

### 2026-05-23

- Added repeatable `%option:` headers for source-level renderer options, e.g.
  `%option: lyricDistance=0.5` and `%option: hideRepeatClef=true`.

### 2026-05-22

- **Header prefix changed from `;` to `%`.** Header fields are now written as
  `%key: value` instead of `;key: value`. The previous `;` prefix is no longer
  recognised.
- **Accidental syntax.** Accidentals are now written with a single symbol —
  `b` (flat), `n` (natural), `#` (sharp) — optionally prefixed by the target
  pitch, e.g. `(fb)`, `(fn)`, `(f#)`, `(K:f#)`. This replaces the earlier
  Gregorio-derived spelling (`bx` / `by` / `b#`), which is no longer accepted.
- An accidental directive with no pitch letter now defaults to the reciting
  position `i` in every context (previously inline accidentals defaulted to
  `b`). So `(qb)` is a flat on `i`.
- **Parenthesized notes.** Wrapping one or more notes (or a whole neume) in
  `[` … `]` renders typographical parentheses around them. Single note: `[h]`;
  ligature: `[hg]`; multiple tokens: `[h i j]`.

## 2025-05-19

- Initial extraction from cantores.hu.
- Public API: `parseAretino`, `renderAretino`.
