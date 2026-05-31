/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// NOTE: The VS Code extension duplicates these suggestion lists and the
// context-detection logic in packages/vscode/src/completion.js (its CommonJS
// extension host cannot import this CodeMirror-based module). Keep the two in
// sync when adding directives or completion rules.

import { pickedCompletion } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';

export const completionSections = {
    clefs: { name: 'Clefs', rank: 1 },
    keySignatures: { name: 'Key signatures', rank: 2 },
    lineType: { name: 'Line type', rank: 3 },
    headerKeys: { name: 'Header keys', rank: 4 },
    rendererOptions: { name: 'Renderer options', rank: 5 },
    comments: { name: 'Comments', rank: 6 },
    textFormatting: { name: 'Text formatting', rank: 7 },
    accidentals: { name: 'Accidentals', rank: 0 },
    music: { name: 'Music' },
    layout: { name: 'Layout' },
    barLines: { name: 'Bar lines' },
};

const HEADER_KEY_OPTIONS = [
    { label: '%title:',    detail: 'Title of the piece', section: completionSections.headerKeys },
    { label: '%subtitle:', detail: 'Subtitle', section: completionSections.headerKeys },
    { label: '%caption:',  detail: 'Caption below the title block', section: completionSections.headerKeys },
    { label: '%rubric:',   detail: 'Liturgical rubric / instruction', section: completionSections.headerKeys },
    { label: '%indent:',   detail: 'Indent first music line', section: completionSections.headerKeys },
    { label: '%option:',   detail: 'Renderer option (width, zoom, …)', section: completionSections.headerKeys },
    { label: '%%',         detail: 'End of header section', section: completionSections.headerKeys },
];

const OPTION_VALUE_OPTIONS = [
    { label: 'width',          detail: 'number — output width in pixels', section: completionSections.rendererOptions },
    { label: 'widthMm',        detail: 'number — output width in mm', section: completionSections.rendererOptions },
    { label: 'dpi',            detail: 'number — dots per inch', section: completionSections.rendererOptions },
    { label: 'zoom',           detail: 'number — zoom factor', section: completionSections.rendererOptions },
    { label: 'staffSpaceMm',   detail: 'number — staff space in mm', section: completionSections.rendererOptions },
    { label: 'lyricSize',      detail: 'number — lyric font size', section: completionSections.rendererOptions },
    { label: 'textFont',       detail: 'string — rendered text font family', section: completionSections.rendererOptions },
    { label: 'noteSpacing',    detail: 'number — spacing between notes', section: completionSections.rendererOptions },
    { label: 'staffGap',       detail: 'number — gap between staves', section: completionSections.rendererOptions },
    { label: 'lyricDistance',  detail: 'number — distance from staff to lyrics', section: completionSections.rendererOptions },
    { label: 'hideRepeatClef', detail: 'boolean — hide repeated clef at line start', section: completionSections.rendererOptions },
    { label: 'canvasHeight',   detail: 'number — canvas height', section: completionSections.rendererOptions },
];

const LINE_PREFIX_OPTIONS = [
    { label: 'w:', detail: 'Lyrics aligned under the preceding music line', apply: 'w: ', type: 'keyword', section: completionSections.lineType },
    { label: 'W:', detail: 'Free verse / psalm text', apply: 'W: ', type: 'keyword', section: completionSections.lineType },
    { label: 'n:', detail: 'Music continuation for the previous lyric stream', apply: 'n: ', type: 'keyword', section: completionSections.lineType },
];

const TEXT_FORMAT_OPTIONS = [
    { label: '{',      detail: 'Bold',   type: 'keyword', section: completionSections.textFormatting, boost: 10 },
    { label: '<',    detail: 'Italic', type: 'keyword', section: completionSections.textFormatting, boost: 10  },
    { label: '[',      detail: 'Underline',           type: 'keyword', section: completionSections.textFormatting, boost: 10  },
    { label: '\\R',      detail: 'Responsory sign ℟',  type: 'keyword', section: completionSections.textFormatting , boost: 5 },
    { label: '\\V',      detail: 'Versicle sign ℣',    type: 'keyword', section: completionSections.textFormatting , boost: 5 },
    { label: '\\-',      detail: 'Literal hyphen',      type: 'keyword', section: completionSections.textFormatting },
    { label: '\\sc{',    detail: 'Small-caps span',     type: 'keyword', section: completionSections.textFormatting },
    { label: '\\small{', detail: 'Small text (75%)',    type: 'keyword', section: completionSections.textFormatting },
    { label: '\\large{', detail: 'Large text (133%)',   type: 'keyword', section: completionSections.textFormatting },
    { label: '\\red{',   detail: 'Red text',            type: 'keyword', section: completionSections.textFormatting },
];

