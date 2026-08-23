/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { escapeAttr } from './glyphs.js';
import {
    measureTextWidth,
    measureSegmentsAdvance,
    parseFormattingToSegments,
    renderSegments,
    renderUnderlines,
    renderMixedLabel,
} from './text.js';
import { wrapSrc } from './svg.js';

// `~` is an unbreakable space in verse text; the word splitter below breaks on
// ASCII spaces only, so substituting U+00A0 is what makes it bind.
const NBSP = ' ';

// Named typographic styles for a W: text block.
//
//   breaks       'honour' keeps a source line break as a break; 'reflow' joins
//                the block's source lines and re-wraps them.
//   breakIndent  indent of a line that follows a break, from the text column.
//   wrapIndent   indent of an automatically wrapped line, from the text column.
//   lineHeight   baseline distance within a block, in units of the block's own
//                font size (`size`), so a smaller style keeps its own leading.
//   gapWithin    baseline distance to the next block of the same style.
//   gapBefore    what this style claims above itself at a style change.
//   gapAfter     what this style claims below itself at a style change.
//   align        'left' or 'justify' (never applied to a block's last line).
//   size         font size as a multiple of the lyric size.
//   color        fill colour.
//   markerGap    space between a `~~` marker and the text column.
//   markerAlign  'left' sets every marker at the left margin; 'right' sets
//                each one flush against the text column, so a short `1.` ends
//                where a long `Refrén.` ends.
//   maxIndent    cap on the text column, from the left margin.
//
// Gaps are multiples of the lyric size — a seam joins two styles, so it needs
// one unit both sides agree on. Everything else is in the block's own size.
export const TEXT_STYLE_PRESETS = {
    psalm: {
        breaks: 'honour', breakIndent: 2, wrapIndent: 2, lineHeight: 1.10,
        gapWithin: 1.30, gapBefore: 1.30, gapAfter: 1.30,
        align: 'left', size: 1, color: '#000',
        markerGap: 0.5, markerAlign: 'left', maxIndent: 8,
    },
    prose: {
        breaks: 'reflow', breakIndent: 0, wrapIndent: 0, lineHeight: 1.25,
        gapWithin: 1.50, gapBefore: 1.60, gapAfter: 1.60,
        align: 'left', size: 1, color: '#000',
        markerGap: 0.5, markerAlign: 'left', maxIndent: 8,
    },
    stanza: {
        breaks: 'honour', breakIndent: 0, wrapIndent: 1.5, lineHeight: 1.15,
        gapWithin: 1.60, gapBefore: 1.60, gapAfter: 1.60,
        align: 'left', size: 1, color: '#000',
        markerGap: 0.5, markerAlign: 'left', maxIndent: 8,
    },
    rubric: {
        breaks: 'reflow', breakIndent: 0, wrapIndent: 0, lineHeight: 1.10,
        gapWithin: 1.20, gapBefore: 1.80, gapAfter: 1.60,
        align: 'left', size: 0.85, color: 'red',
        markerGap: 0.5, markerAlign: 'left', maxIndent: 8,
    },
};

export const DEFAULT_TEXT_STYLE = 'psalm';

// The text column may never eat more than this share of the available width,
// so a narrow projector column cannot end up with a two-word gutter.
const MAX_INDENT_WIDTH_SHARE = 0.30;

const MARKER_ALIGNMENTS = ['left', 'right'];

// Resolves a style name to a preset merged with the host's `textStyles`
// override. An unknown name falls back to the default style.
function resolveTextStyleName(name, ctx = {}) {
    if (name && TEXT_STYLE_PRESETS[name]) return name;
    const docDefault = ctx.textStyle;
    if (docDefault && TEXT_STYLE_PRESETS[docDefault]) return docDefault;
    return DEFAULT_TEXT_STYLE;
}

function resolveTextStyle(name, ctx = {}) {
    const preset = TEXT_STYLE_PRESETS[name];
    const override = ctx.textStyles?.[name];
    const style = { ...preset, ...(override ?? {}) };
    // `textMaxIndent` is the document-level knob; an explicit per-style
    // `maxIndent` from the host is more specific, so it still wins.
    if (override?.maxIndent === undefined && Number.isFinite(ctx.textMaxIndent)) {
        style.maxIndent = ctx.textMaxIndent;
    }
    if (override?.markerAlign === undefined && MARKER_ALIGNMENTS.includes(ctx.textMarkerAlign)) {
        style.markerAlign = ctx.textMarkerAlign;
    }
    return style;
}

const BLANK_FORMAT = { bold: false, italic: false, underline: false, color: null, smallCaps: false, small: false, large: false };

