/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

'use strict';

// Context-aware completion for Aretino chant, ported from the CodeMirror
// completion source in packages/editor/src/autocomplete.js. The extension host
// is plain CommonJS and cannot import the editor's CodeMirror-based module, so
// the suggestion lists and the context detection are duplicated here and fed
// into a VS Code CompletionItemProvider. Keep the two in sync.

const vscode = require('vscode');

const LANGUAGE = 'aretino';

// Section ranks mirror completionSections in the editor; they drive the order
// suggestions appear in the popup (lower rank first). Sections without a rank
// fall back to DEFAULT_RANK.
const DEFAULT_RANK = 50;
const SECTION = {
    accidentals:     { rank: 0 },
    clefs:           { rank: 1 },
    keySignatures:   { rank: 2 },
    lineType:        { rank: 3 },
    headerKeys:      { rank: 4 },
    rendererOptions: { rank: 5 },
    comments:        { rank: 6 },
    textFormatting:  { rank: 7 },
    music:           {},
    layout:          {},
    barLines:        {},
};

const HEADER_KEY_OPTIONS = [
    { label: '%title:',    detail: 'Title of the piece', section: SECTION.headerKeys },
    { label: '%subtitle:', detail: 'Subtitle', section: SECTION.headerKeys },
    { label: '%caption:',  detail: 'Caption below the title block', section: SECTION.headerKeys },
    { label: '%rubric:',   detail: 'Liturgical rubric / instruction', section: SECTION.headerKeys },
    { label: '%indent:',   detail: 'Indent first music line', section: SECTION.headerKeys },
    { label: '%option:',   detail: 'Renderer option (width, zoom, …)', section: SECTION.headerKeys },
    { label: '%%',         detail: 'End of header section', section: SECTION.headerKeys },
];

const OPTION_VALUE_OPTIONS = [
    { label: 'width',          detail: 'number — output width in pixels', section: SECTION.rendererOptions },
    { label: 'widthMm',        detail: 'number — output width in mm', section: SECTION.rendererOptions },
    { label: 'dpi',            detail: 'number — dots per inch', section: SECTION.rendererOptions },
    { label: 'zoom',           detail: 'number — zoom factor', section: SECTION.rendererOptions },
    { label: 'staffSpaceMm',   detail: 'number — staff space in mm', section: SECTION.rendererOptions },
    { label: 'lyricSize',      detail: 'number — lyric font size', section: SECTION.rendererOptions },
    { label: 'textFont',       detail: 'string — rendered text font family', section: SECTION.rendererOptions },
    { label: 'noteSpacing',    detail: 'number — spacing between notes', section: SECTION.rendererOptions },
    { label: 'staffGap',       detail: 'number — gap between staves', section: SECTION.rendererOptions },
    { label: 'lyricDistance',  detail: 'number — distance from staff to lyrics', section: SECTION.rendererOptions },
    { label: 'virgaStemLength', detail: 'number — virga stem descent (staff-spaces)', section: SECTION.rendererOptions },
    { label: 'virgaStemDescentBelowPrev', detail: 'number — virga stem descent past a lower preceding note', section: SECTION.rendererOptions },
    { label: 'virgaMaxBelowBottom', detail: 'number — max virga stem descent below bottom staff line', section: SECTION.rendererOptions },
    { label: 'hideRepeatClef', detail: 'boolean — hide repeated clef at line start', section: SECTION.rendererOptions },
    { label: 'canvasHeight',   detail: 'number — canvas height', section: SECTION.rendererOptions },
];

const LINE_PREFIX_OPTIONS = [
    { label: 'w:', detail: 'Lyrics aligned under the preceding music line', insert: 'w: ', type: 'keyword', section: SECTION.lineType },
    { label: 'W:', detail: 'Free verse / psalm text', insert: 'W: ', type: 'keyword', section: SECTION.lineType },
    { label: 'n:', detail: 'Music continuation for the previous lyric stream', insert: 'n: ', type: 'keyword', section: SECTION.lineType },
];

