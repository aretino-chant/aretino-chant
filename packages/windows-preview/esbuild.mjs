/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Bundles the page the preview handler loads into WebView2 (which imports
// @aretino-chant/core) into a single IIFE. The C# project copies the result,
// the HTML/CSS and the EB Garamond fonts next to the handler DLL.

import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');

await esbuild.build({
    entryPoints: [path.join(here, 'web', 'main.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outfile: path.join(here, 'web', 'dist', 'preview.js'),
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
});