function charFormat(seg) {
    return {
        bold: seg.bold, italic: seg.italic, underline: seg.underline, color: seg.color,
        smallCaps: seg.smallCaps, small: seg.small, large: seg.large,
    };
}

// Collapses a flat array of formatted chars into segments,
// merging consecutive chars with identical formatting. Inline glyphs
// (\' \b \n \#) each stay a segment of their own.
function charsToSegments(chars) {
    const segs = [];
    for (const c of chars) {
        if (c.glyph) {
            segs.push({ text: '', glyph: c.glyph, glyphAdvance: c.glyphAdvance, ...charFormat(c) });
            continue;
        }
        const last = segs[segs.length - 1];
        if (last && !last.glyph && last.bold === c.bold && last.italic === c.italic &&
                last.underline === c.underline && last.color === c.color &&
                last.smallCaps === c.smallCaps && last.small === c.small && last.large === c.large) {
            last.text += c.ch;
        } else {
            segs.push({ text: c.ch, ...charFormat(c) });
        }
    }
    return segs;
}

// Turns parsed segments into a flat char stream. Text contributes one entry per
// character; an inline glyph and a `|` break each contribute a single entry, so
// the word splitter can treat a glyph as an unbreakable character and flush the
// display line at a break without a pre-pass over the raw source.
function segmentsToChars(segments) {
    const chars = [];
    for (const seg of segments) {
        if (seg.glyph) {
            chars.push({ glyph: seg.glyph, glyphAdvance: seg.glyphAdvance, ...charFormat(seg) });
        } else if (seg.break) {
            chars.push({ break: true });
        } else {
            for (const ch of seg.text) chars.push({ ch, ...charFormat(seg) });
        }
    }
    return chars;
}

// Replaces the unbreakable-space markers. `~~` is recognised first (it splits a
// marker from the body, and any further occurrence collapses to one space),
// matching the order lyric syllables use.
function substituteTildes(text) {
    return text.replace(/~~/g, NBSP).replace(/~/g, NBSP);
}

// Splits a block's opening line into its `~~` marker and the body text.
// Returns { marker: string|null, body: string }.
function splitMarker(lineText) {
    const idx = lineText.indexOf('~~');
    if (idx < 0) return { marker: null, body: lineText };
    return { marker: lineText.slice(0, idx), body: lineText.slice(idx + 2) };
}

// Wraps one verse input line into display lines that fit the column.
// firstX starts the line, breakX starts a line after a `|`, wrapX starts an
// automatically wrapped line. Returns an array of
// { x, availW, words, segments, width, wrapped }.
function wrapVerseText(lineText, firstX, breakX, wrapX, rightX, fontSize, fontFamily, measureFn = measureTextWidth) {
    const segments = parseFormattingToSegments(substituteTildes(lineText), { breaks: true });
    const chars = segmentsToChars(segments);

    // Split into words at breakable (regular ASCII) spaces; NBSP stays within
    // words. Each word stores its chars and the original space that preceded it
    // (null for the first), preserving that space's formatting (e.g. underline).
    // A break rides along as a token of its own.
    const tokens = [];
    let wordChars = [];
    let pendingSpace = null;
    function flushWord() {
        if (wordChars.length > 0) {
            tokens.push({ chars: wordChars, spaceBefore: pendingSpace });
            wordChars = [];
            pendingSpace = null;
        }
    }
    for (const c of chars) {
        if (c.break) {
            flushWord();
            tokens.push({ break: true });
            pendingSpace = null;
        } else if (c.ch === ' ') {
            flushWord();
            pendingSpace = c;
        } else {
            wordChars.push(c);
        }
    }
    flushWord();

    const spaceW = measureFn(' ', fontSize, fontFamily) || fontSize * 0.25;
    const displayLines = [];
    let lineWords = [];
    let lineWidth = 0;
    let currentX = firstX;
    let currentAvailW = rightX - firstX;

    function wordSegments(word) {
        return charsToSegments(word.chars);
    }
    function pushLine(wrapped) {
        const lineChars = [];
        const words = [];
        for (let i = 0; i < lineWords.length; i++) {
            if (i > 0) lineChars.push(lineWords[i].spaceBefore || { ch: ' ', ...BLANK_FORMAT });
            lineChars.push(...lineWords[i].chars);
            words.push({ segments: wordSegments(lineWords[i]), width: lineWords[i].width });
        }
        displayLines.push({
            x: currentX,
            availW: currentAvailW,
            segments: charsToSegments(lineChars),
            words,
            width: lineWidth,
            wrapped,
        });
        lineWords = [];
        lineWidth = 0;
    }

    for (const token of tokens) {
        if (token.break) {
            pushLine(false);
            currentX = breakX;
            currentAvailW = rightX - breakX;
            continue;
        }
        const wordW = measureSegmentsAdvance(wordSegments(token), fontSize, fontFamily, measureFn);
        token.width = wordW;
        if (lineWords.length === 0) {
            // An empty line normally takes the word whatever its width — there is
            // nowhere else for it to go. The exception is a line that starts past
            // its own wrap position, i.e. one pushed right by an overhanging
            // marker: there, retreating to the column is a real improvement.
            if (wordW > currentAvailW && currentX > wrapX) {
                pushLine(false);
                currentX = wrapX;
                currentAvailW = rightX - wrapX;
            }
            lineWords.push(token);
            lineWidth = wordW;
        } else if (lineWidth + spaceW + wordW > currentAvailW) {
            pushLine(true);
            currentX = wrapX;
            currentAvailW = rightX - wrapX;
            lineWords.push(token);
            lineWidth = wordW;
        } else {
            lineWords.push(token);
            lineWidth += spaceW + wordW;
        }
    }
    if (lineWords.length > 0 || displayLines.length === 0) {
        pushLine(false);
    }
    return displayLines;
}