const TEXT_FORMAT_OPTIONS = [
    { label: '{',        detail: 'Bold',              type: 'keyword', section: SECTION.textFormatting, boost: 10 },
    { label: '<',        detail: 'Italic',            type: 'keyword', section: SECTION.textFormatting, boost: 10 },
    { label: '[',        detail: 'Underline',         type: 'keyword', section: SECTION.textFormatting, boost: 10 },
    { label: '\\R',      detail: 'Responsory sign ℟', type: 'keyword', section: SECTION.textFormatting, boost: 5 },
    { label: '\\V',      detail: 'Versicle sign ℣',   type: 'keyword', section: SECTION.textFormatting, boost: 5 },
    { label: '\\-',      detail: 'Literal hyphen',    type: 'keyword', section: SECTION.textFormatting },
    { label: '\\sc{',    detail: 'Small-caps span',   type: 'keyword', section: SECTION.textFormatting },
    { label: '\\small{', detail: 'Small text (75%)',  type: 'keyword', section: SECTION.textFormatting },
    { label: '\\large{', detail: 'Large text (133%)', type: 'keyword', section: SECTION.textFormatting },
    { label: '\\red{',   detail: 'Red text',          type: 'keyword', section: SECTION.textFormatting },
];

const COMMENT_LINE_OPTIONS = [
    { label: '%',  detail: 'Music-line comment', insert: '% ', type: 'text', section: SECTION.comments },
    { label: '%[', detail: 'Block comment or directive', snippet: '%[ $0 %]', type: 'text', section: SECTION.comments },
];

// Parenthesized directive — inserts "(label) " with a trailing space, matching
// the editor's applyParenthesized behaviour.
function parenthesizedOption(label, detail, section = SECTION.music, boost = 0) {
    return { label, detail, type: 'keyword', section, boost, insert: `${label} ` };
}

const CLEF_NAMES = { g: 'G', f: 'F', c: 'C' };
const COMMON_CLEFS = new Set(['g2', 'c3', 'f4']);
const CLEF_OPTIONS = ['g', 'c', 'f'].flatMap(letter =>
    [1, 2, 3, 4].map(line => {
        const clef = `${letter}${line}`;
        return parenthesizedOption(
            `(${clef})`,
            `${CLEF_NAMES[letter]} clef on line ${line}`,
            SECTION.clefs,
            COMMON_CLEFS.has(clef) ? 10 : 0,
        );
    })
);

const KEY_SIGNATURE_OPTIONS = [
    parenthesizedOption('(K:b)', 'Flat key signature', SECTION.keySignatures),
    parenthesizedOption('(K:F#)', 'Single-sharp key signature', SECTION.keySignatures),
    parenthesizedOption('(K:F# C# G#)', 'Predefined sharp key signature', SECTION.keySignatures),
    parenthesizedOption('(K:)', 'Clear the key signature', SECTION.keySignatures, 10),
];

const MUSIC_DIRECTIVE_OPTIONS = [
    parenthesizedOption('(z)', 'Justified line break', SECTION.layout),
    parenthesizedOption('(Z)', 'Ragged line break', SECTION.layout),
    parenthesizedOption('(sp)', 'Spacer', SECTION.layout),
    parenthesizedOption('(sp2)', 'Double-width spacer', SECTION.layout),
];

const ACCIDENTAL_OPTIONS = [
    parenthesizedOption('(b)', 'Flat accidental', SECTION.accidentals),
    parenthesizedOption('(n)', 'Natural accidental', SECTION.accidentals),
    parenthesizedOption('(f#)', 'Sharp accidental', SECTION.accidentals),
];

const BARE_MUSIC_OPTIONS = [
    { label: ',',       detail: 'Quarter bar', type: 'keyword', section: SECTION.barLines },
    { label: ';',       detail: 'Half bar', type: 'keyword', section: SECTION.barLines },
    { label: '|',       detail: 'Full bar', type: 'keyword', section: SECTION.barLines },
    { label: '||',      detail: 'Double bar', type: 'keyword', section: SECTION.barLines },
    { label: '|||',     detail: 'Triple bar', type: 'keyword', section: SECTION.barLines },
    { label: ':|',      detail: 'Repeat end', type: 'keyword', section: SECTION.barLines },
    { label: '|:',      detail: 'Repeat start', type: 'keyword', section: SECTION.barLines },
    { label: ':|:',     detail: 'Repeat both', type: 'keyword', section: SECTION.barLines },
    { label: "'",       detail: 'Breath mark', type: 'keyword', section: SECTION.barLines },
    { label: '*',       detail: 'Expander', type: 'operator', section: SECTION.layout },
    { label: '=',       detail: 'Spacer', type: 'operator', section: SECTION.layout },
    { label: '[',       detail: 'Open parenthesized notes', type: 'keyword', section: SECTION.music },
    { label: '{',       detail: 'Open overbrace span', type: 'keyword', section: SECTION.music },
    { label: '\\arc{',  detail: 'Open arc span', type: 'keyword', section: SECTION.music },
    { label: '\\line{', detail: 'Open line span', type: 'keyword', section: SECTION.music },
];

