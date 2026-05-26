/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// GABC letters a-m (index 0–12) map to Aretino pitches at the same index with
// zero transposition.  Different clefs shift this mapping by a fixed offset.
const ARETINO_NOTES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'A', 'B', 'C', 'D', 'E', 'F'];
const GABC_LOWER   = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'];

// Transposition (in scale steps) and optional key signature for each GABC clef.
// (c4) = 0 transposition, which is the reference.
const CLEF_SETTINGS = {
    c4:  { transpose: 0,  keySig: null },
    c1:  { transpose: -1, keySig: null },
    c2:  { transpose: 4,  keySig: null },
    c3:  { transpose: 2,  keySig: null },
    f3:  { transpose: -2, keySig: null },
    f4:  { transpose: 3,  keySig: null },
    cb3: { transpose: 2,  keySig: 'b' },
    cb4: { transpose: 0,  keySig: 'b' },
};

function buildNoteMap(transpose) {
    const map = {};
    for (let i = 0; i < GABC_LOWER.length; i++) {
        const pos = i + transpose;
        if (pos >= 0 && pos < ARETINO_NOTES.length) map[GABC_LOWER[i]] = ARETINO_NOTES[pos];
    }
    return map;
}

// GABC alteration suffixes: x = flat, y = natural, # = sharp.
const GABC_ALTER_SIGN = { x: 'b', y: 'n', '#': '#' };

// GABC rhythmic accent suffixes r1–r5 → Aretino quoted accent characters.
const GABC_ACCENT_SIGN = { r1: '´', r2: '`', r3: '○', r4: 'ᴖ', r5: 'ᴗ' };

