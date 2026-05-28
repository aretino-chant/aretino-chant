# Aretino CLI

Command line renderer for Aretino chant source files. It reads `.aretino`
source from a file or from stdin and writes SVG to stdout or to a file.

## Install

```bash
npm install -g @aretino-chant/cli
```

## Use

```bash
aretino input.aretino --output output.svg
cat input.aretino | aretino --output output.svg
```

## Renderer Options

The CLI exposes `@aretino-chant/core` renderer options as command line
parameters. Use the core option name in kebab-case:

```bash
aretino input.aretino \
  --width-mm 180 \
  --staff-space-mm 1.75 \
  --lyric-size 10 \
  --text-font "EB Garamond" \
  --output output.svg
```

Common mappings:

| Core API option | CLI parameter |
|---|---|
| `width` | `--width` |
| `widthMm` | `--width-mm` |
| `dpi` | `--dpi` |
| `staffSpaceMm` | `--staff-space-mm` |
| `lyricSize` | `--lyric-size` |
| `textFont` | `--text-font` |
| `noteSpacing` | `--note-spacing` |
| `zoom` | `--zoom` |
| `hideRepeatClef` | `--hide-repeat-clef` |
| `sourceMap` | `--source-map` |

Renderer options can also be written in the source file with `%option:`
headers. Explicit command line parameters override matching source options.

## Font Resolution

Aretino needs real text metrics to align lyrics accurately under the notation.
Set the text font explicitly with `--text-font` so the SVG text and the
measured text use the same font:

```bash
aretino input.aretino \
  --text-font "EB Garamond" \
  --output output.svg
```

For system fonts this works well because the CLI can resolve the requested font
family for measurement, and the generated SVG keeps the `font-family` reference.
On Linux, system font resolution uses fontconfig. Fonts are not embedded into
the SVG; the SVG renderer or converter must be able to find the same font on the
system where the SVG is displayed or converted.

For custom font files, pass the files used for measurement explicitly. Still set
`--text-font` to the family name that the SVG should request:

```bash
aretino input.aretino \
  --text-font "EB Garamond" \
  --font-file ~/fonts/EBGaramond-Regular.ttf \
  --font-italic ~/fonts/EBGaramond-Italic.ttf \
  --output output.svg
```

Use `--font-bold` and `--font-bold-italic` as static-file overrides when the
family cannot derive those styles from the regular or italic font.

If the font cannot be resolved, the SVG is still generated, but lyric spacing may
fall back to estimated metrics and can differ from the final renderer.

## PDF Conversion

Use `rsvg-convert` to convert the SVG to PDF:

```bash
aretino input.aretino \
  --text-font "EB Garamond" \
  --output output.svg

rsvg-convert -f pdf -o output.pdf output.svg
```

`rsvg-convert` is the recommended PDF path because it resolves and embeds the
referenced text fonts in the PDF while preserving the vectorised musical
symbols from the SVG.

## License

- Source code: [MPL-2.0](../../LICENSE)
- Documentation: [CC-BY-4.0](../core/docs/LICENSE)
