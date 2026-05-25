/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Aretino source → AST.
//
// Returns:
// {
//     header: { [key: string]: string },
//     optionHeaders: string[],                         — repeated %option: renderer-option=value header lines
//     lines: Array<
//         | { type: 'music', tokens: Token[] }
//         | { type: 'lyrics', text: string, srcStart?: number, srcEnd?: number, sourceMap?: Array<number|null> }
//         | { type: 'verse', lines: string[] }
//         | { type: 'blank' }
//         | { type: 'preprocessor', key: string, value: string }  — %[ key: value %] as a standalone body line
//         | { type: 'pagebreak', id: string }                      — %pagebreakXXX body directive
//     >
// }
//
// Comment syntax (stripped before further parsing):
//   % ...        — line comment: rest of line is ignored (in music lines)
//   %[ ... %]    — block comment: content ignored (single or multi-line)
//   %[ k: v %]   — preprocessor directive: emitted as 'preprocessor' / 'inline-directive'
//   %pagebreakID — page-break directive: emitted as { type: 'pagebreak', id }
//
// Token shapes:
//   { type: 'directive', value: string }              — anything inside ( )
//   { type: 'barline', kind: ',' | ';' | '|' | '||' | ':|' | '|||' | "'" }
//   { type: 'expander' }                              — `*`
//   { type: 'ligature', groups: Note[][] }            — one or more note groups; groups are separated by '/' cuts within the neume
//   { type: 'inline-directive', key: string, value: string }  — %[ key: value %] inside a music line
//
// Note shape:
//   {
//       pitch: 'a'..'n',
//       virga: boolean,                  — uppercase letter
//       noVirga: boolean,                — backtick ` suppresses auto-virga
//       high: boolean,                   — trailing apostrophe (octave up)
//       shape: 'punctum' | 'virga' | 'quilisma' | 'tenor',
//       modifiers: Array<'episema'|'mora'|'liquescens'|'ictus'>,
//   }

function sourceMapForText(text, srcStart) {
    return Array.from({ length: text.length }, (_, i) => srcStart + i);
}

function updateLyricSourceSpan(item) {
    const offsets = (item.sourceMap || []).filter(Number.isFinite);
    if (offsets.length === 0) {
        delete item.srcStart;
        delete item.srcEnd;
        return;
    }
    item.srcStart = Math.min(...offsets);
    item.srcEnd = Math.max(...offsets) + 1;
}

function makeLyricItem(text, srcStart) {
    return {
        type: 'lyrics',
        text,
        srcStart,
        srcEnd: srcStart + text.length,
        sourceMap: sourceMapForText(text, srcStart),
    };
}

function appendLyricChunk(item, text, sourceMap) {
    if (!Array.isArray(item.sourceMap)) {
        item.sourceMap = Array.from({ length: item.text.length }, () => null);
    }
    item.text += text;
    item.sourceMap.push(...sourceMap);
    updateLyricSourceSpan(item);
}

function appendLyricContinuation(item, text, srcStart) {
    appendLyricChunk(item, ' ', [null]);
    appendLyricChunk(item, text, sourceMapForText(text, srcStart));
}

