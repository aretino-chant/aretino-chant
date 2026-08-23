# aretino-chant

Monorepo for the Aretino chant notation format.

## Documentation

- See the full User Guide at [aretino-chant.github.io](https://aretino-chant.github.io)
- Rendering test cases for the latest build are at [aretino-chant.github.io/aretino-chant](https://aretino-chant.github.io/aretino-chant)

## Packages

| Package | Description |
|---------|-------------|
| [`@aretino-chant/core`](packages/core) | Text format, parser, and SVG renderer |
| [`@aretino-chant/editor`](packages/editor) | CodeMirror-based editor web component |
| [`@aretino-chant/gabc2aretino`](packages/gabc2aretino) | Converter from GABC to Aretino notation |

## Releasing

Publishing is driven by the version field, not by tags: bump a package's
`version` in its `package.json` and merge that to `main`. The
[publish workflow](.github/workflows/publish.yml) runs the tests, builds the
workspaces, and publishes every `@aretino-chant/*` package whose version is not
on the registry yet — in dependency order, so `core` lands before the packages
that depend on it. Packages whose version is unchanged are left alone, so a
commit that bumps only one package publishes only that one.

To rehearse a release without publishing, run the workflow manually with the
*dry run* input, or run `node scripts/publish-bumped.mjs --dry-run` locally.

The workflow needs an `NPM_TOKEN` repository secret — an npm automation token
(or a granular token with write access to the `@aretino-chant` scope) with
two-factor authentication not required for publishing. Packages are published
with [npm provenance](https://docs.npmjs.com/generating-provenance-statements),
which is why every published manifest carries a `repository` field.

The VS Code extension in `packages/vscode` is not covered: it ships to the
Marketplace via `npm run publish -w packages/vscode`.

## License

- Source code: [MPL-2.0](./LICENSE)
- Specification and documentation: [CC-BY-4.0](./packages/core/docs/LICENSE)
