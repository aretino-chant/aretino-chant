/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Aretino source → AST.
//
// Returns:
// {
//     header: { [key: string]: string },
//     lines: Array<
//         | { type: 'music', tokens: Token[] }
//         | { type: 'lyrics', text: string }
//         | { type: 'blank' }
//     >
// }
//
// Token shapes:
//   { type: 'directive', value: string }              — anything inside ( )
//   { type: 'barline', kind: ',' | ';' | '|' | '||' | ':|' | '|||' | "'" }
//   { type: 'expander' }                              — `*`
//   { type: 'ligature', groups: Note[][] }            — one or more note groups; groups are separated by '/' cuts within the neume
//
// Note shape:
//   {
//       pitch: 'a'..'n',
//       virga: boolean,                  — uppercase letter
//       high: boolean,                   — trailing apostrophe (octave up)
//       shape: 'punctum' | 'virga' | 'quilisma' | 'tenor',
//       modifiers: Array<'episema'|'mora'|'liquescens'|'ictus'>,
//   }

export function parseAretino(source) {
    const src = source ?? '';
    const lines = src.replace(/\r\n/g, '\n').split('\n');
    // Absolute source offset of the first character of each line. Used to
    // translate per-line token positions into absolute positions that match
    // the textarea's selectionStart.
    const lineStarts = [];
    let off = 0;
    for (const line of lines) {
        lineStarts.push(off);
        off += line.length + 1;
    }
    const header = {};
    let bodyStart = 0;
    let sawHeaderEnd = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^%%\s*$/.test(line)) {
            bodyStart = i + 1;
            sawHeaderEnd = true;
            break;
        }
        const m = line.match(/^%\s*([^:]+):\s*(.*)$/);
        if (m) {
            header[m[1].trim()] = m[2].trim();
            continue;
        }
        if (line.trim() === '') {
            continue;
        }
        bodyStart = i;
        break;
    }
    if (!sawHeaderEnd && Object.keys(header).length === 0) {
        bodyStart = 0;
    }
    const result = [];
    let lastWasLyrics = false;
    for (let li = bodyStart; li < lines.length; li++) {
        const raw = lines[li];
        const lineStart = lineStarts[li];
        if (raw.trim() === '') {
            result.push({ type: 'blank' });
            lastWasLyrics = false;
            continue;
        }
        if (/^\s*W:/.test(raw)) {
            result.push({ type: 'verse', lines: [raw.replace(/^\s*W:\s?/, '')] });
            lastWasLyrics = false;
            continue;
        }
        if (/^\s*w:/.test(raw)) {
            result.push({ type: 'lyrics', text: raw.replace(/^\s*w:\s?/, '') });
            lastWasLyrics = true;
            continue;
        }
        if (lastWasLyrics) {
            // A line without w: prefix that follows a lyrics line continues the
            // same lyric line (same verse) — e.g. a linebreak added mid-lyric.
            const last = result[result.length - 1];
            if (last && last.type === 'lyrics') {
                last.text += ' ' + raw.trim();
            }
            continue;
        }
        // A non-prefixed line that follows a W: verse line continues that verse
        // as an explicit line break (rendered indented).
        const lastItem = result[result.length - 1];
        if (lastItem && lastItem.type === 'verse') {
            lastItem.lines.push(raw.trim());
            continue;
        }
        result.push({ type: 'music', tokens: tokenizeMusicLine(raw, lineStart) });
    }
    return { header, lines: result };
}

function isPitchLetter(c) {
    return /[a-nA-N]/.test(c);
}

// Maps each accepted accidental token to the internal symbol used downstream
// ('x' flat, 'y' natural, '#' sharp): b = flat, n = natural, # = sharp.
const ACCIDENTAL_TOKENS = { b: 'x', n: 'y', '#': '#' };