function trimmedSourceText(text, srcStart) {
    const leading = text.match(/^\s*/)[0].length;
    const trailing = text.match(/\s*$/)[0].length;
    const end = Math.max(leading, text.length - trailing);
    return {
        text: text.slice(leading, end),
        srcStart: srcStart + leading,
    };
}

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
    const optionHeaders = [];
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
            const key = m[1].trim();
            const value = m[2].trim();
            header[key] = value;
            if (key.toLowerCase() === 'option') {
                optionHeaders.push(value);
            }
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
    // `n:` resumes music after lyrics; following `w:` lines extend lyrics in order.
    let lastWasLyrics = false;
    let implicitLyricContinuationIdx = null;
    let sectionLyricIndices = [];
    let pendingMusicContinuationLyricIndices = null;
    let pendingMusicContinuationLyricPos = 0;
    let inBlockComment = false;
    for (let li = bodyStart; li < lines.length; li++) {
        const raw = lines[li];
        const lineStart = lineStarts[li];
        if (inBlockComment) {
            const closeIdx = raw.indexOf('%]');
            if (closeIdx >= 0) {
                inBlockComment = false;
                const remainder = raw.slice(closeIdx + 2);
                if (remainder.trim()) {
                    result.push({ type: 'music', tokens: tokenizeMusicLine(remainder, lineStart + closeIdx + 2) });
                    lastWasLyrics = false;
                    implicitLyricContinuationIdx = null;
                    pendingMusicContinuationLyricIndices = null;
                    pendingMusicContinuationLyricPos = 0;
                }
            }
            continue;
        }
        if (raw.trim() === '') {
            result.push({ type: 'blank' });
            lastWasLyrics = false;
            implicitLyricContinuationIdx = null;
            sectionLyricIndices = [];
            pendingMusicContinuationLyricIndices = null;
            pendingMusicContinuationLyricPos = 0;
            continue;
        }
        if (raw[0] === '%') {
            if (raw.startsWith('%[')) {
                const closeIdx = raw.indexOf('%]', 2);
                if (closeIdx >= 0) {
                    const inner = raw.slice(2, closeIdx).trim();
                    const dm = inner.match(/^(\S+?):\s*(.*)$/);
                    if (dm) {
                        result.push({ type: 'preprocessor', key: dm[1], value: dm[2].trim() });
                    }
                } else {
                    inBlockComment = true;
                }
            } else {
                const pbm = raw.match(/^%pagebreak(\S+)/i);
                if (pbm) {
                    result.push({ type: 'pagebreak', id: pbm[1] });
                }
                // else: plain % comment line — skip silently
            }
            lastWasLyrics = false;
            implicitLyricContinuationIdx = null;
            pendingMusicContinuationLyricIndices = null;
            pendingMusicContinuationLyricPos = 0;
            continue;
        }
        if (/^\s*W:/.test(raw)) {
            result.push({ type: 'verse', lines: [raw.replace(/^\s*W:\s?/, '')] });
            lastWasLyrics = false;
            implicitLyricContinuationIdx = null;
            pendingMusicContinuationLyricIndices = null;
            pendingMusicContinuationLyricPos = 0;
            continue;
        }
        const lyricLine = raw.match(/^(\s*w:\s?)(.*)$/);
        if (lyricLine) {
            const text = lyricLine[2];
            const textStart = lineStart + lyricLine[1].length;
            const hasMusicContinuationLyric = pendingMusicContinuationLyricIndices
                && pendingMusicContinuationLyricPos < pendingMusicContinuationLyricIndices.length;
            const continuationIdx = hasMusicContinuationLyric
                ? pendingMusicContinuationLyricIndices[pendingMusicContinuationLyricPos]
                : null;
            const continuationTarget = continuationIdx !== null ? result[continuationIdx] : null;
            if (continuationTarget && continuationTarget.type === 'lyrics') {
                const trimmed = trimmedSourceText(text, textStart);
                appendLyricContinuation(continuationTarget, trimmed.text, trimmed.srcStart);
                implicitLyricContinuationIdx = continuationIdx;
                pendingMusicContinuationLyricPos++;
                if (pendingMusicContinuationLyricPos >= pendingMusicContinuationLyricIndices.length) {
                    pendingMusicContinuationLyricIndices = null;
                    pendingMusicContinuationLyricPos = 0;
                }
            } else {
                result.push(makeLyricItem(text, textStart));
                implicitLyricContinuationIdx = result.length - 1;
                sectionLyricIndices.push(implicitLyricContinuationIdx);
            }
            lastWasLyrics = true;
            continue;
        }
        const musicContinuation = raw.match(/^(\s*n:\s?)(.*)$/);
        if (musicContinuation) {
            result.push({
                type: 'music',
                tokens: tokenizeMusicLine(musicContinuation[2], lineStart + musicContinuation[1].length),
            });
            lastWasLyrics = false;
            implicitLyricContinuationIdx = null;
            pendingMusicContinuationLyricIndices = sectionLyricIndices.slice();
            pendingMusicContinuationLyricPos = 0;
            continue;
        }
        if (lastWasLyrics) {
            // A line without w: prefix that follows a lyrics line continues the
            // same lyric line (same verse) — e.g. a linebreak added mid-lyric.
            const last = implicitLyricContinuationIdx !== null
                ? result[implicitLyricContinuationIdx]
                : result[result.length - 1];
            if (last && last.type === 'lyrics') {
                const trimmed = trimmedSourceText(raw, lineStart);
                appendLyricContinuation(last, trimmed.text, trimmed.srcStart);
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
    return { header, optionHeaders, lines: result };
}

function isPitchLetter(c) {
    return /[a-nA-N]/.test(c);
}

// Maps each accepted accidental token to the internal symbol used downstream
// ('x' flat, 'y' natural, '#' sharp): b = flat, n = natural, # = sharp.
const ACCIDENTAL_TOKENS = { b: 'x', n: 'y', '#': '#' };

// Parses an accidental directive's inner text: an optional target pitch letter
// followed by one accidental token. Returns { pitch, symbol, high? } (symbol is the
// internal 'x'/'y'/'#'), or null if it isn't an accidental. When the pitch is
// omitted it defaults to `defaultPitch` (the staff's reciting position). Uppercase
// pitch letters set high: true (octave up).
export function matchAccidental(inner, defaultPitch = 'i') {
    const m = inner.match(/^([a-nA-N]?)([bn#])$/);
    if (!m) {
        return null;
    }
    const pitchLetter = m[1] || defaultPitch;
    return {
        pitch: pitchLetter.toLowerCase(),
        symbol: ACCIDENTAL_TOKENS[m[2]],
        ...(m[1] && pitchLetter !== pitchLetter.toLowerCase() ? { high: true } : {})
    };
}

// Peek at position `pos` (which should be '(') to see if the parenthesized
// content is an accidental pattern like (ib), (n), (c#), etc.
// Returns { pitch, symbol, high?, end } where `end` is the index past ')' if it
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
    return { pitch: acc.pitch, symbol: acc.symbol, ...(acc.high ? { high: acc.high } : {}), end: end + 1 };
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
                const accStart = i;
                pendingAcc = peekInlineAccidental(line, i);
                pendingAcc.srcStart = lineStart + accStart;
                pendingAcc.srcEnd = lineStart + pendingAcc.end;
                i = pendingAcc.end;
                continue;
            }
            const noteStart = i;
            const pitchChar = line[i];
            i++;
            const note = {
                pitch: pitchChar.toLowerCase(),
                virga: false,
                noVirga: false,
                high: pitchChar !== pitchChar.toLowerCase(),
                shape: 'punctum',
                modifiers: [],
                modifierSpans: [],
            };
            if (pendingAcc) {
                note.accidental = {
                    pitch: pendingAcc.pitch,
                    symbol: pendingAcc.symbol,
                    ...(pendingAcc.high ? { high: pendingAcc.high } : {}),
                    srcStart: pendingAcc.srcStart,
                    srcEnd: pendingAcc.srcEnd,
                };
                pendingAcc = null;
            }
            while (i < limit) {
                const m = line[i];
                const span = { srcStart: lineStart + i, srcEnd: lineStart + i + 1 };
                if (m === "'") { note.virga = true; i++; continue; }
                if (m === '`') { note.noVirga = true; i++; continue; }
                if (m === '_') { note.modifiers.push('episema'); note.modifierSpans.push(span); i++; continue; }
                if (m === '-') { note.modifiers.push('ictus'); note.modifierSpans.push(span); i++; continue; }
                if (m === '.') { note.modifiers.push('mora'); note.modifierSpans.push(span); i++; continue; }
                if (m === '~') { note.modifiers.push('liquescens'); note.modifierSpans.push(span); i++; continue; }
                if (m === 'w') { note.shape = 'quilisma'; i++; continue; }
                if (m === 't') { note.shape = 'tenor'; i++; continue; }
                if (m === 's') { note.modifiers.push('small'); note.modifierSpans.push(span); i++; continue; }
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
        if (ch === '%') {
            if (line[i + 1] === '[') {
                // Inline block comment or directive: %[ ... %]
                const closeIdx = line.indexOf('%]', i + 2);
                if (closeIdx >= 0) {
                    const inner = line.slice(i + 2, closeIdx).trim();
                    const srcStart = lineStart + i;
                    i = closeIdx + 2;
                    const srcEnd = lineStart + i;
                    const dm = inner.match(/^(\S+?):\s*(.*)$/);
                    if (dm) {
                        tokens.push({ type: 'inline-directive', key: dm[1], value: dm[2].trim(), srcStart, srcEnd });
                    }
                } else {
                    break; // no closing %] on this line — treat rest as comment
                }
                continue;
            }
            break; // % alone: rest of line is a comment
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
        if (ch === '\\') {
            const m = /^\\([a-zA-Z]+)\{/.exec(line.slice(i));
            if (m) {
                tokens.push({ type: 'brace-open', kind: m[1], srcStart: lineStart + tokStart, srcEnd: lineStart + tokStart + m[0].length });
                i += m[0].length;
                continue;
            }
        }
        if (ch === '{') {
            tokens.push({ type: 'brace-open', kind: 'brace', srcStart: lineStart + tokStart, srcEnd: lineStart + tokStart + 1 });
            i++;
            continue;
        }
        if (ch === '}') {
            let label = null;
            let endI = i + 1;
            if (endI < len && line[endI] === '"') {
                const closeIdx = line.indexOf('"', endI + 1);
                if (closeIdx >= 0) {
                    label = line.slice(endI + 1, closeIdx);
                    endI = closeIdx + 1;
                } else {
                    let sp = line.indexOf(' ', endI + 1);
                    if (sp === -1) sp = len;
                    label = line.slice(endI + 1, sp);
                    endI = sp;
                }
            }
            tokens.push({ type: 'brace-close', ...(label !== null ? { label } : {}), srcStart: lineStart + tokStart, srcEnd: lineStart + endI });
            i = endI;
            continue;
        }
        if (isPitchLetter(ch)) {
            const r = parseNoteGroupSequence(line, i, lineStart, len);
            i = r.newI;
            if (r.groups.length) {
                let label = null;
                if (i < len && line[i] === '"') {
                    const closeIdx = line.indexOf('"', i + 1);
                    if (closeIdx >= 0) {
                        label = line.slice(i + 1, closeIdx);
                        i = closeIdx + 1;
                    } else {
                        // Take label up to next space or end of line
                        let spaceIdx = line.indexOf(' ', i + 1);
                        if (spaceIdx === -1) spaceIdx = len;
                        label = line.slice(i + 1, spaceIdx);
                        i = spaceIdx;
                    }
                }
                tokens.push({ type: 'ligature', groups: r.groups, gaps: r.gaps, ...(label !== null ? { label } : {}), srcStart: lineStart + tokStart, srcEnd: lineStart + i });
            }
            continue;
        }
        // Unknown character — skip silently to keep editing forgiving.
        i++;
    }
    return tokens;
}