const COMMENT_LINE_OPTIONS = [
    { label: '%', detail: 'Music-line comment', apply: '% ', type: 'text', section: completionSections.comments },
    { label: '%[', detail: 'Block comment or directive', apply: '%[  %]', type: 'text', section: completionSections.comments },
];

function applyParenthesized(insert) {
    return (view, completion, from, to) => {
        const replaceTo = view.state.sliceDoc(to, to + 1) === ')' ? to + 1 : to;
        view.dispatch({
            changes: { from, to: replaceTo, insert },
            selection: { anchor: from + insert.length },
            annotations: pickedCompletion.of(completion),
        });
    };
}

function parenthesizedOption(label, detail, section = completionSections.music, boost = 0) {
    return {
        label,
        detail,
        type: 'keyword',
        section,
        ...(boost ? { boost } : {}),
        apply: applyParenthesized(`${label} `),
    };
}

const CLEF_NAMES = { g: 'G', f: 'F', c: 'C' };
const COMMON_CLEFS = new Set(['g2', 'c3', 'f4']);
const CLEF_OPTIONS = ['g', 'c', 'f'].flatMap(letter =>
    [1, 2, 3, 4].map(line => {
        const clef = `${letter}${line}`;
        return parenthesizedOption(
            `(${clef})`,
            `${CLEF_NAMES[letter]} clef on line ${line}`,
            completionSections.clefs,
            COMMON_CLEFS.has(clef) ? 10 : 0,
        );
    })
);

const KEY_SIGNATURE_OPTIONS = [
    parenthesizedOption('(K:b)', 'Flat key signature', completionSections.keySignatures),
    parenthesizedOption('(K:F#)', 'Single-sharp key signature', completionSections.keySignatures),
    parenthesizedOption('(K:F# C# G#)', 'Predefined sharp key signature', completionSections.keySignatures),
    parenthesizedOption('(K:)', 'Clear the key signature', completionSections.keySignatures, 10),
];

const MUSIC_DIRECTIVE_OPTIONS = [
    parenthesizedOption('(z)', 'Justified line break', completionSections.layout),
    parenthesizedOption('(Z)', 'Ragged line break', completionSections.layout),
    parenthesizedOption('(sp)', 'Spacer', completionSections.layout),
    parenthesizedOption('(sp2)', 'Double-width spacer', completionSections.layout),
];

const ACCIDENTAL_OPTIONS = [
    parenthesizedOption('(b)', 'Flat accidental', completionSections.accidentals),
    parenthesizedOption('(n)', 'Natural accidental', completionSections.accidentals),
    parenthesizedOption('(f#)', 'Sharp accidental', completionSections.accidentals),
];

const BARE_MUSIC_OPTIONS = [
    { label: ',', detail: 'Quarter bar', type: 'keyword', section: completionSections.barLines },
    { label: ';', detail: 'Half bar', type: 'keyword', section: completionSections.barLines },
    { label: '|', detail: 'Full bar', type: 'keyword', section: completionSections.barLines },
    { label: '||', detail: 'Double bar', type: 'keyword', section: completionSections.barLines },
    { label: '|||', detail: 'Triple bar', type: 'keyword', section: completionSections.barLines },
    { label: ':|', detail: 'Repeat end', type: 'keyword', section: completionSections.barLines },
    { label: '|:', detail: 'Repeat start', type: 'keyword', section: completionSections.barLines },
    { label: ':|:', detail: 'Repeat both', type: 'keyword', section: completionSections.barLines },
    { label: "'", detail: 'Breath mark', type: 'keyword', section: completionSections.barLines },
    { label: '*', detail: 'Expander', type: 'operator', section: completionSections.layout },
    { label: '=', detail: 'Spacer', type: 'operator', section: completionSections.layout },
    { label: '[', detail: 'Open parenthesized notes', type: 'keyword', section: completionSections.music },
    { label: '{', detail: 'Open overbrace span', type: 'keyword', section: completionSections.music },
    { label: '\\arc{', detail: 'Open arc span', type: 'keyword', section: completionSections.music },
    { label: '\\line{', detail: 'Open line span', type: 'keyword', section: completionSections.music },
];

const TOP_LEVEL_MUSIC_OPTIONS = [
    ...CLEF_OPTIONS.filter(opt => COMMON_CLEFS.has(opt.label.slice(1, -1))),
    ...KEY_SIGNATURE_OPTIONS,
    ...MUSIC_DIRECTIVE_OPTIONS,
    ...BARE_MUSIC_OPTIONS,
];

function isHeaderLine(text) {
    return /^\s*%\s*[^:\s][^:]*:/.test(text);
}

