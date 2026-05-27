/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { escapeAttr } from './glyphs.js';
import {
    measureTextWidth,
    measureSegmentsWidth,
    parseFormattingToSegments,
    renderSegments,
    renderUnderlines,
} from './text.js';

// Collapses a flat array of formatted chars into segments,
// merging consecutive chars with identical formatting.
function charsToSegments(chars) {
    const segs = [];
    for (const c of chars) {
        const last = segs[segs.length - 1];
        if (last && last.bold === c.bold && last.italic === c.italic &&
                last.underline === c.underline && last.color === c.color &&
                last.smallCaps === c.smallCaps && last.small === c.small && last.large === c.large) {
            last.text += c.ch;
        } else {
            segs.push({ text: c.ch, bold: c.bold, italic: c.italic, underline: c.underline, color: c.color, smallCaps: c.smallCaps, small: c.small, large: c.large });
        }
    }
    return segs;
}

// Wraps one verse input line into display lines that fit within availW.
// Continuation display lines (after wrapping) start at contX and use contAvailW.
// Returns an array of { x, segments }.
function wrapVerseText(lineText, firstX, contX, firstAvailW, contAvailW, fontSize, fontFamily) {
    // ~ is unbreakable space in verse lines
    const processed = lineText.replace(/~/g, ' ');
    const allSegs = parseFormattingToSegments(processed);

    // Build flat per-char array with formatting metadata
    const chars = [];
    for (const seg of allSegs) {
        for (const ch of seg.text) {
            chars.push({ ch, bold: seg.bold, italic: seg.italic, underline: seg.underline, color: seg.color, smallCaps: seg.smallCaps, small: seg.small, large: seg.large });
        }
    }

    // Split into words at breakable (regular ASCII) spaces; NBSP stays within words.
    // Each entry stores the word chars and the original space char that preceded it
    // (null for the first word), preserving the space's formatting (e.g. underline).
    const words = [];
    let wordChars = [];
    let pendingSpace = null;
    for (const c of chars) {
        if (c.ch === ' ') {
            if (wordChars.length > 0) { words.push({ chars: wordChars, spaceBefore: pendingSpace }); wordChars = []; }
            pendingSpace = c;
        } else {
            wordChars.push(c);
        }
    }
    if (wordChars.length > 0) words.push({ chars: wordChars, spaceBefore: pendingSpace });

    const spaceW = measureTextWidth(' ', fontSize, fontFamily) || fontSize * 0.25;
    const displayLines = [];
    let lineChars = [];
    let lineWidth = 0;
    let currentX = firstX;
    let currentAvailW = firstAvailW;

    for (const word of words) {
        const wordW = measureSegmentsWidth(charsToSegments(word.chars), fontSize, fontFamily);
        if (lineChars.length === 0) {
            lineChars = [...word.chars];
            lineWidth = wordW;
        } else if (lineWidth + spaceW + wordW > currentAvailW) {
            displayLines.push({ x: currentX, segments: charsToSegments(lineChars) });
            lineChars = [...word.chars];
            lineWidth = wordW;
            currentX = contX;
            currentAvailW = contAvailW;
        } else {
                lineChars.push(word.spaceBefore || { ch: ' ', bold: false, italic: false, underline: false, color: null, smallCaps: false, small: false, large: false });
            lineChars.push(...word.chars);
            lineWidth += spaceW + wordW;
        }
    }
    if (lineChars.length > 0) {
        displayLines.push({ x: currentX, segments: charsToSegments(lineChars) });
    }
    if (displayLines.length === 0) {
        displayLines.push({ x: currentX, segments: [] });
    }
    return displayLines;
}

// Renders all W: verse blocks for a section.
// verses: array of string[] (each inner array is one W: block's input lines)
// Returns { svg, bottom } where bottom is the y-coordinate of the last line's baseline.
export function renderVerseLines(ctx, verses, leftX, rightX, startY) {
    const fontSize = ctx.lyricSize;
    const fontFamily = ctx.lyricFont;
    // 110% line height within a verse, 130% baseline distance between verse blocks.
    const lineHeight = fontSize * 1.1;
    const verseGap = fontSize * 1.3;
    const indentX = leftX + fontSize * 2;
    const parts = [];

    let y = startY;
    let firstDisplayLine = true;

    for (let vi = 0; vi < verses.length; vi++) {
        let firstLineOfVerse = true;
        const inputLines = verses[vi];
        for (let li = 0; li < inputLines.length; li++) {
            const isFirstInput = li === 0;
            const firstX = isFirstInput ? leftX : indentX;
            const firstAvailW = rightX - firstX;
            const contAvailW = rightX - indentX;
            const displayLines = wrapVerseText(inputLines[li], firstX, indentX, firstAvailW, contAvailW, fontSize, fontFamily);
            for (const dl of displayLines) {
                // First display line of a new verse block uses verseGap (130%);
                // all other lines (within-verse or auto-wrapped) use lineHeight (110%).
                // The very first display line ever also uses lineHeight to lead from startY.
                y += (firstLineOfVerse && !firstDisplayLine) ? verseGap : lineHeight;
                firstLineOfVerse = false;
                firstDisplayLine = false;
                parts.push(`<text xml:space="preserve" x="${dl.x}" y="${y}" font-family="${escapeAttr(fontFamily)}" font-size="${fontSize}" fill="#000">${renderSegments(dl.segments)}</text>`);
                parts.push(renderUnderlines(dl.segments, dl.x, y, fontSize, fontFamily, 'start'));
            }
        }
    }

    return { svg: parts.join(''), bottom: y + fontSize * 0.3 };
}
