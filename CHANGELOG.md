# Changelog

## Unreleased

### Changed

- **Accidental syntax.** Accidentals are now written with a single symbol —
  `b` (flat), `n` (natural), `#` (sharp) — optionally prefixed by the target
  pitch, e.g. `(fb)`, `(fn)`, `(f#)`, `(K:f#)`. This replaces the earlier
  Gregorio-derived spelling (`bx` / `by` / `b#`), which is no longer accepted.
- An accidental directive with no pitch letter now defaults to the reciting
  position `i` in every context (previously inline accidentals defaulted to
  `b`). So `(b)` is a flat on `i`.

## 0.1.0 — Unreleased

- Initial extraction from cantores.hu.
- Public API: `parseAretino`, `renderAretino`.
