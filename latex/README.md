# Aretino LaTeX Package

`aretino.sty` embeds Aretino chant notation in LuaLaTeX documents. It renders
Aretino source with the `aretino` command line renderer, converts the generated
SVG to PDF with `rsvg-convert`, and includes the PDF in the document.

Use this package when you want chant excerpts or complete Aretino source files
inside a normal LaTeX score, handout, booklet, or article.

## Requirements

- LuaLaTeX.
- Full shell escape: compile with `lualatex --shell-escape`.
- The Aretino CLI, available as `aretino` or configured with `cli=...`.
- `rsvg-convert`, usually provided by the `librsvg` package.
- `aretino.sty` on TeX's input path, or in the same directory as your document.

Install the CLI globally:

```bash
npm install -g @aretino-chant/cli
```

For development from this repository, install the workspaces from the repository
root and point the LaTeX package at the local binary:

```bash
npm install
cd latex
lualatex --shell-escape example.tex
```

The included `example.tex` uses:

```tex
\aretinosetup{
  cli        = node ../node_modules/.bin/aretino,
  width-mm   = 150,
  text-font = EB Garamond
}
```

On Debian or Ubuntu, install `rsvg-convert` with:

```bash
sudo apt install librsvg2-bin
```

On macOS with Homebrew:

```bash
brew install librsvg
```

## Quick Start

```tex
\documentclass{article}
\usepackage{aretino}

\aretinosetup{
  cli        = aretino,
  width-mm   = 150,
  text-font = EB Garamond
}

\begin{document}

\begin{aretino}
(g2) c d e
w:Ky-ri-e
\end{aretino}

\end{document}
```

Compile with:

```bash
lualatex --shell-escape document.tex
```

## Loading the Package

```tex
\usepackage{aretino}
```

The package requires LuaLaTeX and will stop with an error if it is loaded under
pdfLaTeX, XeLaTeX, or without full shell escape.

The command path options can also be set when loading the package:

```tex
\usepackage[
  cli=node ../node_modules/.bin/aretino,
  rsvg=rsvg-convert,
  cachedir=_aretino
]{aretino}
```

The same keys can be set later with `\aretinosetup`.

## Global Setup

`\aretinosetup{...}` sets defaults used by later `aretino` environments and
`\aretinofile` commands.

```tex
\aretinosetup{
  cli                  = aretino,
  rsvg                 = rsvg-convert,
  cachedir             = _aretino,
  width-mm             = 160,
  staff-space-mm       = 1.75,
  lyric-size           = 10,
  text-font            = EB Garamond,
  note-spacing         = 1,
  zoom                 = 1,
  hide-repeat-clef     = false,
  font-file            = /path/to/EBGaramond-Regular.ttf,
  font-italic          = /path/to/EBGaramond-Italic.ttf,
  font-bold            = /path/to/EBGaramond-Bold.ttf,
  font-bold-italic     = /path/to/EBGaramond-BoldItalic.ttf
}
```

Only set the keys you need. Empty keys are not forwarded to the CLI, so the
renderer's own defaults still apply.

Option lists are comma-separated. Wrap values that contain commas in braces:

```tex
\aretinosetup{
  text-font = {Palatino Linotype, serif}
}
```

## Inline Aretino Source

Use the `aretino` environment for short pieces or examples written directly in
the LaTeX file:

```tex
\begin{aretino}
(g2) c d e
w:Ky-ri-e
\end{aretino}
```

The environment body is captured verbatim and written to a generated `.aretino`
file inside the cache directory. Aretino source headers and comments beginning
with `%` are therefore preserved:

```tex
\begin{aretino}
%title: Alleluia
%option: lyricDistance=0.4
%%
(g2) g A B g. AB A g e_d_ , g AB Ag g. ||
w: Al-le-lu-ia, al-le-lu-ia, al-le-lu-ia.
\end{aretino}
```

As with other verbatim environments, do not place `\begin{aretino}...\end{aretino}`
inside command arguments, section headings, captions, or other moving arguments.

## Rendering from Files

Use `\aretinofile` to render an existing `.aretino` file:

```tex
\aretinofile{alleluia.aretino}
```

The file path is resolved by the shell command from the current LaTeX working
directory. In the common case, put the `.aretino` file next to the `.tex` file.

## Local Options

Both `\aretinofile` and the `aretino` environment accept local options. These
options use the same keys as `\aretinosetup` and apply only to that rendering.

```tex
\aretinofile[width-mm=120, zoom=1.4]{alleluia.aretino}
```

```tex
\begin{aretino}[width-mm=80, zoom=1.2, hide-repeat-clef]
(g2) c d e
w:Glo-ri-a
\end{aretino}
```

Boolean keys can be written as flags or as explicit values:

```tex
\begin{aretino}[hide-repeat-clef]
...
\end{aretino}

\begin{aretino}[hide-repeat-clef=false]
...
\end{aretino}
```

## Options Reference

### Command and Cache Options

| Key | Default | Description |
| --- | --- | --- |
| `cli` | `aretino` | Shell command used to run the Aretino CLI. |
| `rsvg` | `rsvg-convert` | Shell command used to convert SVG output to PDF. |
| `cachedir` | `_aretino` | Directory for generated `.aretino`, `.svg`, and `.pdf` files. |