// Emits one run of segments as SVG at x/y. Inline glyphs need the mixed
// renderer, which places glyph paths beside the text runs; plain text keeps the
// single <text> element.
function renderTextRun(segments, x, y, fontSize, fontFamily, fill, measureFn) {
    if (!segments || segments.length === 0) return '';
    if (segments.some(s => s.glyph)) {
        return renderMixedLabel(segments, x, y, fontSize, fontFamily, 'start', measureFn, fill);
    }
    return `<text xml:space="preserve" x="${x}" y="${y}" font-family="${escapeAttr(fontFamily)}" font-size="${fontSize}" fill="${escapeAttr(fill)}">${renderSegments(segments)}</text>`;
}

// Renders one display line, justifying it when the style asks for it and the
// line was ended by wrapping (never a block's last line, nor one ended by a
// break). Justification places each word at a computed x rather than using
// textLength or word-spacing, neither of which survives the librsvg PDF path.
function renderDisplayLine(line, y, fontSize, fontFamily, fill, justify, measureFn) {
    const parts = [];
    if (justify && line.wrapped && line.words.length > 1) {
        const spaceW = measureFn(' ', fontSize, fontFamily) || fontSize * 0.25;
        const gaps = line.words.length - 1;
        const gapW = spaceW + Math.max(0, line.availW - line.width) / gaps;
        let x = line.x;
        for (const word of line.words) {
            parts.push(renderTextRun(word.segments, x, y, fontSize, fontFamily, fill, measureFn));
            parts.push(renderUnderlines(word.segments, x, y, fontSize, fontFamily, 'start', measureFn));
            x += word.width + gapW;
        }
        return parts.join('');
    }
    parts.push(renderTextRun(line.segments, line.x, y, fontSize, fontFamily, fill, measureFn));
    parts.push(renderUnderlines(line.segments, line.x, y, fontSize, fontFamily, 'start', measureFn));
    return parts.join('');
}

// Accepts both the current verse item shape ({ lines, style, spans, srcStart,
// srcEnd }) and the plain string[] one older callers pass.
function normaliseVerses(verses) {
    return verses.map(v => (Array.isArray(v)
        ? { lines: v, style: null, spans: [] }
        : { lines: v.lines ?? [], style: v.style ?? null, spans: v.spans ?? [], srcStart: v.srcStart, srcEnd: v.srcEnd }));
}

// A run is a maximal stretch of consecutive blocks of the same style; it is
// what shares a text column, so `1.` and `10.` line up across a hymn's stanzas
// while a neighbouring responsory's role label cannot drag them across the page.
function groupRuns(blocks, ctx) {
    const runs = [];
    for (const block of blocks) {
        const name = resolveTextStyleName(block.style, ctx);
        const last = runs[runs.length - 1];
        if (last && last.name === name) {
            last.blocks.push(block);
        } else {
            runs.push({ name, style: resolveTextStyle(name, ctx), blocks: [block] });
        }
    }
    return runs;
}

