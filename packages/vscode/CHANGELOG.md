# Changelog

All notable changes to the Aretino Chant Tools extension are documented here.
This project adheres to [Semantic Versioning](https://semver.org).

## [0.4.0] — 2026-10-15

- **Bundles @aretino-chant/core 0.28.1** (0.3.0 shipped 0.21.0). The preview
  picks up the renderer changes since then: redrawn noteheads, open (`o`)
  noteheads, label placement by position in the neume, lone-syllable-aware line
  breaks, hyphens across `/`-split melismas, neume-gap justification only around
  lyrics, and the `leftMargin` / `rightMargin` options.
- **Renderer-option completion** — `%option:` autocomplete is derived from
  core's option registry, so it lists every option the bundled core accepts.

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
