/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// GABC letters a-g map to Aretino a-g (lower octave),
// GABC letters h-m map to Aretino A-F (upper octave).
// Uppercase GABC letters are virga and map to the same Aretino note as lowercase.
const NOTE_MAP = {
    a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f', g: 'g',
    h: 'A', i: 'B', j: 'C', k: 'D', l: 'E', m: 'F',
};

// Matches a single gabc note token: a note letter (upper or lower) plus optional suffix.
// Suffixes: o (apostropha), o~ o< (variants), s (stropha), s< (variant),
//           ~ (liquescent/oriscus), > (oriscus), < (augmentum), w (quilisma).
const GABC_NOTE_RE = /[a-mA-M](?:o[~<]?|s<?|[~><w])?/g;

function convertNeumeToken(token) {
    const letter = token[0].toLowerCase();
    const base = NOTE_MAP[letter];
    if (base === undefined) return null;
    const isLowercase = token[0] >= 'a';
    const suffix = token.slice(1);
    if (suffix === 'w') return base + 'w';           // quilisma
    if (isLowercase && suffix === '~') return base + 's'; // liquescent → small notehead
    return base;
}

export function gabcToAretino(gabc) {
    const neumes = [];
    for (const match of gabc.matchAll(/\(([^)]*)\)/g)) {
        const content = match[1];
        if (/\d/.test(content)) continue; // skip clefs (e.g. c4, f3)
        for (const segment of content.split(/\s+/)) {
            const notes = [];
            for (const tokenMatch of segment.matchAll(GABC_NOTE_RE)) {
                const note = convertNeumeToken(tokenMatch[0]);
                if (note !== null) notes.push(note);
            }
            if (notes.length > 0) neumes.push(notes.join(''));
        }
    }
    if (neumes.length === 0) return '';
    return '(g2) ' + neumes.join(' ');
}
