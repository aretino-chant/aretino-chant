/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

'use strict';

// Stateful tokeniser for Aretino chant, ported from the CodeMirror stream
// parser in packages/editor/src/highlight.js. The extension host is plain
// CommonJS and cannot import the editor's CodeMirror-based module, so the
// parsing logic is duplicated here and fed into a VS Code semantic-tokens
// provider. Keep the two in sync.
//
// Token kinds (matching the editor's CM5 legacy names) map to the semantic
// token types declared in the extension; the legend wiring lives in
// extension.js / package.json.

// Minimal re-implementation of CodeMirror 5's StringStream, covering only the
// methods the ported parser uses. Operates on a single line at a time.
class StringStream {
    constructor(string) {
        this.string = string;
        this.pos = 0;
        this.start = 0;
    }

    eol() { return this.pos >= this.string.length; }
    sol() { return this.pos === 0; }
    peek() { return this.string.charAt(this.pos) || undefined; }

    next() {
        if (this.pos < this.string.length) return this.string.charAt(this.pos++);
        return undefined;
    }

    eat(match) {
        const ch = this.string.charAt(this.pos);
        let ok;
        if (typeof match === 'string') ok = ch === match;
        else if (match instanceof RegExp) ok = ch && match.test(ch);
        else ok = ch && match(ch);
        if (ok) { ++this.pos; return ch; }
        return undefined;
    }

    eatWhile(match) {
        const start = this.pos;
        while (this.eat(match)) { /* advance */ }
        return this.pos > start;
    }

    eatSpace() {
        const start = this.pos;
        while (/[\s ]/.test(this.string.charAt(this.pos))) ++this.pos;
        return this.pos > start;
    }

    skipToEnd() { this.pos = this.string.length; }

    // Matches at the current position only. Strings advance and return true;
    // regexes return the match array (and advance) when anchored at pos.
    match(pattern) {
        if (typeof pattern === 'string') {
            if (this.string.slice(this.pos, this.pos + pattern.length) === pattern) {
                this.pos += pattern.length;
                return true;
            }
            return false;
        }
        const m = this.string.slice(this.pos).match(pattern);
        if (!m || m.index !== 0) return null;
        this.pos += m[0].length;
        return m;
    }
}

