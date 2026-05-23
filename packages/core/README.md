# Aretino Chant

A text format for Gregorian chant, plus a JavaScript parser and SVG renderer.
Based on the practical Gregorian notation promoted by László Dobszay and Janka Szendrei.

<img width="682" height="244" alt="image" src="https://github.com/user-attachments/assets/246f8196-105d-4a30-a807-0d97c1e21c2e" />

## Install

```bash
npm install @aretino-chant/core
```

## Use

```js
import { parseAretino, renderAretino } from '@aretino-chant/core';

const ast = parseAretino(source);
const svg = renderAretino(ast);
```

## Development

### Run the test page

Start a local dev server with an interactive test page:

```bash
npm run dev
```

Then open the URL printed in the terminal (typically `http://localhost:5173`).

### Run tests

```bash
npm test
```

### Release a new version

1. Update the version number in `packages/core/package.json` (follow [semver](https://semver.org)):
   ```bash
   npm version patch -w packages/core   # 0.1.0 → 0.1.1  (bug fixes)
   npm version minor -w packages/core   # 0.1.0 → 0.2.0  (new features)
   npm version major -w packages/core   # 0.1.0 → 1.0.0  (breaking changes)
   ```
   This also creates a git commit and tag automatically.

2. Push the commit and tag:
   ```bash
   git push && git push --tags
   ```

3. Publish to the npm registry (from the repo root):
   ```bash
   npm run release
   ```

## License

- Source code: [MPL-2.0](./LICENSE)
- Specification and documentation: [CC-BY-4.0](./docs/LICENSE)

See [NOTICE](./NOTICE) for the full attribution.