function isInHeader(state, pos) {
    const currentLine = state.doc.lineAt(pos);
    for (let n = 1; n < currentLine.number; n++) {
        const text = state.doc.line(n).text;
        if (/^\s*%%\s*$/.test(text)) return false;           // explicit %% separator
        if (text.trim() !== '' && !isHeaderLine(text)) return false; // implicit end (music/comment started)
    }
    return true;
}

// Returns 'header' | 'music' | 'lyrics' | 'verse' for the line at pos.
// Unlabeled lines inherit the mode of the preceding labeled line (blank lines reset to music).
function lineTypeAt(state, pos) {
    const currentLine = state.doc.lineAt(pos);
    const text = currentLine.text;
    // Explicit prefixes always determine the type, even on the first line
    if (/^\s*w:/.test(text)) return 'lyrics';
    if (/^\s*W:/.test(text)) return 'verse';
    if (/^\s*n:/.test(text)) return 'music';
    if (isInHeader(state, pos)) return 'header';
    let prevMode = 'music';
    for (let n = 1; n < currentLine.number; n++) {
        const t = state.doc.line(n).text;
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

function completeLineStart(context, line, linePrefix, headerAllowed) {
    const m = linePrefix.match(/^(\s*)(\S*)$/);
    if (!m) return null;

    const prefix = m[2];
    if (prefix === '' && !context.explicit) return null;

    return {
        from: line.from + m[1].length,
        options: lineStartOptions(prefix, headerAllowed),
        validFor: /^[^\s]*$/,
    };
}

export function aretinoComplete(context) {
    const line = context.state.doc.lineAt(context.pos);
    const linePrefix = line.text.slice(0, context.pos - line.from);
    const lt = lineTypeAt(context.state, context.pos);
    const headerAllowed = lt === 'header';

    // After %option: — complete the option name
    const optionPrefix = linePrefix.match(/^\s*%option:\s*([a-zA-Z][a-zA-Z0-9_]*)$/);
    const optionPrefixEmpty = linePrefix.match(/^\s*%option:\s*$/);
    if (headerAllowed && (optionPrefix || optionPrefixEmpty)) {
        const wordMatch = context.matchBefore(/[a-zA-Z][a-zA-Z0-9_]*/);
        const options = OPTION_VALUE_OPTIONS.map(opt => ({
            ...opt,
            apply: opt.label + '=',
        }));
        return {
            from: wordMatch ? wordMatch.from : context.pos,
            options,
            validFor: /^[a-zA-Z][a-zA-Z0-9_]*/,
        };
    }

    // Lyrics / verse lines: offer text-formatting completions on \ prefix
    if (lt === 'lyrics' || lt === 'verse') {
        const wordBefore = context.matchBefore(/\\[a-zA-Z-]*/);
        if (wordBefore) {
            return { from: wordBefore.from, options: TEXT_FORMAT_OPTIONS, validFor: /^\\[a-zA-Z-]*$/ };
        }
        if (context.explicit) {
            return { from: context.pos, options: TEXT_FORMAT_OPTIONS, validFor: /^\\[a-zA-Z-]*$/ };
        }
        return null;
    }

    const lineStart = completeLineStart(context, line, linePrefix, headerAllowed);
    if (lineStart) return lineStart;

    const nodeBefore = syntaxTree(context.state).resolveInner(context.pos, -1);
    // % in a music line is a comment token, not a header key
    if (nodeBefore.name === 'comment') return null;

    // Mid-line music completions (line-start handler already handled position 0 cases).
    // A non-% line is music context even when lineTypeAt returns 'header' (vacuously true
    // for a first line with no preceding header lines).
    const isMusicLine = lt === 'music' || (lt === 'header' && !/^\s*%/.test(line.text));
    if (isMusicLine) {
        // After ( — offer parenthesized directives (clefs, key sigs, layout)
        const parenBefore = context.matchBefore(/\([^\s)]*$/);
        if (parenBefore) {
            return {
                from: parenBefore.from,
                options: parenthesizedOptionsFor(parenBefore.text),
                validFor: /^\([^\s)]*$/,
            };
        }

        // After \ — offer music span commands
        const backslashBefore = context.matchBefore(/\\[a-zA-Z]*\{?/);
        if (backslashBefore) {
            const spanOptions = BARE_MUSIC_OPTIONS.filter(opt => opt.label.startsWith('\\'));
            return { from: backslashBefore.from, options: spanOptions, validFor: /^\\[a-zA-Z]*\{?$/ };
        }

        // Explicit — offer all music options (no line-prefix or header options mid-line)
        if (context.explicit) {
            return { from: context.pos, options: TOP_LEVEL_MUSIC_OPTIONS, validFor: /^[^\s]*$/ };
        }
    }

    return null;
}
