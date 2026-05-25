/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// GABC letters a-g map to Aretino a-g (lower octave),
// GABC letters h-m map to Aretino A-F (upper octave).
const NOTE_MAP = {
    a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f', g: 'g',
    h: 'A', i: 'B', j: 'C', k: 'D', l: 'E', m: 'F',
};

export function gabcToAretino(gabc) {
    const notes = [];
    for (const match of gabc.matchAll(/\(([a-m]+)\)/g)) {
        for (const ch of match[1]) {
            const mapped = NOTE_MAP[ch];
            if (mapped !== undefined) notes.push(mapped);
        }
    }
    if (notes.length === 0) return '';
    return '(g2) ' + notes.join(' ');
}
