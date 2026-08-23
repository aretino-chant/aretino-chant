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

There is no npm token to keep in sync: the workflow authenticates with
[trusted publishing](https://docs.npmjs.com/trusted-publishers), exchanging the
job's OIDC identity for a short-lived credential. Each package is configured on
npmjs.com under *Settings → Trusted Publisher* with this repository and the
`publish.yml` workflow filename; a new package needs that entry before its first
automated publish. Trusted publishing also attaches
[provenance](https://docs.npmjs.com/generating-provenance-statements)
automatically, which is why every published manifest carries a `repository`
field.

The VS Code extension in `packages/vscode` is not covered: it ships to the
Marketplace via `npm run publish -w packages/vscode`.

## License

- Source code: [MPL-2.0](./LICENSE)
- Specification and documentation: [CC-BY-4.0](./packages/core/docs/LICENSE)
