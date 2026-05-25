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

function gabcBody(gabc) {
    const sepIdx = gabc.indexOf('%%');
    return sepIdx !== -1 ? gabc.slice(sepIdx + 2) : gabc;
}

// Extract lyric words from GABC body. Each space-separated token is a word;
// within a token, text before each (...) group is a syllable. {braces} are stripped.
function extractLyricWords(body) {
    const words = [];
    for (const token of body.trim().split(/\s+/)) {
        const syllables = [];
        let pos = 0;
        while (pos < token.length) {
            const openParen = token.indexOf('(', pos);
            if (openParen === -1) {
                const trailing = token.slice(pos).replace(/[{}]/g, '');
                if (trailing) syllables.push(trailing);
                break;
            }
            syllables.push(token.slice(pos, openParen).replace(/[{}]/g, ''));
            const closeParen = token.indexOf(')', openParen);
            if (closeParen === -1) break;
            pos = closeParen + 1;
        }
        // Remove trailing empty syllables (melismas after last lyric syllable)
        while (syllables.length > 0 && syllables[syllables.length - 1] === '') {
            syllables.pop();
        }
        // Skip tokens that contain no alphabetic text (clefs, barlines, GABC markers)
        if (syllables.some(s => /[a-zA-ZÀ-ÿ]/.test(s))) {
            words.push(syllables.join('-'));
        }
    }
    return words;
}

export function gabcToAretino(gabc) {
    const body = gabcBody(gabc);
    const neumes = [];
    for (const match of body.matchAll(/\(([^)]*)\)/g)) {
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

    let result = '(g2) ' + neumes.join(' ');
    const lyricWords = extractLyricWords(body);
    if (lyricWords.length > 0) result += '\nw: ' + lyricWords.join(' ');
    return result;
}
