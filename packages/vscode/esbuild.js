/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Bundles the webview script (which imports @aretino-chant/core, a browser-only
// module that uses canvas text measurement) into a single IIFE the VS Code
// webview can load. The extension host itself is plain CommonJS and is not
// bundled.

const esbuild = require('esbuild');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
    const ctx = await esbuild.context({
        entryPoints: [path.join(__dirname, 'webview', 'main.js')],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'es2020',
        outfile: path.join(__dirname, 'dist', 'webview.js'),
        sourcemap: !production,
        minify: production,
        logLevel: 'info',
    });

    if (watch) {
        await ctx.watch();
        console.log('[esbuild] watching webview bundle…');
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
