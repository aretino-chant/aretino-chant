#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { parseAretino, parseHeaderRendererOptions, renderAretino } from '@aretino-chant/core';
import { createFontkitMeasureFn } from '../src/measure-fontkit.js';
import { resolveSystemFontForFontkit } from '../src/system-fonts.js';

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
  --text-font <family>      CSS font-family string for rendered text; on Linux this is
                            also resolved via fontconfig for measurement
  --note-spacing <n>        Note spacing multiplier (default: 1)
  --zoom <n>                Output magnification (default: 1)
  --font-file <path>        Explicit upright font for text measurement
                            (variable or static; overrides auto-resolution)
  --font-italic <path>      Italic font (variable or static; derives bold-italic via wght)
  --font-bold <path>        Bold font (static override; derived from --font-file if variable)
  --font-bold-italic <path> Bold-italic font (static override; derived from --font-italic if variable)
  --hide-repeat-clef        Don't repeat clef at the start of continuation lines
  --source-map              Include source-map/highlight hooks for interactive SVG previews
  --per-line                Write one SVG per staff line; requires --output (writes base-001.svg, base-002.svg, …)
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
        'text-font':      { type: 'string' },
        'note-spacing':   { type: 'string' },
        zoom:             { type: 'string' },
        'font-file':        { type: 'string' },
        'font-italic':      { type: 'string' },
        'font-bold':        { type: 'string' },
        'font-bold-italic': { type: 'string' },
        'hide-repeat-clef': { type: 'boolean' },
        'source-map':       { type: 'boolean' },
        'per-line':         { type: 'boolean' },
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

function expandHomePath(filePath) {
    if (typeof filePath !== 'string') return filePath;
    if (filePath === '~') return homedir();
    if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
        return path.join(homedir(), filePath.slice(2));
    }
    return filePath;
}

function fontInputFromArgs(values) {
    if (!values['font-file']) return null;
    const hasExtras = values['font-italic'] || values['font-bold'] || values['font-bold-italic'];
    return hasExtras
        ? {
            regular:    expandHomePath(values['font-file']),
            italic:     expandHomePath(values['font-italic']),
            bold:       expandHomePath(values['font-bold']),
            boldItalic: expandHomePath(values['font-bold-italic']),
        }
        : expandHomePath(values['font-file']);
}

async function tryCreateAutoMeasureFn(fontFamily) {
    const fontInput = await resolveSystemFontForFontkit(fontFamily);
    if (!fontInput) return null;

    try {
        return await createFontkitMeasureFn(fontInput);
    } catch (err) {
        process.stderr.write(`Warning: could not measure with system font "${fontFamily}": ${err.message}\n`);
        return null;
    }
}

function splitIntoLines(svg) {
    const svgTagMatch = svg.match(/^<svg([^>]*)>/);
    if (!svgTagMatch) return null;
    const attrs = svgTagMatch[1];
    const viewBoxMatch = attrs.match(/viewBox="0 0 ([\d.]+) [\d.]+"/);
    if (!viewBoxMatch) return null;
    const totalW = parseFloat(viewBoxMatch[1]);
    const widthAttrMatch = attrs.match(/\bwidth="(\d+)"/);
    const zoom = widthAttrMatch ? parseInt(widthAttrMatch[1]) / totalW : 1;

    const inner = svg.slice(svgTagMatch[0].length, svg.lastIndexOf('</svg>'));

    const rowRe = /<!--\s*aretino-row\s+\d+\s+([\d.]+)\s*-->/g;
    const markers = [];
    let m;
    while ((m = rowRe.exec(inner)) !== null) {
        markers.push({ y: parseFloat(m[1]), markerStart: m.index, contentStart: m.index + m[0].length });
    }
    if (markers.length === 0) return null;

    const endMatch = inner.match(/<!--\s*aretino-rows-end\s+([\d.]+)\s*-->/);
    const totalH = endMatch ? parseFloat(endMatch[1]) : 0;
    const innerEnd = endMatch ? endMatch.index : inner.length;

    const preamble = inner.slice(0, markers[0].markerStart);

    return markers.map((marker, i) => {
        const nextY = i + 1 < markers.length ? markers[i + 1].y : totalH;
        const rowH = parseFloat((nextY - marker.y).toFixed(3));
        const contentEnd = i + 1 < markers.length ? markers[i + 1].markerStart : innerEnd;
        const content = inner.slice(marker.contentStart, contentEnd);
        const renderW = Math.round(totalW * zoom);
        const renderH = Math.round(rowH * zoom);
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${rowH}" width="${renderW}" height="${renderH}" preserveAspectRatio="xMidYMin meet" style="display:block">${preamble}<g transform="translate(0,${-marker.y})">${content}</g></svg>`;
    });
}

async function main() {
    let source;
    if (positionals.length > 0) {
        source = readFileSync(expandHomePath(positionals[0]), 'utf8');
    } else {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        source = Buffer.concat(chunks).toString('utf8');
    }

    const ast = parseAretino(source);
    const headerOptions = parseHeaderRendererOptions(ast);
    const rendererOptions = {};
    if (values.width !== undefined)            rendererOptions.width          = num(values.width);
    if (values['width-mm'] !== undefined)      rendererOptions.widthMm        = num(values['width-mm']);
    if (values.dpi !== undefined)              rendererOptions.dpi             = num(values.dpi);
    if (values['staff-space-mm'] !== undefined) rendererOptions.staffSpaceMm  = num(values['staff-space-mm']);
    if (values['lyric-size'] !== undefined)    rendererOptions.lyricSize       = num(values['lyric-size']);
    if (values['text-font'] !== undefined)     rendererOptions.textFont       = values['text-font'];
    if (values['note-spacing'] !== undefined)  rendererOptions.noteSpacing     = num(values['note-spacing']);
    if (values.zoom !== undefined)             rendererOptions.zoom            = num(values.zoom);
    if (values['hide-repeat-clef'])            rendererOptions.hideRepeatClef  = true;
    rendererOptions.sourceMap = !!values['source-map'];

    const fontInput = fontInputFromArgs(values);
    if (fontInput) {
        rendererOptions.measureText = await createFontkitMeasureFn(fontInput);
    } else {
        const effectiveTextFont = rendererOptions.textFont ?? headerOptions.textFont;
        const measureText = await tryCreateAutoMeasureFn(effectiveTextFont);
        if (measureText) rendererOptions.measureText = measureText;
    }

    const svg = renderAretino(ast, rendererOptions);

    if (values['per-line']) {
        if (!values.output) {
            process.stderr.write('--per-line requires --output\n');
            process.exit(1);
        }
        const lines = splitIntoLines(svg);
        if (!lines) {
            process.stderr.write('No row metadata found in SVG output.\n');
            process.exit(1);
        }
        const outPath = expandHomePath(values.output);
        const ext = path.extname(outPath);
        const base = outPath.slice(0, outPath.length - ext.length);
        for (let i = 0; i < lines.length; i++) {
            writeFileSync(`${base}-${String(i + 1).padStart(3, '0')}${ext}`, lines[i], 'utf8');
        }
    } else if (values.output) {
        writeFileSync(expandHomePath(values.output), svg, 'utf8');
    } else {
        process.stdout.write(svg + '\n');
    }
}

main().catch(err => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
});
