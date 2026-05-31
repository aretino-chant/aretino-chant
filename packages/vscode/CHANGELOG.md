# Changelog

All notable changes to the Aretino Chant Tools extension are documented here.
This project adheres to [Semantic Versioning](https://semver.org).

## [0.1.0] — 2026-05-31

Initial release.

- **Live preview** — opens a side-by-side SVG preview for `.aretino` files that
  updates as you type, with click-to-locate between the preview and the source.
- **Syntax highlighting** — semantic highlighting for pitches, barlines, neume
  groups, lyrics, headers, comments, and inline formatting, plus highlighting of
  large melodic jumps.
- **Bundled EB Garamond** — the preview renders text in EB Garamond (variable
  weight + italic) so it looks identical on every machine; a document may
  override it with `%option: textFont=…`.
- **Zoom** — toolbar buttons or `Ctrl`/`Cmd` + scroll, with a configurable
  default magnification (`aretino.preview.defaultZoom`).
- **Settings** — `aretino.preview.autoOpen` and `aretino.preview.defaultZoom`.