`cli` and `rsvg` are command strings, so they may include a program path and
fixed arguments. Treat these values as trusted configuration, especially because
the document is compiled with `--shell-escape`.

### Rendering Options

| Key | CLI flag | Description |
| --- | --- | --- |
| `width-mm` | `--width-mm` | Layout width in millimeters. This controls line breaking. |
| `staff-space-mm` | `--staff-space-mm` | Physical size of one staff space in millimeters. |
| `lyric-size` | `--lyric-size` | Lyric font size in points. |
| `text-font` | `--text-font` | CSS font-family string used for rendered text. |
| `note-spacing` | `--note-spacing` | Horizontal note spacing multiplier. |
| `zoom` | `--zoom` | Output magnification. It does not change line breaking. |
| `font-file` | `--font-file` | Explicit upright font file for text measurement. |
| `font-italic` | `--font-italic` | Explicit italic font file for text measurement. |
| `font-bold` | `--font-bold` | Explicit bold font file for text measurement. |
| `font-bold-italic` | `--font-bold-italic` | Explicit bold italic font file for text measurement. |
| `hide-repeat-clef` | `--hide-repeat-clef` | Hide repeated clefs at the start of continuation systems. |

Other Aretino renderer options can be written in the Aretino source with
`%option:` headers when supported by the core renderer:

```aretino
%option: lyricDistance=0.5
%option: staffGap=3
%%
(g2) c d e
w:Ky-ri-e
```

Explicit LaTeX options are passed to the CLI and override matching source
header options.

## Fonts

Aretino aligns lyrics using measured text metrics. For best results, set
`text-font` to the family that should appear in the PDF:

```tex
\aretinosetup{
  text-font = EB Garamond
}
```

On Linux, the CLI can resolve installed system fonts through fontconfig. For
portable or fully reproducible builds, pass the font files explicitly:

```tex
\aretinosetup{
  text-font        = EB Garamond,
  font-file        = /home/user/fonts/EBGaramond-Regular.ttf,
  font-italic      = /home/user/fonts/EBGaramond-Italic.ttf,
  font-bold        = /home/user/fonts/EBGaramond-Bold.ttf,
  font-bold-italic = /home/user/fonts/EBGaramond-BoldItalic.ttf
}
```

For variable weight fonts you don't need the bold versions to define.

The generated SVG keeps a font-family reference. `rsvg-convert` must be able to
find the same font while converting the SVG to PDF.

## Generated Files

Each rendered block produces temporary files in `cachedir`:

- Inline environments write generated source files such as
  `_aretino/aretino-1.aretino`.
- All renderings write numbered SVG and PDF files such as
  `_aretino/aretino-0001.svg` and `_aretino/aretino-0001.pdf`.
- The PDF is included with `\includegraphics`.

The cache can be deleted at any time; it is regenerated on the next LaTeX run.

## Complete Example

```tex
% Compile with: lualatex --shell-escape example.tex
\documentclass{article}
\usepackage{aretino}

\aretinosetup{
  cli        = node ../node_modules/.bin/aretino,
  width-mm   = 150,
  text-font = EB Garamond
}

\begin{document}

\section*{Inline notation}

\begin{aretino}
(g2) c d e
w:Ky-ri-e
\end{aretino}

\section*{With local options}

\begin{aretino}[width-mm=80, zoom=1.2]
(g2) c d e
w:Glo-ri-a
\end{aretino}

\section*{From file}

\aretinofile{alleluia.aretino}
\aretinofile[zoom=1.4, width-mm=80]{alleluia.aretino}

\end{document}
```

See [`example.tex`](./example.tex) for the repository sample and
[`alleluia.aretino`](./alleluia.aretino) for a small source file.

## Troubleshooting

**`Package aretino: full --shell-escape is required`**

Compile with full shell escape:

```bash
lualatex --shell-escape document.tex
```

Restricted shell escape is not enough because the package must run both the
Aretino CLI and `rsvg-convert`.

**`SVG generation failed`**

Check that the `cli` command works from the directory where LaTeX is running:

```bash
aretino alleluia.aretino -o test.svg
```

If you are using the repository checkout rather than a global install, set
`cli` to the local binary, for example:

```tex
\aretinosetup{cli = node ../node_modules/.bin/aretino}
```

**`SVG to PDF conversion failed`**

Install `rsvg-convert` or point `rsvg` at the correct command:

```tex
\aretinosetup{rsvg = /path/to/rsvg-convert}
```

**Lyrics do not align exactly with the final PDF**

Make sure the same text font is available to both the Aretino CLI and
`rsvg-convert`. Set `text-font`, and use `font-file` plus the style-specific
font keys when the system font resolver is not enough.

## Aretino Syntax

This README documents the LaTeX wrapper. For the notation format itself, see
the core [syntax reference](../packages/core/docs/syntax-reference.md).

## License

- Source code: [MPL-2.0](../LICENSE)
- Documentation: [CC-BY-4.0](../packages/core/docs/LICENSE)
