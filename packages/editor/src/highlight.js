/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { StreamLanguage, LanguageSupport, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// Token types (CM5 legacy names → lezer highlight tags via StreamLanguage):
//   meta                  → %key: header key part, %% separator
//   keyword               → w:/W:/n: prefix, (directives)
//   string                → base lyric/verse text, "labels" in music lines
//   atom                  → pitch notes + modifiers
//   punctuation           → barlines , ; | || ||| :| |: :|: '
//   operator              → expander *, spacers =, neume separator /
//   bracket               → neume grouping [ ]
//   strong                → {bold} content in text contexts
//   emphasis              → <italic> content in text contexts
//   link                  → [underline] content in text contexts
//   processingInstruction → inline formatting delimiters { } < > [ ] in text contexts

// Parses one token of inline {bold}, <italic>, [underline] text formatting.
// Advances stream and returns a CM5 token type string.
function tokenInTextSpan(stream, state) {
    const ch = stream.peek();

    // Close the current span
    if (state.textSpan === 'bold'      && ch === '}') { stream.next(); state.textSpan = null; return 'processingInstruction'; }
    if (state.textSpan === 'italic'    && ch === '>') { stream.next(); state.textSpan = null; return 'processingInstruction'; }
    if (state.textSpan === 'underline' && ch === ']') { stream.next(); state.textSpan = null; return 'processingInstruction'; }

    // Content inside a span (eat until the closing delimiter)
    if (state.textSpan === 'bold')      { stream.eatWhile(c => c !== '}'); return 'strong'; }
    if (state.textSpan === 'italic')    { stream.eatWhile(c => c !== '>'); return 'emphasis'; }
    if (state.textSpan === 'underline') { stream.eatWhile(c => c !== ']'); return 'link'; }

    // Open a new span
    if (ch === '{') { stream.next(); state.textSpan = 'bold';      return 'processingInstruction'; }
    if (ch === '<') { stream.next(); state.textSpan = 'italic';    return 'processingInstruction'; }
    if (ch === '[') { stream.next(); state.textSpan = 'underline'; return 'processingInstruction'; }

    // Plain text — eat until the next formatting marker (or end of line)
    stream.eatWhile(c => c !== '{' && c !== '<' && c !== '[');
    return 'string';
}

const aretinoStreamParser = {
    name: 'aretino',

    startState: () => ({ headerDone: false, lineMode: 'music', textSpan: null, inBlockComment: false, musicPrefixPending: false }),

    token(stream, state) {
        if (stream.sol()) {
            state.textSpan = null; // inline spans don't cross line boundaries
            const line = stream.string;

            if (!state.inBlockComment) {
                if (!state.headerDone) {
                    if (/^%%\s*$/.test(line)) {
                        state.headerDone = true;
                        state.lineMode = 'separator';
                    } else if (line.startsWith('%')) {
                        state.lineMode = 'header';
                    } else {
                        if (line.trim() !== '') state.headerDone = true;
                        if (/^\s*w:/.test(line)) state.lineMode = 'lyrics';
                        else if (/^\s*W:/.test(line)) state.lineMode = 'verse';
                        else {
                            state.lineMode = 'music';
                            state.musicPrefixPending = /^\s*n:/.test(line);
                        }
                    }
                } else {
                    state.musicPrefixPending = false;
                    if (/^\s*w:/.test(line)) state.lineMode = 'lyrics';
                    else if (/^\s*W:/.test(line)) state.lineMode = 'verse';
                    else {
                        if (/^\s*n:/.test(line)) state.musicPrefixPending = true;
                        if (state.lineMode !== 'lyrics' && state.lineMode !== 'verse') state.lineMode = 'music';
                        if (state.musicPrefixPending) state.lineMode = 'music';
                    }
                }
            }
        }

        if (stream.eatSpace()) return null;

        // Multi-line block comment continuation
        if (state.inBlockComment) {
            const closeIdx = stream.string.indexOf('%]', stream.pos);
            if (closeIdx >= 0) {
                while (stream.pos < closeIdx + 2) stream.next();
                state.inBlockComment = false;
            } else {
                stream.skipToEnd();
            }
            return 'comment';
        }

        // %% separator — whole line is meta
        if (state.lineMode === 'separator') {
            stream.skipToEnd();
            return 'meta';
        }

        // Header lines: tokenise %key: as meta, then parse value with formatting
        if (state.lineMode === 'header') {
            if (stream.peek() === '%') {
                stream.eatWhile(c => c !== ':');
                if (!stream.eol()) stream.next(); // consume ':'
                return 'meta';
            }
            return tokenInTextSpan(stream, state);
        }

        // Lyric / verse lines: w:/W: prefix as keyword, then inline formatting
        if (state.lineMode === 'lyrics' || state.lineMode === 'verse') {
            if (stream.match(/[wW]:/)) return 'keyword';
            return tokenInTextSpan(stream, state);
        }

        // Music line
        const ch = stream.peek();

        if (state.musicPrefixPending && stream.match('n:')) {
            state.musicPrefixPending = false;
            return 'keyword';
        }

        if (ch === '%') {
            if (stream.string[stream.pos + 1] === '[') {
                const closeIdx = stream.string.indexOf('%]', stream.pos + 2);
                if (closeIdx >= 0) {
                    while (stream.pos < closeIdx + 2) stream.next();
                } else {
                    stream.skipToEnd();
                    state.inBlockComment = true;
                }
            } else {
                stream.skipToEnd();
            }
            return 'comment';
        }

        if (ch === '(') {
            stream.next();
            while (!stream.eol() && stream.peek() !== ')') stream.next();
            if (!stream.eol()) stream.next();
            return 'keyword';
        }
        if (ch === '[' || ch === ']') { stream.next(); return 'bracket'; }
        if (ch === '\\') {
            const m = /^\\[a-zA-Z]+\{/.exec(stream.string.slice(stream.pos));
            if (m) { for (let k = 0; k < m[0].length; k++) stream.next(); return 'bracket'; }
        }
        if (ch === '{') { stream.next(); return 'bracket'; }
        if (ch === '}') {
            stream.next();
            if (stream.peek() === '"') { stream.next(); stream.eatWhile(c => c !== '"'); if (!stream.eol()) stream.next(); }
            return 'bracket';
        }
        if (ch === '*') { stream.next(); return 'operator'; }
        if (ch === '/') { stream.next(); return 'operator'; }
        if (ch === '=') { stream.eatWhile('='); return 'operator'; }
        if (ch === ':') {
            if (stream.match(':|:')) return 'punctuation';
            if (stream.match(':|')) return 'punctuation';
            stream.next(); return null;
        }
        if (ch === '|') {
            stream.eatWhile(/\|/);
            if (stream.peek() === ':') stream.next();
            return 'punctuation';
        }
        if (ch === ',' || ch === ';') { stream.next(); return 'punctuation'; }
        if (ch === "'") { stream.next(); return 'punctuation'; }
        if (/[a-nA-N]/.test(ch)) {
            stream.next();
            stream.eatWhile(/['._\-~wts]/);
            return 'atom';
        }
        if (ch === '"') {
            stream.next();
            while (!stream.eol() && stream.peek() !== '"') stream.next();
            if (!stream.eol()) stream.next();
            return 'string';
        }

        stream.next();
        return null;
    },

    blankLine(state) { state.lineMode = 'music'; state.textSpan = null; state.musicPrefixPending = false; },
};

const aretinoLanguage = StreamLanguage.define(aretinoStreamParser);

// Colour palette — light background assumed.
// basicSetup registers defaultHighlightStyle with {fallback:true} (Prec.lowest),
// so this style wins for every tag it defines.
const aretinoHighlightStyle = HighlightStyle.define([
    { tag: tags.meta,                  color: '#9ca3af', fontStyle: 'italic' },       // % headers
    { tag: tags.comment,               color: '#9ca3af' },                            // % comments, %[ blocks %]
    { tag: tags.processingInstruction, color: '#a0a0a0' },                            // format delimiters { < [
    { tag: tags.keyword,               color: '#1d4ed8' },                            // w:/W:/n:, (directives)
    { tag: tags.string,                color: '#065f46' },                            // lyrics, "labels"
    { tag: tags.atom,                  color: '#0b0b0b', fontWeight: '600' },         // pitch notes
    { tag: tags.punctuation,           color: '#1d4ed8', fontWeight: '600' },         // barlines
    { tag: tags.operator,              color: '#0891b2' },                            // * / =
    { tag: tags.bracket,               color: '#9d174d' },                            // [ ] neume groups
    { tag: tags.strong,                color: '#065f46', fontWeight: '700' },         // {bold}
    { tag: tags.emphasis,              color: '#065f46', fontStyle: 'italic' },       // <italic>
    { tag: tags.link,                  color: '#065f46', textDecoration: 'underline' }, // [underline]
]);

export function aretino() {
    return new LanguageSupport(aretinoLanguage, [
        syntaxHighlighting(aretinoHighlightStyle),
        aretinoLanguage.data.of({ closeBrackets: { brackets: ['(', '[', '{', '"', '`'] } }),
    ]);
}
