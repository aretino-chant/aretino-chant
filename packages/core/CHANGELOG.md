# Changelog

Important (probably breaking) changes are listed here.

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