// Parses one token of inline {bold}, <italic>, [underline] text formatting.
function tokenInTextSpan(stream, state) {
    const ch = stream.peek();

    if (state.textSpan === 'bold'      && ch === '}') { stream.next(); state.textSpan = null; return 'processingInstruction'; }
    if (state.textSpan === 'italic'    && ch === '>') { stream.next(); state.textSpan = null; return 'processingInstruction'; }
    if (state.textSpan === 'underline' && ch === ']') { stream.next(); state.textSpan = null; return 'processingInstruction'; }
    if (state.textSpan === 'command'   && ch === '}') { stream.next(); state.textSpan = null; return 'processingInstruction'; }

    if (state.textSpan === 'bold')      { stream.eatWhile(c => c !== '}'); return 'strong'; }
    if (state.textSpan === 'italic')    { stream.eatWhile(c => c !== '>'); return 'emphasis'; }
    if (state.textSpan === 'underline') { stream.eatWhile(c => c !== ']'); return 'link'; }
    if (state.textSpan === 'command')   { stream.eatWhile(c => c !== '}'); return 'string'; }

    // \command{ — open a command span (e.g. \small{, \large{, \sc{, \red{)
    if (ch === '\\') {
        const m = /^\\[a-zA-Z]+\{/.exec(stream.string.slice(stream.pos));
        if (m) { for (let k = 0; k < m[0].length; k++) stream.next(); state.textSpan = 'command'; return 'processingInstruction'; }
        stream.next(); // eat \ as plain text (e.g. \R, \V, \-, \{)
        return 'string';
    }

    if (ch === '{') { stream.next(); state.textSpan = 'bold';      return 'processingInstruction'; }
    if (ch === '<') { stream.next(); state.textSpan = 'italic';    return 'processingInstruction'; }
    if (ch === '[') { stream.next(); state.textSpan = 'underline'; return 'processingInstruction'; }

    stream.eatWhile(c => c !== '{' && c !== '<' && c !== '[' && c !== '\\');
    return 'string';
}

function startState() {
    return { headerDone: false, lineMode: 'music', textSpan: null, inBlockComment: false, musicPrefixPending: false };
}

function token(stream, state) {
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
                    else if (/^\s*W(?:\([a-z]+\))?:/.test(line)) state.lineMode = 'verse';
                    else {
                        state.lineMode = 'music';
                        state.musicPrefixPending = /^\s*n:/.test(line);
                    }
                }
            } else {
                state.musicPrefixPending = false;
                if (/^\s*w:/.test(line)) state.lineMode = 'lyrics';
                else if (/^\s*W(?:\([a-z]+\))?:/.test(line)) state.lineMode = 'verse';
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
        if (stream.match(/w:|W(?:\([a-z]+\))?:/)) return 'keyword';
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
    if (ch === ',') { stream.next(); if (stream.peek() === '2') stream.next(); return 'punctuation'; }
    if (ch === ';') { stream.next(); return 'punctuation'; }
    if (ch === "'") { stream.next(); return 'punctuation'; }
    if (ch === '~') { stream.next(); return 'punctuation'; }
    if (/[a-gA-G]/.test(ch)) {
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
}

function blankLine(state) {
    state.lineMode = 'music';
    state.textSpan = null;
    state.musicPrefixPending = false;
}

// CM token-kind → semantic token type name declared in the extension legend.
const TOKEN_TYPE = {
    meta: 'aretinoMeta',
    comment: 'aretinoComment',
    processingInstruction: 'aretinoFormat',
    keyword: 'aretinoKeyword',
    string: 'aretinoText',
    atom: 'aretinoPitch',
    punctuation: 'aretinoBarline',
    operator: 'aretinoOperator',
    bracket: 'aretinoNeume',
    strong: 'aretinoStrong',
    emphasis: 'aretinoEmphasis',
    link: 'aretinoLink',
};

const SEMANTIC_TOKEN_TYPES = Object.values(TOKEN_TYPE);

// Tokenises whole document text, yielding { line, start, length, type } where
// `type` is a semantic token type name from SEMANTIC_TOKEN_TYPES.
function tokenizeDocument(text) {
    const state = startState();
    const lines = text.split('\n');
    const out = [];

    for (let ln = 0; ln < lines.length; ln++) {
        const lineText = lines[ln];
        if (lineText === '' && !state.inBlockComment) {
            blankLine(state);
            continue;
        }

        const stream = new StringStream(lineText);
        let guard = 0;
        while (!stream.eol()) {
            stream.start = stream.pos;
            const kind = token(stream, state);
            if (stream.pos === stream.start) {
                // Safety: the parser must always advance. Avoid an infinite loop.
                stream.next();
                if (++guard > lineText.length + 1) break;
                continue;
            }
            if (kind && TOKEN_TYPE[kind]) {
                out.push({
                    line: ln,
                    start: stream.start,
                    length: stream.pos - stream.start,
                    type: TOKEN_TYPE[kind],
                });
            }
        }
    }

    return out;
}

// ----- Big melodic jumps (an interval wider than a fifth) --------------------

// Pitch positions mirror PITCH_BASE in core/src/glyphs.js (and the editor).
const PITCH_BASE = { A: -4, B: -3, c: -2, d: -1, e: 0, f: 1, g: 2, a: 3, b: 4, C: 5, D: 6, E: 7, F: 8, G: 9 };

function atomPitchPos(ch) {
    const base = PITCH_BASE[ch];
    return base !== undefined ? base : null;
}

// Scans for note pairs whose interval exceeds a fifth, returning the ranges of
// the leaping note as { line, start, end } (end exclusive). Ported from
// buildBigJumpDecorations in the editor.
function scanBigJumps(text) {
    const lines = text.split('\n');
    const out = [];
    let inVerse = false;
    let inLyrics = false;

    for (let ln = 0; ln < lines.length; ln++) {
        const lineText = lines[ln];
        if (lineText.trim() === '') { inVerse = false; inLyrics = false; continue; }
        if (/^\s*%/.test(lineText)) { inVerse = false; inLyrics = false; continue; }  // header / comment lines
        if (/^\s*W(?:\([a-z]+\))?:/.test(lineText)) { inVerse = true; inLyrics = false; continue; }  // verse line
        if (/^\s*w:/.test(lineText)) { inVerse = false; inLyrics = true; continue; }  // lyrics line
        // n: is always a music continuation, even after a verse or lyrics block
        if ((inVerse || inLyrics) && !/^\s*n:/.test(lineText)) continue;

        inVerse = false;
        inLyrics = false;

        let i = 0;
        const nPfx = lineText.match(/^(\s*n:\s?)/);
        if (nPfx) i = nPfx[1].length;

        let lastPP = null;
        while (i < lineText.length) {
            const ch = lineText[i];
            if (ch === '%') {
                if (lineText[i + 1] === '[') {
                    const close = lineText.indexOf('%]', i + 2);
                    i = close >= 0 ? close + 2 : lineText.length;
                } else {
                    break;
                }
                continue;
            }
            if (ch === '(') { const c = lineText.indexOf(')', i + 1); i = c >= 0 ? c + 1 : lineText.length; continue; }
            if (ch === '"') { const c = lineText.indexOf('"', i + 1); i = c >= 0 ? c + 1 : lineText.length; continue; }
            if (ch === '\\') {
                const m = /^\\[a-zA-Z]+\{/.exec(lineText.slice(i));
                i += m ? m[0].length : 1;
                continue;
            }
            if (/[a-gA-G]/.test(ch)) {
                const pp = atomPitchPos(ch);
                const from = i;
                i++;
                while (i < lineText.length && /['._\-~wts`]/.test(lineText[i])) i++;
                if (lastPP !== null && pp !== null && Math.abs(pp - lastPP) > 4) {
                    out.push({ line: ln, start: from, end: i });
                }
                if (pp !== null) lastPP = pp;
                continue;
            }
            i++;
        }
    }

    return out;
}

module.exports = { tokenizeDocument, scanBigJumps, SEMANTIC_TOKEN_TYPES };
