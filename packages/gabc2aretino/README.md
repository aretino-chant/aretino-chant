# @aretino-chant/gabc2aretino

Converts [Gregorio GABC](https://gregorio-project.github.io/gabc/index.html) chant notation to [Aretino](https://aretino-chant.github.io) chant notation.

## Installation

```bash
npm install @aretino-chant/gabc2aretino
```

## Usage

```js
import { gabcToAretino } from '@aretino-chant/gabc2aretino';

const gabc = `name: Kyrie;%%
Ky(f)ri(g)e(h) e(j)le(i)i(h)son(g.)`;

const aretino = gabcToAretino(gabc);
// (g2) fgh jiFG.
// w: Ky-ri-e e-le-i-son
```

## API

### `gabcToAretino(gabc: string): string`

Converts a GABC string (with or without a header section separated by `%%`) to Aretino notation. Returns an empty string if there are no neumes in the input.

The output starts with a `(g2)` clef token. If the GABC clef implies a flat key signature (e.g. `cb3`, `cb4`), a `(K:b)` token follows.

## Supported features

- **Clefs**: `c1`, `c2`, `c3`, `c4` (default), `f3`, `f4`, `cb3`, `cb4`
- **Barlines**: breath mark `,`, quarter bar `'`, half bar `;`, full bar `:`, double bar `::`, and interrogative `?` variants
- **Accidentals**: flat `x`, natural `y`, sharp `#` — both as standalone signs and as intra-neume suffixes
- **Neume shapes**: virga `v`/`V`/`O`, quilisma `w`/`W`, oriscus `>`, apostropha/strophe `o`/`s`, tenor (empty notehead) `r`/`R`
- **Ornaments**: mora `.`, ictus `'`, episema `_`, liquescent `~` (mapped to small notehead)
- **Rhythmic accents**: `r1`–`r5` mapped to Aretino accent characters
- **Repeated suffixes**: `gss` → `gsgs`, `gvv` → `g'g'`
- **Trailing suffix redistribution**: `gh..` → `g.h.`, `gh__` → `g_h_`
- **Intra-neume spacing**: `/` gaps and `//` double gaps
- **Initio debilis**: leading `-` produces a small notehead
- **Lyrics**: text, syllable hyphenation, `<sp>`, `<b>`, `<i>`, `<ul>`, `<sc>`, `<tt>`, `<c>` tags

## License

[MPL-2.0](./LICENSE) © 2026 Bertalan Fodor