const TOP_LEVEL_MUSIC_OPTIONS = [
    ...CLEF_OPTIONS.filter(opt => COMMON_CLEFS.has(opt.label.slice(1, -1))),
    ...KEY_SIGNATURE_OPTIONS,
    ...MUSIC_DIRECTIVE_OPTIONS,
    ...BARE_MUSIC_OPTIONS,
];

// ----- Context detection (ported from the editor) ----------------------------

function isHeaderLine(text) {
    return /^\s*%\s*[^:\s][^:]*:/.test(text);
}

function isInHeader(document, lineNumber) {
    for (let n = 0; n < lineNumber; n++) {
        const text = document.lineAt(n).text;
        if (/^\s*%%\s*$/.test(text)) return false;           // explicit %% separator
        if (text.trim() !== '' && !isHeaderLine(text)) return false; // implicit end (music/comment started)
    }
    return true;
}

// Returns 'header' | 'music' | 'lyrics' | 'verse' for the given line.
function lineTypeAt(document, lineNumber) {
    const text = document.lineAt(lineNumber).text;
    if (/^\s*w:/.test(text)) return 'lyrics';
    if (/^\s*W:/.test(text)) return 'verse';
    if (/^\s*n:/.test(text)) return 'music';
    if (isInHeader(document, lineNumber)) return 'header';
    let prevMode = 'music';
    for (let n = 0; n < lineNumber; n++) {
        const t = document.lineAt(n).text;
        if (t.trim() === '' || /^\s*%%\s*$/.test(t)) { prevMode = 'music'; continue; }
        if (/^\s*w:/.test(t)) { prevMode = 'lyrics'; continue; }
        if (/^\s*W:/.test(t)) { prevMode = 'verse'; continue; }
        if (/^\s*n:/.test(t)) { prevMode = 'music'; continue; }
    }
    return prevMode;
}