// Parses an accidental directive's inner text: an optional target pitch letter
// followed by one accidental token. Returns { pitch, symbol } (symbol is the
// internal 'x'/'y'/'#'), or null if it isn't an accidental. When the pitch is
// omitted it defaults to `defaultPitch` (the staff's reciting position).
export function matchAccidental(inner, defaultPitch = 'i') {
    const m = inner.match(/^([a-nA-N]?)([bn#])$/);
    if (!m) {
        return null;
    }
    return { pitch: (m[1] || defaultPitch).toLowerCase(), symbol: ACCIDENTAL_TOKENS[m[2]] };
}

// Peek at position `pos` (which should be '(') to see if the parenthesized
// content is an accidental pattern like (ib), (n), (c#), etc.
// Returns { pitch, symbol, end } where `end` is the index past ')' if it
// matches, or null if it doesn't.
function peekInlineAccidental(line, pos) {
    if (line[pos] !== '(') {
        return null;
    }
    const end = line.indexOf(')', pos);
    if (end < 0) {
        return null;
    }
    const acc = matchAccidental(line.slice(pos + 1, end).trim());
    if (!acc) {
        return null;
    }
    return { pitch: acc.pitch, symbol: acc.symbol, end: end + 1 };
}

// Parses a sequence of note groups separated by '/' within line[i..limit).
// Returns { groups, gaps, newI }. Used by both plain-ligature and [..] paths.
function parseNoteGroupSequence(line, i, lineStart, limit) {
    const groups = [];
    const gaps = [];
    while (true) {
        const group = [];
        let pendingAcc = null;
        while (i < limit && (isPitchLetter(line[i]) || (line[i] === '(' && peekInlineAccidental(line, i) !== null))) {
            if (line[i] === '(') {
                pendingAcc = peekInlineAccidental(line, i);
                i = pendingAcc.end;
                continue;
            }
            const noteStart = i;
            const pitchChar = line[i];
            i++;
            const note = {
                pitch: pitchChar.toLowerCase(),
                virga: pitchChar !== pitchChar.toLowerCase(),
                high: false,
                shape: pitchChar === pitchChar.toLowerCase() ? 'punctum' : 'virga',
                modifiers: [],
            };
            if (pendingAcc) {
                note.accidental = { pitch: pendingAcc.pitch, symbol: pendingAcc.symbol };
                pendingAcc = null;
            }
            while (i < limit) {
                const m = line[i];
                if (m === "'") { note.high = true; i++; continue; }
                if (m === '_') { note.modifiers.push('episema'); i++; continue; }
                if (m === '-') { note.modifiers.push('ictus'); i++; continue; }
                if (m === '.') { note.modifiers.push('mora'); i++; continue; }
                if (m === '~') { note.modifiers.push('liquescens'); i++; continue; }
                if (m === 'w') { note.shape = 'quilisma'; i++; continue; }
                if (m === 't') { note.shape = 'tenor'; i++; continue; }
                if (m === 's') { note.modifiers.push('small'); i++; continue; }
                break;
            }
            note.srcStart = lineStart + noteStart;
            note.srcEnd = lineStart + i;
            group.push(note);
        }
        if (group.length) groups.push(group);
        let j = i;
        while (j < limit && (line[j] === ' ' || line[j] === '\t')) j++;
        if (j < limit && line[j] === '/') {
            let slashCount = 0;
            let k = j;
            while (k < limit && line[k] === '/') { slashCount++; k++; }
            while (k < limit && (line[k] === ' ' || line[k] === '\t')) k++;
            if (k < limit && (isPitchLetter(line[k]) || (line[k] === '(' && peekInlineAccidental(line, k) !== null))) {
                i = k;
                gaps.push(slashCount);
                continue;
            }
        }
        break;
    }
    return { groups, gaps, newI: i };
}

function tokenizeMusicLine(line, lineStart = 0) {
    const tokens = [];
    const len = line.length;
    let i = 0;
    while (i < len) {
        const ch = line[i];
        if (ch === ' ' || ch === '\t') {
            i++;
            continue;
        }
        const tokStart = i;
        if (ch === '(') {
            const end = line.indexOf(')', i);
            const value = end < 0 ? line.slice(i + 1) : line.slice(i + 1, end);
            i = end < 0 ? len : end + 1;
            const inner = value.trim();
            const srcStart = lineStart + tokStart;
            const srcEnd = lineStart + i;
            const bareBar = inner.match(/^([,;']|:\|:|:\||\|:|\|{1,3})$/);
            if (bareBar) {
                tokens.push({ type: 'barline', kind: bareBar[1], srcStart, srcEnd });
            } else if (/^sp([0-9]*\.?[0-9]*)$/i.test(inner)) {
                const m2 = inner.match(/^sp([0-9]*\.?[0-9]*)$/i);
                const multiplier = m2[1] ? parseFloat(m2[1]) : 1;
                tokens.push({ type: 'spacer', multiplier: isFinite(multiplier) && multiplier > 0 ? multiplier : 1, srcStart, srcEnd });
            } else {
                tokens.push({ type: 'directive', value: inner, srcStart, srcEnd });
            }
            continue;
        }
        if (ch === '*') {
            tokens.push({ type: 'expander', srcStart: lineStart + tokStart, srcEnd: lineStart + tokStart + 1 });
            i++;
            continue;
        }
        if (ch === '=') {
            let count = 0;
            while (i < len && line[i] === '=') { count++; i++; }
            tokens.push({ type: 'spacer', multiplier: count, srcStart: lineStart + tokStart, srcEnd: lineStart + tokStart + count });
            continue;
        }
        if (ch === ':' && line[i + 1] === '|') {
            if (line[i + 2] === ':') {
                tokens.push({ type: 'barline', kind: ':|:', srcStart: lineStart + tokStart, srcEnd: lineStart + tokStart + 3 });
                i += 3;
            } else {
                tokens.push({ type: 'barline', kind: ':|', srcStart: lineStart + tokStart, srcEnd: lineStart + tokStart + 2 });
                i += 2;
            }
            continue;
        }
        if (ch === '|') {
            let count = 1;
            while (i + count < len && line[i + count] === '|') { count++; }
            if (count === 1 && line[i + 1] === ':') {
                tokens.push({ type: 'barline', kind: '|:', srcStart: lineStart + tokStart, srcEnd: lineStart + tokStart + 2 });
                i += 2;
            } else {
                const kind = '|'.repeat(Math.min(count, 3));
                tokens.push({ type: 'barline', kind, srcStart: lineStart + tokStart, srcEnd: lineStart + tokStart + count });
                i += count;
            }
            continue;
        }
        if (ch === ',' || ch === ';') {
            tokens.push({ type: 'barline', kind: ch, srcStart: lineStart + tokStart, srcEnd: lineStart + tokStart + 1 });
            i++;
            continue;
        }
        if (ch === "'") {
            tokens.push({ type: 'barline', kind: "'", srcStart: lineStart + tokStart, srcEnd: lineStart + tokStart + 1 });
            i++;
            continue;
        }
        if (ch === '[') {
            tokens.push({ type: 'paren-open', srcStart: lineStart + tokStart, srcEnd: lineStart + tokStart + 1 });
            i++;
            continue;
        }
        if (ch === ']') {
            tokens.push({ type: 'paren-close', srcStart: lineStart + tokStart, srcEnd: lineStart + tokStart + 1 });
            i++;
            continue;
        }
        if (isPitchLetter(ch)) {
            const r = parseNoteGroupSequence(line, i, lineStart, len);
            i = r.newI;
            if (r.groups.length) {
                tokens.push({ type: 'ligature', groups: r.groups, gaps: r.gaps, srcStart: lineStart + tokStart, srcEnd: lineStart + i });
            }
            continue;
        }
        // Unknown character — skip silently to keep editing forgiving.
        i++;
    }
    return tokens;
}
