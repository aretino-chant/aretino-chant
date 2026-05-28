#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { renderAretino } from '@aretino-chant/core';
import { createFontkitMeasureFn } from '../src/measure-fontkit.js';

const HELP = `\
Usage: aretino [input.aretino] [options]
       cat input.aretino | aretino [options]

Options:
  --output, -o <file>       Write SVG to file instead of stdout
  --width <px>              Layout width in pixels
  --width-mm <mm>           Layout width in mm
  --dpi <n>                 DPI for mm→px conversion (default: 96)
  --staff-space-mm <mm>     Physical staff space size (default: 1.75)
  --lyric-size <pt>         Lyric font size in points (default: 10)
  --lyric-font <family>     CSS font-family string for lyrics
  --note-spacing <n>        Note spacing multiplier (default: 1)
  --zoom <n>                Output magnification (default: 1)
  --font-file <path>        Font file for accurate text measurement via fontkit
  --hide-repeat-clef        Don't repeat clef at the start of continuation lines
  --help, -h                Show this help
`;

const { values, positionals } = parseArgs({
    options: {
        output:           { type: 'string',  short: 'o' },
        width:            { type: 'string' },
        'width-mm':       { type: 'string' },
        dpi:              { type: 'string' },
        'staff-space-mm': { type: 'string' },
        'lyric-size':     { type: 'string' },
        'lyric-font':     { type: 'string' },
        'note-spacing':   { type: 'string' },
        zoom:             { type: 'string' },
        'font-file':      { type: 'string' },
        'hide-repeat-clef': { type: 'boolean' },
        help:             { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
});

if (values.help) {
    process.stdout.write(HELP);
    process.exit(0);
}

function num(v) {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (isNaN(n)) { process.stderr.write(`Invalid number: ${v}\n`); process.exit(1); }
    return n;
}

async function main() {
    let source;
    if (positionals.length > 0) {
        source = readFileSync(positionals[0], 'utf8');
    } else {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        source = Buffer.concat(chunks).toString('utf8');
    }

    const rendererOptions = {};
    if (values.width !== undefined)            rendererOptions.width          = num(values.width);
    if (values['width-mm'] !== undefined)      rendererOptions.widthMm        = num(values['width-mm']);
    if (values.dpi !== undefined)              rendererOptions.dpi             = num(values.dpi);
    if (values['staff-space-mm'] !== undefined) rendererOptions.staffSpaceMm  = num(values['staff-space-mm']);
    if (values['lyric-size'] !== undefined)    rendererOptions.lyricSize       = num(values['lyric-size']);
    if (values['lyric-font'] !== undefined)    rendererOptions.lyricFont       = values['lyric-font'];
    if (values['note-spacing'] !== undefined)  rendererOptions.noteSpacing     = num(values['note-spacing']);
    if (values.zoom !== undefined)             rendererOptions.zoom            = num(values.zoom);
    if (values['hide-repeat-clef'])            rendererOptions.hideRepeatClef  = true;

    if (values['font-file']) {
        rendererOptions.measureText = await createFontkitMeasureFn(values['font-file']);
    }

    const svg = renderAretino(source, rendererOptions);

    if (values.output) {
        writeFileSync(values.output, svg, 'utf8');
    } else {
        process.stdout.write(svg + '\n');
    }
}

main().catch(err => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
});
