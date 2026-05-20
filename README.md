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

## Documentation

- See the [aretino-chant.github.io](https://aretino-chant.github.io)

## License

- Source code: [MPL-2.0](./LICENSE)
- Specification and documentation: [CC-BY-4.0](./docs/LICENSE)

See [NOTICE](./NOTICE) for the full attribution.
