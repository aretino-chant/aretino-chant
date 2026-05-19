# Aretino Chant

A text format for Gregorian chant, plus a JavaScript parser and SVG renderer.

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

## Documentation

- [Format specification](./docs/format.md)
- [Cheatsheet](./docs/cheatsheet.md)
- [Felhasználói útmutató (HU)](./docs/hu/user-guide.md)

## License

- Source code: [MPL-2.0](./LICENSE)
- Specification and documentation: [CC-BY-4.0](./docs/LICENSE)

See [NOTICE](./NOTICE) for the full attribution.