function convertAlteration(content, noteMap) {
    const m = content.match(/^([a-mA-M])([xy#])$/);
    if (!m) return null;
    const base = noteMap[m[1].toLowerCase()];
    if (base === undefined) return null;
    return '(' + base + GABC_ALTER_SIGN[m[2]] + ')';
}

// Matches a single gabc note token: optional - prefix (initio debilis), a note letter
// (upper or lower) plus optional suffix.
// Suffixes: o (apostropha), o~ o< (variants), s (stropha), s< (variant),
//           ~ (liquescent/oriscus), > or >. (oriscus, with optional mora), < (augmentum),
//           w/W (quilisma / quilisma+virga), . (mora), v/V (virga), '/`'0/`'1 (ictus),
//           _/_0/_1 (episema).
const GABC_NOTE_RE = /-?[a-mA-M](?:O[01]?|o[~<01]?|s<?|[rR]\d?|<r?|>\.?|[~wW.]|[vV]\.?|'[01]?|_\d?|[01])?/g;

// Matches a note token OR an intra-neume separator within a segment.
// Separators: // (double gap), /[N] (bracketed offset), /0 (near-zero), /, !, @.
const SEGMENT_TOKEN_RE = /-?[a-mA-M](?:O[01]?|o[~<01]?|s<?|[rR]\d?|<r?|>\.?|[~wW.]|[vV]\.?|'[01]?|_\d?|[01]|[xy#])?|\/\/|\/\[(-?\d+)\]|\/\d|\/|[!@]/g;

function convertNeumeToken(token, noteMap) {
    const isSmall = token[0] === '-';
    const idx = isSmall ? 1 : 0;
    const letter = token[idx].toLowerCase();
    const base = noteMap[letter];
    if (base === undefined) return null;
    const suffix = token.slice(idx + 1);
    if (isSmall && suffix === '') return base + 's';                // initio debilis → small notehead
    if (suffix === 'w') return base + 'w';                          // quilisma
    if (suffix === 'W') return base + "w'";                         // quilisma with virga
    if (suffix === '~') return base + 's';                          // liquescent → small notehead
    if (suffix === '>.') return base + '.';                         // oriscus with mora → mora only
    if (suffix === 'v.' || suffix === 'V.') return base + "'.";                  // virga with mora
    if (suffix === 'O' || suffix === 'O1' || suffix === 'v' || suffix === 'V') return base + "'"; // virga
    if (suffix in GABC_ACCENT_SIGN) return base + '"' + GABC_ACCENT_SIGN[suffix] + '"'; // rhythmic accent
    if (suffix === '<r' || /^[rR]\d?$/.test(suffix)) return base + 't'; // tenor (empty notehead)
    if (suffix === '.') return base + '.';                          // mora
    if (suffix === "'" || suffix === "'0" || suffix === "'1") return base + '-'; // ictus
    if (suffix === '_' || suffix.startsWith('_')) return base + '_';             // episema
    if (suffix === 'x' || suffix === 'y' || suffix === '#') return '(' + base + GABC_ALTER_SIGN[suffix] + ')'; // intra-neume accidental sign
    return base;
}

// Expand repeated strophae/virga: gss→gsgs, gsss→gsgsgs, gvv→gvgv, gvvv→gvgvgv
function expandRepeatedSuffixes(segment) {
    return segment.replace(/([a-mA-M])(s|v|V)(\2+)/g, (_, note, suffix, extra) => {
        return (note + suffix).repeat(1 + extra.length);
    });
}

// Redistribute trailing repeated mora (.) or episema (_) onto the last N notes.
// e.g., gh.. → g.h.   gh__ → g_h_
function redistributeTrailingSuffixes(segment) {
    for (const [char, re] of [['.', /\.+$/], ['_', /_+$/]]) {
        const tm = segment.match(re);
        if (!tm) continue;
        const n = tm[0].length;
        const base = segment.slice(0, segment.length - n);
        const noteMatches = [...base.matchAll(GABC_NOTE_RE)];
        if (noteMatches.length === 0) continue;
        const count = Math.min(n, noteMatches.length);
        let result = base;
        for (let i = count - 1; i >= 0; i--) {
            const m = noteMatches[noteMatches.length - count + i];
            const pos = m.index + m[0].length;
            result = result.slice(0, pos) + char + result.slice(pos);
        }
        segment = result;
    }
    return segment;
}

const BARLINE_MAP = {
    '':   '|0',
    '`':  "'",
    ',':  ',',
    "'":  "'",
    ';':  ';',
    ':':  '|',
    ':?': '|?',
    '::': '||',
    ',1': ';',
    ',2': ';',
    ',3': ';',
    ',4': ';',
    ',5': ';',
    ',6': ';',
    ";'": ';',
    ',_': ',',
    ',0': ',',
};

function convertSeparator(sep, bracketNum) {
    if (sep === '//') return '//';
    if (bracketNum !== undefined) return parseInt(bracketNum, 10) >= 2 ? '//' : '/';
    if (sep === '!') return '`';
    return '/';
}

function gabcBody(gabc) {
    const sepIdx = gabc.indexOf('%%');
    return sepIdx !== -1 ? gabc.slice(sepIdx + 2) : gabc;
}

function parseGabcAnnotations(gabc) {
    const sepIdx = gabc.indexOf('%%');
    if (sepIdx === -1) return [];
    const header = gabc.slice(0, sepIdx);
    const annotations = [];
    for (const line of header.split('\n')) {
        const m = line.match(/^annotation:\s*(.*?)\s*;?\s*$/);
        if (m && m[1]) annotations.push(m[1]);
    }
    return annotations;
}

const SP_MAP = { 'R/': '\\R', 'V/': '\\V', 'A/': 'A' , "'ae": 'ǽ'};

function convertLyricText(text) {
    text = text.replace(/<sp>([^<]*)<\/sp>/g, (_, sym) => SP_MAP[sym] ?? sym);
    text = text.replace(/<b>(.*?)<\/b>/g, '{$1}');
    text = text.replace(/<i>(.*?)<\/i>/g, '<$1>');
    text = text.replace(/<ul>(.*?)<\/ul>/g, '[$1]');
    text = text.replace(/<sc>(.*?)<\/sc>/g, (_, s) => '\\sc{' + s.toLowerCase() + '}');
    text = text.replace(/<tt>(.*?)<\/tt>/g, '\\mono{$1}');
    text = text.replace(/<c>(.*?)<\/c>/g, '\\red{$1}');
    text = text.replace(/<clear>/g, '');
    return text;
}

// Extract lyric words from GABC body. Each space-separated token is a word;
// within a token, text before each (...) group is a syllable. {braces} are stripped.
// A note-bearing neume with no lyric extends the previous syllable; each such extension
// adds a hyphen, so a syllable sung on N neumes is joined to the next with N hyphens.
// Trailing text after a token's last (...) is carried forward as hanging text, and the
// token's syllables are held as pendingSyllables so the word can be completed by the
// next neume-bearing token.
//
// Hanging text (space-separated tokens with no parens) joins to the next element with ~:
//   - before a lyric note:       hangingParts~lyric   (e.g. *~De)
//   - before a standalone neume: hangingParts~~        (e.g. *~De~~)
//   - standalone neume alone:    ~  (new word)
function joinSyllables(syllables) {
    let result = '';
    for (let i = 0; i < syllables.length; i++) {
        result += syllables[i].text;
        if (i < syllables.length - 1) result += '-'.repeat(syllables[i].count);
    }
    return result;
}

function extractLyricWords(body) {
    const normalized = body.replace(/\(([^)]*)\)/g, (_, inner) => '(' + inner.replace(/\s+/g, '') + ')');
    const words = [];
    let hangingParts = []; // text tokens before a standalone neume, spaces become ~
    let pendingSyllables = null; // syllables carried forward when a token has trailing text
    for (const token of normalized.trim().split(/\s+/)) {
        // Hanging text: token with no notation parens — accumulate for the next neume
        if (!token.includes('(')) {
            const text = convertLyricText(token.replace(/~/g, '').replace(/[{}]/g, ''));
            if (text) hangingParts.push(text);
            continue;
        }
        const syllables = pendingSyllables ?? []; // [{text: string, count: number}]
        pendingSyllables = null;
        let pos = 0;
        while (pos < token.length) {
            const openParen = token.indexOf('(', pos);
            if (openParen === -1) break;
            const lyricText = convertLyricText(token.slice(pos, openParen).replace(/[{}]/g, ''));
            const closeParen = token.indexOf(')', openParen);
            if (closeParen === -1) break;
            const notation = token.slice(openParen + 1, closeParen).trim();
            pos = closeParen + 1;
            if (/^[cfg]b?\d$/.test(notation)) continue; // skip clefs
            if (BARLINE_MAP[notation] !== undefined) {
                // Non-empty text before a barline: flush current word, push text as hanging element
                if (lyricText.trim()) {
                    if (syllables.some(s => /[a-zA-ZÀ-ÿ*]/.test(s.text))) {
                        words.push(joinSyllables(syllables));
                        syllables.length = 0;
                    }
                    words.push('(' + lyricText.trim() + ')');
                }
                hangingParts = [];
                continue;
            }
            // Note-bearing neume: start a new syllable or extend the current one
            if (lyricText) {
                const combined = hangingParts.length > 0
                    ? hangingParts.join('~') + '~~' + lyricText
                    : lyricText;
                syllables.push({ text: combined, count: 1 });
                hangingParts = [];
            } else if (syllables.length > 0) {
                syllables[syllables.length - 1].count++;
            } else if (hangingParts.length > 0) {
                // Standalone neume with no lyric preceded by hanging text — use it as lyric
                syllables.push({ text: hangingParts.join('~') + '~~', count: 1 });
                hangingParts = [];
            } else {
                // Standalone neume with no context — melismatic extension of previous word
                syllables.push({ text: '~', count: 1 });
            }
        }
        // Trailing text after the last ): add to hangingParts and carry syllables forward
        if (pos < token.length) {
            const trailingText = convertLyricText(token.slice(pos).replace(/[{}]/g, ''));
            if (trailingText) {
                hangingParts.push(trailingText);
                if (syllables.length > 0) {
                    pendingSyllables = syllables;
                    continue;
                }
            }
        }
        if (syllables.some(s => /[a-zA-ZÀ-ÿ*]/.test(s.text) || s.text === '~')) {
            words.push(joinSyllables(syllables));
        }
    }
    if (pendingSyllables && pendingSyllables.some(s => /[a-zA-ZÀ-ÿ*]/.test(s.text) || s.text === '~')) {
        words.push(joinSyllables(pendingSyllables));
    }
    return words;
}

function extractClef(body) {
    for (const match of body.matchAll(/\(([^)]*)\)/g)) {
        const content = match[1].trim();
        if (/^[cfg]b?\d$/.test(content)) return content;
    }
    return 'c4';
}

export function gabcToAretino(gabc) {
    const annotations = parseGabcAnnotations(gabc);
    const body = gabcBody(gabc);
    const clef = extractClef(body);
    const { transpose, keySig } = CLEF_SETTINGS[clef] ?? CLEF_SETTINGS.c4;
    const noteMap = buildNoteMap(transpose);

    const neumes = [];
    for (const match of body.matchAll(/\(([^)]*)\)/g)) {
        const content = match[1];
        if (/^[cfg]b?\d$/.test(content.trim())) continue; // skip clefs (e.g. c4, f3, cb3)
        const bar = BARLINE_MAP[content.trim()];
        if (bar !== undefined) { neumes.push(bar); continue; }
        const alt = convertAlteration(content.trim(), noteMap);
        if (alt !== null) { neumes.push(alt); continue; }
        const neumeSegments = [];
        for (const segment of content.replace(/\[[^\]]*\]/g, '').split(/\s+/)) {
            const parts = [];
            let pendingSep = null;
            let suppressVirga = false;
            for (const tokenMatch of expandRepeatedSuffixes(redistributeTrailingSuffixes(segment)).matchAll(SEGMENT_TOKEN_RE)) {
                const tok = tokenMatch[0];
                if (tok === '@' && parts.length === 0) {
                    suppressVirga = true;
                    continue;
                }
                if (/^-?[a-mA-M]/.test(tok)) {
                    let note = convertNeumeToken(tok, noteMap);
                    if (note !== null) {
                        if (pendingSep !== null) parts.push(pendingSep);
                        if (suppressVirga) note = note + '`';
                        parts.push(note);
                        pendingSep = null;
                    }
                } else {
                    if (parts.length > 0) pendingSep = convertSeparator(tok, tokenMatch[1]);
                }
            }
            if (parts.length > 0) neumeSegments.push(parts.join(''));
        }
        if (neumeSegments.length > 0) neumes.push(neumeSegments.join('//'))
    }
    if (neumes.length === 0) return '';

    const keySigToken = keySig ? `(K:${keySig}) ` : '';
    let result = `(g2) ${keySigToken}` + neumes.join(' ');
    if (annotations.length > 0) result = `%indent: ${annotations.join(' | ')}\n` + result;
    const lyricWords = extractLyricWords(body);
    if (lyricWords.length > 0) result += '\nw: ' + lyricWords.join(' ');
    return result;
}
