# Aretino Chant Preview

A VS Code extension that renders a live SVG preview of [Aretino chant
notation](https://aretino-chant.github.io) `.aretino` files.

## Features

- **Live preview** — open any `.aretino` file and a preview opens to the side,
  updating as you type.
- **EB Garamond bundled** — the preview renders text in EB Garamond (variable
  weight + italic), bundled with the extension so it looks the same on every
  machine. A document may still override the font with `%option: textFont=...`.
- **Zoom** — toolbar buttons or `Ctrl`/`Cmd` + scroll. The print staff size is
  small, so the preview is magnified for legibility without changing layout.

## Usage

- Open a `.aretino` file — the preview opens automatically (toggle with the
  `aretino.preview.autoOpen` setting).
- Or run **Aretino: Open Preview to the Side** (`Ctrl+K V` / `Cmd+K V`), or
  click the preview icon in the editor title bar.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `aretino.preview.autoOpen` | `true` | Open the preview automatically when an `.aretino` file is opened. |
| `aretino.preview.defaultZoom` | `1.4` | Initial preview magnification. |

## Development

```sh
npm install            # from the monorepo root
npm run build -w @aretino-chant/vscode   # bundle the webview
# then press F5 in VS Code with this folder open to launch an Extension Host
```

The webview bundle (`dist/webview.js`) is produced by `esbuild.js`; it inlines
`@aretino-chant/core`. The extension host (`src/`) is plain CommonJS and is not
bundled.

## Licensing

Code: MPL-2.0. Bundled EB Garamond: SIL Open Font License 1.1 (see `NOTICE`).
