# aretino-chant

Monorepo for the Aretino chant notation format.

## Packages

| Package | Description |
|---------|-------------|
| [`@aretino-chant/core`](packages/core) | Text format, parser, and SVG renderer |
| [`@aretino-chant/editor`](packages/editor) | CodeMirror-based editor web component |

## Development

```bash
npm install          # install all workspace dependencies
npm test             # run tests across all packages
npm run dev          # start the core dev server
npm run build        # build all packages
```

## License

- Source code: [MPL-2.0](./LICENSE)
- Specification and documentation: [CC-BY-4.0](./packages/core/docs/LICENSE)