// Renders all W: text blocks for a section.
// verses: the section's verse items (see normaliseVerses for accepted shapes).
// Returns { svg, bottom, blocks } where bottom is the y-coordinate of the last
// line's descender and blocks carries each block's SVG with its own ink extent,
// so a text-only score can still be split into rows.
export function renderVerseLines(ctx, verses, leftX, rightX, startY) {
    const fontSize = ctx.lyricSize;
    const fontFamily = ctx.textFont;
    const measureFn = ctx.measureText ?? measureTextWidth;
    const sourceMap = ctx.sourceMap !== false;
    const runs = groupRuns(normaliseVerses(verses), ctx);
    const parts = [];
    const blockExtents = [];

    let y = startY;
    let first = true;
    let prevStyle = null;
    let prevName = null;

    for (const run of runs) {
        const style = run.style;
        const styleSize = fontSize * style.size;
        const markerGapPx = style.markerGap * styleSize;

        // Pass one over the run: measure every marker, so the text column is
        // known before any block of the run is wrapped.
        const prepared = run.blocks.map(block => {
            const lines = block.lines.slice();
            const { marker, body } = splitMarker(lines[0] ?? '');
            const markerSegments = marker === null
                ? null
                : parseFormattingToSegments(substituteTildes(marker));
            const markerW = markerSegments
                ? measureSegmentsAdvance(markerSegments, styleSize, fontFamily, measureFn)
                : 0;
            lines[0] = body;
            return { block, lines, markerSegments, markerW };
        });

        const widestMarker = prepared.reduce((w, p) => Math.max(w, p.markerW), 0);
        const maxIndentPx = Math.min(style.maxIndent * styleSize, MAX_INDENT_WIDTH_SHARE * (rightX - leftX));
        const markerColumn = widestMarker > 0
            ? leftX + Math.min(widestMarker + markerGapPx, maxIndentPx)
            : leftX;
        const breakX = markerColumn + style.breakIndent * styleSize;
        const wrapX = markerColumn + style.wrapIndent * styleSize;
        const justify = style.align === 'justify';

        // Pass two: wrap and emit.
        for (const { block, lines, markerSegments, markerW } of prepared) {
            // A right-aligned marker ends where the text column starts, so the
            // widest marker of the run still sits at the left margin and the
            // shorter ones move in. It never crosses the margin: a marker that
            // overhangs a capped column starts there, aligned either way.
            const markerX = style.markerAlign === 'right'
                ? Math.max(leftX, markerColumn - markerGapPx - markerW)
                : leftX;

            // A marker wider than the capped column overhangs it, and its own
            // block's text starts after the marker instead of at the column.
            const blockFirstX = markerSegments
                ? Math.max(markerColumn, markerX + markerW + markerGapPx)
                : markerColumn;

            // 'reflow' styles treat a source line break as an editing
            // convenience: the block is one paragraph, and only `|` breaks it.
            const inputs = style.breaks === 'reflow'
                ? [{ text: lines.join(' '), span: { srcStart: block.srcStart, srcEnd: block.srcEnd } }]
                : lines.map((text, li) => ({ text, span: block.spans[li] ?? {} }));

            const blockParts = [];
            let blockTop = null;
            for (let li = 0; li < inputs.length; li++) {
                const firstX = li === 0 ? blockFirstX : breakX;
                const displayLines = wrapVerseText(inputs[li].text, firstX, breakX, wrapX, rightX, styleSize, fontFamily, measureFn);
                for (let di = 0; di < displayLines.length; di++) {
                    const isBlockFirst = li === 0 && di === 0;
                    // The first display line of a block sits a seam gap below the
                    // previous block; every other line uses the style's leading.
                    // The very first line of all leads from startY like any other.
                    if (isBlockFirst && !first) {
                        const seam = prevName === run.name
                            ? style.gapWithin
                            : Math.max(prevStyle.gapAfter, style.gapBefore);
                        y += seam * fontSize;
                    } else {
                        y += style.lineHeight * styleSize;
                    }
                    if (blockTop === null) blockTop = y - styleSize;
                    first = false;
                    let lineSvg = renderDisplayLine(displayLines[di], y, styleSize, fontFamily, style.color, justify, measureFn);
                    if (isBlockFirst && markerSegments) {
                        lineSvg = renderTextRun(markerSegments, markerX, y, styleSize, fontFamily, style.color, measureFn)
                            + renderUnderlines(markerSegments, markerX, y, styleSize, fontFamily, 'start', measureFn)
                            + lineSvg;
                    }
                    if (lineSvg !== '') {
                        blockParts.push(wrapSrc(inputs[li].span, lineSvg,
                            `aretino-verse aretino-verse-line aretino-verse-${run.name}`,
                            undefined, undefined, undefined, undefined, sourceMap));
                    }
                }
            }
            const blockSvg = blockParts.join('');
            parts.push(blockSvg);
            blockExtents.push({ svg: blockSvg, top: blockTop ?? y, bottom: y + styleSize * 0.3 });
            prevStyle = style;
            prevName = run.name;
        }
    }

    const lastSize = prevStyle ? fontSize * prevStyle.size : fontSize;
    return { svg: parts.join(''), bottom: y + lastSize * 0.3, blocks: blockExtents };
}
