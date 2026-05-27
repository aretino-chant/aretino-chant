/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { syntaxTree } from '@codemirror/language';

const HEADER_KEY_OPTIONS = [
    { label: '%title:',    detail: 'Title of the piece' },
    { label: '%subtitle:', detail: 'Subtitle' },
    { label: '%caption:',  detail: 'Caption below the title block' },
    { label: '%rubric:',   detail: 'Liturgical rubric / instruction' },
    { label: '%indent:',   detail: 'Indent first music line' },
    { label: '%option:',   detail: 'Renderer option (width, zoom, …)' },
    { label: '%%',         detail: 'End of header section' },
];

const OPTION_VALUE_OPTIONS = [
    { label: 'width',          detail: 'number — output width in pixels' },
    { label: 'widthMm',        detail: 'number — output width in mm' },
    { label: 'dpi',            detail: 'number — dots per inch' },
    { label: 'zoom',           detail: 'number — zoom factor' },
    { label: 'staffSpaceMm',   detail: 'number — staff space in mm' },
    { label: 'lyricSize',      detail: 'number — lyric font size' },
    { label: 'lyricFont',      detail: 'string — lyric font family' },
    { label: 'noteSpacing',    detail: 'number — spacing between notes' },
    { label: 'staffGap',       detail: 'number — gap between staves' },
    { label: 'lyricDistance',  detail: 'number — distance from staff to lyrics' },
    { label: 'hideRepeatClef', detail: 'boolean — hide repeated clef at line start' },
    { label: 'canvasHeight',   detail: 'number — canvas height' },
];

function isInHeader(state, pos) {
    const currentLine = state.doc.lineAt(pos);
    for (let n = 1; n < currentLine.number; n++) {
        const text = state.doc.line(n).text;
        if (/^\s*%%\s*$/.test(text)) return false;           // explicit %% separator
        if (text.trim() !== '' && !text.startsWith('%')) return false; // implicit end (music started)
    }
    return true;
}

export function aretinoComplete(context) {
    const nodeBefore = syntaxTree(context.state).resolveInner(context.pos, -1);
    // % in a music line is a comment token, not a header key
    if (nodeBefore.name === 'comment') return null;

    if (!isInHeader(context.state, context.pos)) return null;

    const line = context.state.doc.lineAt(context.pos);
    const linePrefix = line.text.slice(0, context.pos - line.from);

    // After %option: — complete the option name
    const optionPrefix = linePrefix.match(/^\s*%option:\s*([a-zA-Z][a-zA-Z0-9_]*)$/);
    const optionPrefixEmpty = linePrefix.match(/^\s*%option:\s*$/);
    if (optionPrefix || optionPrefixEmpty) {
        const wordMatch = context.matchBefore(/[a-zA-Z][a-zA-Z0-9_]*/);
        // Map options to insert 'option = '
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

    // At the start of a line — complete %key:
    const keyMatch = context.matchBefore(/%%?[a-zA-Z]*/);
    if (keyMatch && /^\s*%%?[a-zA-Z]*$/.test(linePrefix)) {
        return {
            from: keyMatch.from,
            options: HEADER_KEY_OPTIONS,
            validFor: /^%%?[a-zA-Z]*/,
        };
    }

    return null;
}
