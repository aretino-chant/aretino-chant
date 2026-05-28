/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const FC_MATCH_FORMAT = '%{file}\n';
const FC_MATCH_TIMEOUT_MS = 2000;

export async function resolveSystemFontForFontkit(fontFamily, platform = process.platform) {
    if (platform !== 'linux') return null;

    const pattern = fontconfigPatternFromCssFontFamily(fontFamily);
    if (!pattern) return null;

    const resolved = Object.fromEntries(await Promise.all([
        ['regular', 'Regular'],
        ['italic', 'Italic'],
        ['bold', 'Bold'],
        ['boldItalic', 'Bold Italic'],
    ].map(async ([key, style]) => [key, await fcMatchFile(pattern, style)])));

    if (!resolved.regular) return null;
    return compactResolvedFontPaths(resolved);
}

export function fontconfigPatternFromCssFontFamily(fontFamily) {
    return splitCssFontFamilies(fontFamily)
        .map(unquoteCssString)
        .filter(Boolean)
        .join(',');
}

export function compactResolvedFontPaths({ regular, italic, bold, boldItalic }) {
    if (!regular) return null;

    if ([italic, bold, boldItalic].every(path => !path || path === regular)) {
        return regular;
    }

    return {
        regular,
        ...(italic && italic !== regular ? { italic } : {}),
        ...(bold && bold !== regular ? { bold } : {}),
        ...(boldItalic && boldItalic !== (italic || regular) ? { boldItalic } : {}),
    };
}

async function fcMatchFile(pattern, style) {
    try {
        const { stdout } = await execFileAsync(
            'fc-match',
            ['-f', FC_MATCH_FORMAT, `${pattern}:style=${style}`],
            { timeout: FC_MATCH_TIMEOUT_MS, windowsHide: true }
        );
        const file = stdout.split(/\r?\n/, 1)[0]?.trim();
        if (!file) return null;
        await access(file);
        return file;
    } catch {
        return null;
    }
}

function splitCssFontFamilies(fontFamily) {
    const input = String(fontFamily ?? '').trim();
    if (!input) return [];

    const families = [];
    let current = '';
    let quote = null;
    let escaped = false;

    for (const ch of input) {
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            current += ch;
            escaped = true;
            continue;
        }
        if (quote) {
            current += ch;
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            current += ch;
            quote = ch;
            continue;
        }
        if (ch === ',') {
            families.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }

    if (current.trim()) families.push(current.trim());
    return families;
}

function unquoteCssString(value) {
    const text = String(value ?? '').trim();
    if (text.length >= 2) {
        const quote = text[0];
        if ((quote === '"' || quote === "'") && text[text.length - 1] === quote) {
            return text.slice(1, -1).replace(/\\(["'\\])/g, '$1').trim();
        }
    }
    return text;
}