function parenthesizedOptionsFor(prefix) {
    if (/^\(K:?/i.test(prefix)) return KEY_SIGNATURE_OPTIONS;
    if (/^\([gfcGFC]?\d?$/.test(prefix)) {
        return prefix.length === 1
            ? [...CLEF_OPTIONS.filter(opt => COMMON_CLEFS.has(opt.label.slice(1, -1))), ...KEY_SIGNATURE_OPTIONS, ...MUSIC_DIRECTIVE_OPTIONS, ...ACCIDENTAL_OPTIONS]
            : CLEF_OPTIONS;
    }
    return [...CLEF_OPTIONS.filter(opt => COMMON_CLEFS.has(opt.label.slice(1, -1))), ...KEY_SIGNATURE_OPTIONS, ...MUSIC_DIRECTIVE_OPTIONS, ...ACCIDENTAL_OPTIONS];
}

function lineStartOptions(prefix, headerAllowed) {
    if (prefix.startsWith('%')) {
        return [
            ...(headerAllowed ? HEADER_KEY_OPTIONS : []),
            ...COMMENT_LINE_OPTIONS,
        ];
    }
    if (prefix.startsWith('(')) {
        return parenthesizedOptionsFor(prefix);
    }
    return [
        ...TOP_LEVEL_MUSIC_OPTIONS,
        ...LINE_PREFIX_OPTIONS,
        ...(headerAllowed ? HEADER_KEY_OPTIONS : []),
        ...COMMENT_LINE_OPTIONS,
    ];
}

// ----- VS Code item building -------------------------------------------------

const KIND = {
    keyword: vscode.CompletionItemKind.Keyword,
    text: vscode.CompletionItemKind.Text,
    operator: vscode.CompletionItemKind.Operator,
};

// Stable order key: section rank first, then higher boost, then label.
function sortText(opt) {
    const rank = opt.section && opt.section.rank != null ? opt.section.rank : DEFAULT_RANK;
    const boost = opt.boost || 0;
    return `${String(rank).padStart(3, '0')}${String(1000 - boost).padStart(4, '0')}${opt.label}`;
}

// Converts a ported option to a vscode.CompletionItem, replacing the text from
// `fromChar` to the cursor on `line`.
function toItem(opt, line, fromChar, toChar) {
    const item = new vscode.CompletionItem(opt.label, KIND[opt.type] || vscode.CompletionItemKind.Keyword);
    if (opt.detail) item.detail = opt.detail;
    item.sortText = sortText(opt);
    item.filterText = opt.label;
    item.range = new vscode.Range(line, fromChar, line, toChar);
    if (opt.snippet) {
        item.insertText = new vscode.SnippetString(opt.snippet);
    } else if (opt.insert) {
        item.insertText = opt.insert;
    }
    return item;
}

function buildItems(options, line, fromChar, toChar) {
    return options.map(opt => toItem(opt, line, fromChar, toChar));
}

function provideCompletionItems(document, position, _token, completionContext) {
    const explicit = !completionContext ||
        completionContext.triggerKind === vscode.CompletionTriggerKind.Invoke;
    const line = position.line;
    const lineText = document.lineAt(line).text;
    const linePrefix = lineText.slice(0, position.character);
    const to = position.character;
    const lt = lineTypeAt(document, line);
    const headerAllowed = lt === 'header';

    // After %option: — complete the option name
    const optionPrefix = /^\s*%option:\s*([a-zA-Z][a-zA-Z0-9_]*)$/.exec(linePrefix);
    const optionPrefixEmpty = /^\s*%option:\s*$/.test(linePrefix);
    if (headerAllowed && (optionPrefix || optionPrefixEmpty)) {
        const fromChar = optionPrefix ? to - optionPrefix[1].length : to;
        const options = OPTION_VALUE_OPTIONS.map(opt => ({ ...opt, insert: opt.label + '=' }));
        return buildItems(options, line, fromChar, to);
    }

    // Lyrics / verse lines: offer text-formatting completions on a \ prefix, or
    // the whole set on explicit invoke. Don't pop on every plain letter typed.
    if (lt === 'lyrics' || lt === 'verse') {
        const m = /\\[a-zA-Z-]*$/.exec(linePrefix);
        if (m) return buildItems(TEXT_FORMAT_OPTIONS, line, to - m[0].length, to);
        if (explicit) return buildItems(TEXT_FORMAT_OPTIONS, line, to, to);
        return undefined;
    }

    // Line start: the first non-whitespace token of the line
    const lineStartMatch = /^(\s*)(\S*)$/.exec(linePrefix);
    if (lineStartMatch) {
        const prefix = lineStartMatch[2];
        if (prefix === '' && !explicit) return undefined;
        const fromChar = lineStartMatch[1].length;
        return buildItems(lineStartOptions(prefix, headerAllowed), line, fromChar, to);
    }

    // Mid-line music completions.
    const isMusicLine = lt === 'music' || (lt === 'header' && !/^\s*%/.test(lineText));
    if (isMusicLine) {
        // % in a music line is a comment — don't offer header keys mid-line.
        const commentIdx = lineText.indexOf('%');
        if (commentIdx >= 0 && commentIdx < position.character) return undefined;

        // After ( — offer parenthesized directives (clefs, key sigs, layout)
        const parenBefore = /\([^\s)]*$/.exec(linePrefix);
        if (parenBefore) {
            const fromChar = to - parenBefore[0].length;
            return buildItems(parenthesizedOptionsFor(parenBefore[0]), line, fromChar, to);
        }

        // After \ — offer music span commands
        const backslashBefore = /\\[a-zA-Z]*\{?$/.exec(linePrefix);
        if (backslashBefore) {
            const fromChar = to - backslashBefore[0].length;
            const spanOptions = BARE_MUSIC_OPTIONS.filter(opt => opt.label.startsWith('\\'));
            return buildItems(spanOptions, line, fromChar, to);
        }

        // Otherwise — offer all music options, but only when explicitly asked
        // (Ctrl+Space); mirrors the editor's non-activate-on-typing behaviour so
        // the full list doesn't pop on every note typed.
        if (explicit) return buildItems(TOP_LEVEL_MUSIC_OPTIONS, line, to, to);
    }

    return undefined;
}

function registerCompletion(context) {
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: LANGUAGE },
            { provideCompletionItems },
            '%', '(', '\\', ':',
        ),
    );
}

module.exports = { registerCompletion };
