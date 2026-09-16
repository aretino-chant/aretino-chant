/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Regenerates the OPTION_VALUE_OPTIONS block in src/completion.js from
// @aretino-chant/core's RENDERER_OPTIONS (the single source of truth for
// %option: renderer directives — see packages/core/src/options.js). The
// extension host is plain CommonJS and can't import core's ESM module at
// runtime, so this dev-time script keeps a generated copy in sync instead.
//
// Usage:
//   node scripts/generate-renderer-options.mjs         (rewrite the file)
//   node scripts/generate-renderer-options.mjs --check  (exit 1 if stale)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RENDERER_OPTIONS } from '../../core/src/index.js';

const START = '/* GENERATE:OPTION_VALUE_OPTIONS:START */';
const END = '/* GENERATE:OPTION_VALUE_OPTIONS:END */';

function renderBlock() {
    const items = RENDERER_OPTIONS.map(({ name, type, detail, default: def }) =>
        `    { label: '${name}', detail: '${type} — ${detail} (default: ${def})', section: SECTION.rendererOptions },`
    ).join('\n');
    return `${START}\nconst OPTION_VALUE_OPTIONS = [\n${items}\n];\n${END}`;
}

function main() {
    const check = process.argv.includes('--check');
    const file = fileURLToPath(new URL('../src/completion.js', import.meta.url));
    const src = readFileSync(file, 'utf8');

    const startIdx = src.indexOf(START);
    const endIdx = src.indexOf(END);
    if (startIdx === -1 || endIdx === -1) {
        console.error(`Could not find ${START} / ${END} markers in ${file}`);
        process.exit(1);
    }

    const block = renderBlock();
    const updated = src.slice(0, startIdx) + block + src.slice(endIdx + END.length);

    if (check) {
        if (updated !== src) {
            console.error(
                'src/completion.js is out of date with packages/core/src/options.js.\n' +
                'Run `npm run generate -w packages/vscode` to refresh it.'
            );
            process.exit(1);
        }
        console.log('src/completion.js renderer options are up to date.');
        return;
    }

    if (updated !== src) {
        writeFileSync(file, updated);
        console.log('Updated OPTION_VALUE_OPTIONS in src/completion.js.');
    } else {
        console.log('src/completion.js renderer options already up to date.');
    }
}

main();
