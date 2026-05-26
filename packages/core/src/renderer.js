/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { parseAretino, matchAccidental } from './parser.js';
import {
    METRICS,
    pitchToPos,
    pitchY,
    drawNoteHead,
    drawEpisema,
    drawEpisemaSpan,
    drawIctus,
    drawMora,
    drawLiquescens,
    drawLigatureConnector,
    ligatureConnectorHalfStroke,
    noteheadRightPoint,
    noteheadLeftPoint,
    drawStaffLines,
    drawClef,
    drawAccidental,
    drawBarline,
    drawParenthesis,
    drawOverbrace,
    drawOverarc,
    drawOverline,
    escapeText,
    escapeAttr,
} from './glyphs.js';

const DEFAULT_FONT = "'Palatino Linotype', 'Book Antiqua', Palatino, serif";

const MM_PER_INCH = 25.4;
const DEFAULT_DPI = 96;
// True (print) staff-space size for prepared choral scores,
// This is the *physical* size; on-screen
// magnification for editing is a separate `zoom` (see below).
const DEFAULT_STAFF_SPACE_MM = 1.75;
// Default line-break width (≈18 cm). Determines where lines wrap; it is a
// logical/physical measure and is unaffected by `zoom`.
const DEFAULT_PAGE_WIDTH_MM = 180;
// Default lyric font size in typographic points
const DEFAULT_LYRIC_SIZE_PT = 10;

const HEADER_RENDERER_OPTION_TYPES = {
    width: 'number',
    widthMm: 'number',
    dpi: 'number',
    zoom: 'number',
    staffSpaceMm: 'number',
    lyricSize: 'number',
    lyricFont: 'string',
    noteSpacing: 'number',
    staffGap: 'number',
    lyricDistance: 'number',
    hideRepeatClef: 'boolean',
    canvasHeight: 'number',
};

function parseBooleanOption(valueText) {
    const value = valueText.trim().toLowerCase();
    if (value === 'true' || value === '1' || value === 'yes' || value === 'on') {
        return true;
    }
    if (value === 'false' || value === '0' || value === 'no' || value === 'off') {
        return false;
    }
    return null;
}

function parseHeaderRendererOption(raw) {
    const text = String(raw ?? '').trim();
    const flag = text.match(/^([A-Za-z][A-Za-z0-9_]*)$/);
    if (flag && HEADER_RENDERER_OPTION_TYPES[flag[1]] === 'boolean') {
        return [flag[1], true];
    }

    const m = text.match(/^([A-Za-z][A-Za-z0-9_]*)\s*(?:=|:)\s*(.*)$/);
    if (!m) {
        return null;
    }

    const name = m[1];
    const valueText = m[2].trim();
    const type = HEADER_RENDERER_OPTION_TYPES[name];
    if (!type) {
        return null;
    }

    if (type === 'number') {
        if (valueText === '') {
            return null;
        }
        const value = Number(valueText);
        return Number.isFinite(value) ? [name, value] : null;
    }

    if (type === 'boolean') {
        const value = parseBooleanOption(valueText);
        return value === null ? null : [name, value];
    }

    return [name, valueText];
}

function parseHeaderRendererOptions(ast) {
    const values = [];
    if (Array.isArray(ast?.optionHeaders)) {
        values.push(...ast.optionHeaders);
    }
    if (values.length === 0) {
        const headerOption = ast?.header?.option;
        if (Array.isArray(headerOption)) {
            values.push(...headerOption);
        } else if (typeof headerOption === 'string') {
            values.push(headerOption);
        }
    }

    const parsed = {};
    for (const raw of values) {
        const option = parseHeaderRendererOption(raw);
        if (option) {
            parsed[option[0]] = option[1];
        }
    }
    return parsed;
}

function ss(ctx, n) {
    return n * ctx.staffSpace;
}

function wrapSrc(item, svg, cls, staffBottomY, staffHeight, bboxX, bboxWidth) {
    if (item.srcStart === undefined || item.srcEnd === undefined) {
        return svg;
    }
    const staffAttrs = (staffBottomY !== undefined)
        ? ` data-staff-bottom="${staffBottomY}" data-staff-height="${staffHeight}"`
        : '';
    const bboxAttrs = (bboxX !== undefined && bboxWidth !== undefined)
        ? ` data-bbox-x="${bboxX}" data-bbox-width="${bboxWidth}"`
        : '';
    return `<g class="${cls}" data-src-start="${item.srcStart}" data-src-end="${item.srcEnd}"${staffAttrs}${bboxAttrs}>${svg}</g>`;
}

// CSS rules embedded in the SVG so a cursor-tracking script can toggle a
// single class to highlight the active note/token.
const HIGHLIGHT_STYLE = `<style>.aretino-active [fill]:not([fill="none"]):not(.aretino-cursor-bg){fill:#ea580c}.aretino-active [stroke]:not([stroke="none"]):not(.aretino-cursor-bg){stroke:#ea580c}</style>`;

function _flushBrace(ctx, parts, state, staffBottomY, isEnd, lyricFont) {
    const gap = ss(ctx, METRICS.overbraceGap);
    const staffTopY = staffBottomY - 4 * ctx.staffSpace;
    const topNoteY = state.minY < Infinity
        ? Math.min(state.minY, staffTopY)
        : staffTopY;
    
    const { braceKind, startX, endX, isStart, placeIdx, label } = state;
    let markY;
    let svg;
    if (braceKind === 'arc') {
        markY = topNoteY - gap;
        svg = drawOverarc(ctx, startX, endX, markY);
    } else if (braceKind === 'line') {
        markY = topNoteY - gap;
        svg = drawOverline(ctx, startX, endX, markY);
    } else {
        markY = topNoteY - gap * 1.5;
        svg = drawOverbrace(ctx, startX, endX, markY, isStart !== false, isEnd);
    }

    if (isEnd && label) {
        const fontSize = ctx.lyricSize * 0.8;
        const mx = (startX + endX) / 2;
        // Offset by the brace shape's height above markY so text clears the tallest part.
        let braceTopOffset;
        if (braceKind === 'arc') {
            // Cubic bezier midpoint sits at ~3/4 of the bulge above markY.
            braceTopOffset = ss(ctx, METRICS.overarcBulge) * 0.75;
        } else if (braceKind === 'line') {
            braceTopOffset = 0;
        } else {
            // Center V-tip only exists on the first/only segment of an overbrace.
            braceTopOffset = (isStart !== false) ? ss(ctx, METRICS.overbraceTipDepth) : 0;
        }
        const textY = markY - braceTopOffset - gap * 0.5 - fontSize * 0.15;
        svg += `<text x="${mx}" y="${textY}" font-family="${escapeAttr(lyricFont)}" font-size="${fontSize}" text-anchor="middle" fill="#000">${renderSegments(parseFormattingToSegments(label))}</text>`;
    }
    parts[placeIdx] = svg;
}

export function renderAretino(source, options = {}) {
    const ast = typeof source === 'string' ? parseAretino(source) : source;
    options = { ...parseHeaderRendererOptions(ast), ...options };

    // --- Sizing model -----------------------------------------------------
    // Everything is laid out in *logical units* where 1 unit = 1 px at the
    // given dpi with zoom = 1. Physical sizes (mm) map to logical units via
    // dpi; `zoom` then magnifies the *rendered* SVG without touching layout,
    // so line-breaking and proportions stay identical at any zoom.
    const dpi = options.dpi ?? DEFAULT_DPI;
    const pxPerMm = dpi / MM_PER_INCH;
    const zoom = Math.max(0.1, options.zoom ?? 1);

    // staffSpace drives every musical symbol and advance (via METRICS).
    const staffSpacePx = Math.max(0.1, options.staffSpaceMm ?? DEFAULT_STAFF_SPACE_MM) * pxPerMm;

    // Layout width = the width lines are broken to. Logical/physical only;
    // `width` (px) takes precedence over `widthMm`. Independent of zoom.
    const width = options.width != null
        ? options.width
        : Math.round((options.widthMm ?? DEFAULT_PAGE_WIDTH_MM) * pxPerMm);
    const canvasHeight = options.canvasHeight || null;
    const noteSpacing = Math.max(0.5, options.noteSpacing ?? 1);
    const lyricFont = options.lyricFont || DEFAULT_FONT;
    const hideRepeatClef = !!options.hideRepeatClef;

    // The whole engraving is parameterised by a single pixel-size: staffSpace.
    // Everything else (margins, advances, glyph dimensions) is a multiple of
    // it via METRICS.
    const ctx = {
        staffSpace: staffSpacePx,
    };
    ctx.pitchStep = ctx.staffSpace / 2;
    ctx.staffHeight = (METRICS.staffLineCount - 1) * ctx.staffSpace;
    ctx.singleNoteAdvance = ss(ctx, METRICS.singleNoteAdvance) * noteSpacing;
    ctx.ligatureStepAdvance = ss(ctx, METRICS.ligatureStepAdvance);
    ctx.expanderWidth = ss(ctx, METRICS.expanderWidth);
    ctx.neumeGapAdvance = ss(ctx, METRICS.neumeGapAdvance);
    ctx.leftMargin = ss(ctx, METRICS.leftMargin);
    ctx.rightMargin = ss(ctx, METRICS.rightMargin);
    ctx.staffGap = Math.max(0, ss(ctx, options.staffGap ?? METRICS.staffGap));
    ctx.lyricDistance = ss(ctx, options.lyricDistance ?? METRICS.lyricDistance);
    ctx.lyricFont = lyricFont;
    // Lyric font size in typographic points (default 12pt), converted to
    // logical units via dpi. Set independently of staff space and layout width.
    const lyricPt = Math.max(1, options.lyricSize ?? DEFAULT_LYRIC_SIZE_PT);
    ctx.lyricSize = lyricPt * dpi / 72;
    const lyricLineHeight = ctx.lyricSize * 1.2;

    const hasIndent = 'indent' in ast.header || 'behúzás' in ast.header;
    const indentText = hasIndent ? (ast.header['indent'] ?? ast.header['behúzás'] ?? '') : '';
    const indentFontSize = ctx.lyricSize * 0.85;
    const indentLines = indentText ? indentText.split('|').map(l => l.trim()) : [];
    let indentWidth = 0;
    if (hasIndent) {
        const maxTextW = indentLines.length > 0
            ? Math.max(...indentLines.map(l => measureSegmentsWidth(parseFormattingToSegments(l), indentFontSize, lyricFont)))
            : 0;
        indentWidth = Math.max(maxTextW + ctx.staffSpace * 1.5, ctx.staffSpace * 2);
    }

    const sections = groupSections(ast.lines);

    const parts = [];
    let currentClef = { letter: 'g', line: 2 };
    let currentKeySig = [];
    let hasSeenClef = false;
    let clefRowsBudget = hideRepeatClef ? 1 : Infinity;
    let firstSectionLayoutDone = false;
    let y = ss(ctx, METRICS.titleTopPadding);
    let contentBottom = y;

    if (ast.header && Object.keys(ast.header).length) {
        const title = ast.header['title'];
        const subtitle = ast.header['subtitle'];
        const titleFontSize = ctx.lyricSize * 1.2;
        const titleLineHeight = titleFontSize * 1.2;
        if (title) {                        
            const lines = title.split('|').map(l => l.trim());
            y += titleFontSize;
            for (let li = 0; li < lines.length; li++) {
                if (li > 0) y += titleLineHeight;
                parts.push(`<text x="${width / 2}" y="${y}" font-family="${escapeAttr(lyricFont)}" font-size="${titleFontSize}" font-weight="bold" text-anchor="middle" fill="#000">${renderSegments(parseFormattingToSegments(lines[li]))}</text>`);
            }
        }
        if (subtitle) {
            const subTitleFontSize = titleFontSize * 0.7;            
            const subTitleLineHeight = subTitleFontSize * 1.2;
            const lines = subtitle.split('|').map(l => l.trim());
            if (title) {
                y += titleLineHeight;
            }
            if (!title) y += subTitleFontSize;
            for (let li = 0; li < lines.length; li++) {
                if (li > 0) y += subTitleLineHeight;
                parts.push(`<text x="${width / 2}" y="${y}" font-family="${escapeAttr(lyricFont)}" font-size="${subTitleFontSize}" font-weight="bold" text-anchor="middle" fill="#000">${renderSegments(parseFormattingToSegments(lines[li]))}</text>`);
            }            
        }
        y += titleLineHeight * 1.2;        
        const caption = ast.header['caption'];
        const rubric = ast.header['rubric'];
        if (caption || rubric) {
            const fontSize = ctx.lyricSize * 0.95;
            const lineHeight = fontSize * 1.2;
            const rubricLines = rubric ? rubric.split('|').map(l => l.trim()) : [];
            const captionLines = caption ? caption.split('|').map(l => l.trim()) : [];
            const maxLines = Math.max(rubricLines.length, captionLines.length);
            const rubricTop = maxLines - rubricLines.length;
            const captionTop = maxLines - captionLines.length;
            y += fontSize;
            for (let li = 0; li < maxLines; li++) {
                if (li > 0) y += lineHeight;
                const ri = li - rubricTop;
                const ci = li - captionTop;
                if (ri >= 0) {
                    parts.push(`<text x="${ctx.leftMargin}" y="${y - 1.4 * ctx.staffSpace}" font-family="${escapeAttr(lyricFont)}" font-size="${fontSize}" font-variant="small-caps" text-anchor="start" fill="#000">${renderSegments(parseFormattingToSegments(rubricLines[ri]))}</text>`);
                }
                if (ci >= 0) {
                    parts.push(`<text x="${width - ctx.rightMargin}" y="${y}" font-family="${escapeAttr(lyricFont)}" font-size="${fontSize}" font-style="italic" text-anchor="end" fill="#000">${renderSegments(parseFormattingToSegments(captionLines[ci]))}</text>`);
                }
            }
            y += fontSize * 0.4;
        }
    }

    const staffRightX = width - ctx.rightMargin;

    for (const sec of sections) {
        const items = flattenItems(sec.tokens);
        const sectionHasClef = items.some(it => it.kind === 'clef');
        if (sectionHasClef) {
            hasSeenClef = true;
        }
        const drawClefForRows = hasSeenClef;

        const verseSyllables = sec.lyrics.map(parseSyllables);
        const verseNotes = verseSyllables.map(arr => expandSyllablesForLigatures(arr.filter(s => s.kind === 'note')));
        const verseBarlines = verseSyllables.map(arr => arr.filter(s => s.kind === 'barline'));
        const verseCount = sec.lyrics.length;
        const totalLigatures = items.reduce((n, it) => n + (it.kind === 'ligature' ? 1 : 0), 0);
        const alignSyllables = totalLigatures > 0 && verseCount > 0;
        const hasBarlineLabels = verseBarlines.some(arr => arr.length > 0);

        // For each barline item in the music sequence, record how many ligatures
        // precede it. Used to match lyric barline labels (which carry notesBefore)
        // to the correct actual barline rather than by parallel index.
        let _lc = 0;
        const barlineLigsBefore = [];
        for (const it of items) {
            if (it.kind === 'ligature') { _lc++; }
            else if (it.kind === 'barline') { barlineLigsBefore.push(_lc); }
        }

        // Build per-verse maps: globalBarlineIdx → label.
        // A label with notesBefore=K targets the first barline where ligsBefore >= K.
        const verseBarlineMaps = verseBarlines.map(lbls => {
            const m = new Map();
            for (const lbl of lbls) {
                const K = lbl.notesBefore ?? 0;
                for (let bi = 0; bi < barlineLigsBefore.length; bi++) {
                    if (barlineLigsBefore[bi] >= K && !m.has(bi)) {
                        m.set(bi, lbl);
                        break;
                    }
                }
            }
            return m;
        });

        // Reserve extra advance after a neume whose syllable is wider than the
        // neume's natural trailing slack, so the next neume isn't overlapped.
        if (alignSyllables) {
            // Inter-word gap reserved between neumes must match the gap the
            // lyric layout actually renders (a real space character), so the
            // note spacing follows the widened word break.
            const minGap = measureTextWidth(' ', ctx.lyricSize, ctx.lyricFont) || ctx.lyricSize * 0.25;
            const halfNoteW = ss(ctx, METRICS.noteBoxWidth) * 0.5;
            const ligInfo = [];
            let li = 0;
            for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
                const it = items[itemIdx];
                if (it.kind !== 'ligature') {
                    continue;
                }
                let maxSylW = 0;
                for (const notes of verseNotes) {
                    if (li < notes.length) {
                        const w = measureSegmentsWidth(notes[li].alignSegments || notes[li].segments, ctx.lyricSize, ctx.lyricFont);
                        if (w > maxSylW) {
                            maxSylW = w;
                        }
                    }
                }
                const totalNotes = it.groups.reduce((sum, g) => sum + g.length, 0);
                const lastG = it.groups[it.groups.length - 1];
                const lastN = lastG?.[lastG.length - 1];
                const isCentered = totalNotes === 1
                    && !it.groups.some(g => g.some(n => n.shape === 'tenor'));
                ligInfo.push({ item: it, maxSylW, isCentered, itemIdx });
                li++;
            }
            for (let i = 0; i < ligInfo.length; i++) {
                const { item, maxSylW, isCentered } = ligInfo[i];
                const baseAdv = measureLigature(ctx, item.groups, item.gaps ?? []);
                // Current syllable's right-edge offset from the ligature's left.
                const currRight = isCentered ? halfNoteW + maxSylW / 2 : maxSylW;
                // How far the next syllable extends to the left of the next ligature's
                // start (positive = intrudes). Only centered syllables intrude leftward.
                // If a barline sits between the two ligatures, the barline provides
                // visual separation so the next syllable cannot intrude leftward.
                const hasBarlineBetween = i + 1 < ligInfo.length
                    && items.slice(ligInfo[i].itemIdx + 1, ligInfo[i + 1].itemIdx).some(it => it.kind === 'barline');
                let nextLeftIntrusion = 0;
                if (i + 1 < ligInfo.length && !hasBarlineBetween) {
                    const next = ligInfo[i + 1];
                    if (next.isCentered) {
                        nextLeftIntrusion = Math.max(0, next.maxSylW / 2 - halfNoteW);
                    }
                } else if (hasBarlineBetween && i + 1 < ligInfo.length) {
                    // The next syllable's leftward intrusion relative to its ligature
                    // start may eat into the barline's post-gap. Assign any excess as
                    // barlinePostExtra on the last barline before that ligature.
                    const next = ligInfo[i + 1];
                    const nextIntrusion = next.isCentered
                        ? Math.max(0, next.maxSylW / 2 - halfNoteW)
                        : 0;
                    if (nextIntrusion > 0) {
                        const barlinePostGapPx = ss(ctx, METRICS.barlinePostGap);
                        // Subtract the existing post-gap but require at least minGap
                        // clearance so the syllable stays minGap away from any barline
                        // text/label whose right half already sits inside that post-gap.
                        const postExtra = Math.max(0, nextIntrusion + minGap - barlinePostGapPx);
                        if (postExtra > 0) {
                            // Find the last barline between the two ligatures.
                            for (let k = ligInfo[i + 1].itemIdx - 1; k > ligInfo[i].itemIdx; k--) {
                                if (items[k].kind === 'barline') {
                                    items[k].barlinePostExtra = Math.max(items[k].barlinePostExtra || 0, postExtra);
                                    break;
                                }
                            }
                        }
                    }
                }
                // Hyphen-joined syllables ("Ki-rá-lyok") butt up against each other;
                // a gap (filled with a hyphen) only appears when the neumes are
                // naturally wider than the syllables. Separate words ("Ki rá lyok")
                // still need a minimum gap between them.
                let pairConnected = false;
                if (i + 1 < ligInfo.length && !hasBarlineBetween) {
                    let pairExists = false;
                    let allHyphenated = true;
                    for (const notes of verseNotes) {
                        if (i < notes.length && i + 1 < notes.length) {
                            pairExists = true;
                            if (!notes[i].hyphenAfter) {
                                allHyphenated = false;
                                break;
                            }
                        }
                    }
                    pairConnected = pairExists && allHyphenated;
                }
                const gap = pairConnected ? 0 : minGap;
                item.syllableExtra = Math.max(0, currRight + nextLeftIntrusion + gap - baseAdv);
            }
        }

        // Reserve extra space around barlines that carry a label, so the
        // centered label doesn't overlap neighboring ligature syllables.
        // The label is centered on the barline, so its left edge sits maxW/2
        // to the left of the barline center. We need extra/2 >= maxW/2 + sideGap
        // on each side, i.e. extra >= maxW + 2*sideGap, where sideGap is one
        // lyric space width.
        if (hasBarlineLabels) {
            const lyricSpace = measureTextWidth(' ', ctx.lyricSize, ctx.lyricFont) || ctx.lyricSize * 0.25;
            let bi = 0;
            for (const it of items) {
                if (it.kind !== 'barline') {
                    continue;
                }
                let maxW = 0;
                for (const barlineMap of verseBarlineMaps) {
                    const lbl = barlineMap.get(bi);
                    if (lbl) {
                        const w = measureSegmentsWidth(lbl.segments, ctx.lyricSize, ctx.lyricFont);
                        if (w > maxW) { maxW = w; }
                    }
                }
                if (maxW > 0) {
                    const baseAdv = measureBarline(ctx, it.value);
                    it.barlineExtra = Math.max(0, maxW + 2 * lyricSpace - baseAdv);
                }
                bi++;
            }
        }

        const allowedClefRows = drawClefForRows ? clefRowsBudget : 0;
        const firstRowIndent = firstSectionLayoutDone ? 0 : indentWidth;
        firstSectionLayoutDone = true;
        const rows = layoutRowsWithCourtesyAccidentals(items, ctx, currentClef, staffRightX, drawClefForRows, currentKeySig, allowedClefRows, firstRowIndent);

        if (hideRepeatClef) {
            const clefRowsUsed = rows.filter(r => r.drawStartClef).length;
            clefRowsBudget = Math.max(0, clefRowsBudget - clefRowsUsed);
        }

        // For lyric-only sections (no music), still emit one empty row so lyrics render.
        if (rows.length === 0 && sec.lyrics.length > 0) {
            const emptyRowDrawClef = drawClefForRows && clefRowsBudget > 0;
            if (hideRepeatClef && emptyRowDrawClef) {
                clefRowsBudget = 0;
            }
            rows.push({
                items: [],
                itemsWidth: 0,
                justify: false,
                startClef: currentClef,
                startKeySig: currentKeySig,
                drawStartClef: emptyRowDrawClef,
                indentWidth: firstRowIndent,
            });
        }

        let ligOffset = 0;
        let globalBarlineIdx = 0;
        let sectionContentBottom = y;
        // parenState is kept across rows so that a parenthesised group that spans
        // a line break still gets rendered (opening arc on each row, closing arc
        // on each row where the group continues or ends).
        let parenState = null;
        // braceState tracks an open { } or \arc{ } span across rows similarly.
        let braceState = null;

        // Pre-scan: only render a brace span when both { and } are present.
        const completedBraceOpens = new Set();
        let pendingBraceOpen = null;
        for (const row of rows) {
            for (const it of row.items) {
                if (it.kind === 'brace-open') {
                    pendingBraceOpen = it;
                } else if (it.kind === 'brace-close' && pendingBraceOpen) {
                    completedBraceOpens.add(pendingBraceOpen);
                    pendingBraceOpen = null;
                }
            }
        }

        rows.forEach((row, rowIdx) => {
            const rowIndent = row.indentWidth || 0;
            const staffLeftX = ctx.leftMargin + rowIndent;
            const staffBottomY = y + ctx.staffHeight;
            parts.push(drawStaffLines(ctx, staffLeftX, staffRightX, staffBottomY));

            if (rowIndent > 0 && indentLines.length > 0) {
                const tx = ctx.leftMargin + rowIndent / 2;
                const indentLineHeight = indentFontSize * 1.2;
                const blockFirstY = staffBottomY - ctx.staffHeight / 2 + indentFontSize * 0.35
                    - (indentLines.length - 1) * indentLineHeight / 2;
                for (let li = 0; li < indentLines.length; li++) {
                    parts.push(`<text x="${tx}" y="${blockFirstY + li * indentLineHeight}" font-family="${escapeAttr(lyricFont)}" font-size="${indentFontSize}" text-anchor="middle" fill="#000">${renderSegments(parseFormattingToSegments(indentLines[li]))}</text>`);
                }
            }

            let cursorX = staffLeftX;
            const rowLigatures = [];
            const rowBarlines = [];

            if (row.drawStartClef) {
                const c = drawClef(ctx, row.startClef, cursorX, staffBottomY);
                parts.push(wrapSrc(row.startClefSource || {}, c.svg, 'aretino-token aretino-clef', staffBottomY, ctx.staffHeight));
                cursorX += c.advance - ss(ctx, METRICS.clefPostGap) + ss(ctx, METRICS.clefInlinePostGap);
            }

            const startKeySig = row.startKeySig ?? [];
            for (const acc of startKeySig) {
                const a = drawAccidental(ctx, acc.pitch, acc.symbol, cursorX, staffBottomY, acc.high ?? false);
                parts.push(a.svg);
                cursorX += a.advance;
            }

            // Add proper spacing after clef/key sig and before notes
            if (row.drawStartClef || startKeySig.length > 0) {
                if (startKeySig.length === 0) {
                    cursorX += ss(ctx, METRICS.clefPostGap);
                } else {
                    cursorX += ss(ctx, 1);
                }
            } else {
                // No clef and no key sig: still add one staff space of emptiness
                cursorX += ctx.staffSpace;
            }

            const remaining = staffRightX - cursorX;
            const extra = Math.max(0, remaining - row.itemsWidth);
            const expanderCount = row.items.reduce((n, it) => n + (it.kind === 'expander' ? 1 : 0), 0);
            // Accidental+ligature pairs are glued — don't count them as a gap.
            const gluedPairs = row.items.reduce((n, it, i) => n + (it.kind === 'accidental' && i + 1 < row.items.length && row.items[i + 1].kind === 'ligature' ? 1 : 0), 0);
            const gapCount = Math.max(0, row.items.length - 1 - gluedPairs);
            let extraPerExpander = 0;
            let extraPerGap = 0;
            if (row.justify && extra > 0) {
                if (expanderCount > 0) {
                    extraPerExpander = extra / expanderCount;
                } else if (gapCount > 0) {
                    extraPerGap = extra / gapCount;
                }
            }

            // If a parenthesised group carried over from the previous row, open a
            // new left-paren arc at the start of this row before the first item.
            if (parenState) {
                const placeIdx = parts.length;
                parts.push('');
                cursorX += ss(ctx, METRICS.parenthesisWidth);
                const hingeX = cursorX;
                cursorX += ss(ctx, METRICS.parenthesisInnerGap);
                parenState = { placeIdx, hingeX, closeHingeX: hingeX, minY: Infinity, maxY: -Infinity };
            }

            // If a brace/arc span carried over from the previous row, start a new
            // segment on this row from the current cursor position.
            if (braceState) {
                const placeIdx = parts.length;
                parts.push('');
                braceState = { ...braceState, placeIdx, startX: cursorX, endX: cursorX, minY: Infinity, isStart: false };
            }

            for (let idx = 0; idx < row.items.length; idx++) {
                const it = row.items[idx];
                if (it.kind === 'clef') {
                    const c = drawClef(ctx, it.clef, cursorX, staffBottomY);
                    parts.push(wrapSrc(it, c.svg, 'aretino-token aretino-clef', staffBottomY, ctx.staffHeight));
                    cursorX += c.advance + ss(ctx, METRICS.clefInlinePostGap);
                } else if (it.kind === 'accidental') {
                    const a = drawAccidental(ctx, it.pitch, it.symbol, cursorX, staffBottomY, it.high ?? false);
                    parts.push(wrapSrc(it, a.svg, 'aretino-token aretino-accidental', staffBottomY, ctx.staffHeight));
                    let adv = a.advance;
                    if (it.symbol === 'x') adv = Math.max(adv, ss(ctx, METRICS.accidentalAdvanceFlat));
                    else if (it.symbol === 'y') adv = Math.max(adv, ss(ctx, METRICS.accidentalAdvanceNatural));
                    else if (it.symbol === '#') adv = Math.max(adv, ss(ctx, METRICS.accidentalAdvanceSharp));
                    cursorX += adv;
                } else if (it.kind === 'keysig') {
                    const startX = cursorX;
                    const pieces = [];
                    for (const acc of it.accidentals) {
                        const a = drawAccidental(ctx, acc.pitch, acc.symbol, cursorX, staffBottomY, acc.high ?? false);
                        pieces.push(a.svg);
                        cursorX += a.advance;
                    }
                    if (pieces.length) {
                        parts.push(wrapSrc(it, pieces.join(''), 'aretino-token aretino-keysig', staffBottomY, ctx.staffHeight));
                    } else {
                        // Empty (K:) — clears signature; nothing to draw.
                        cursorX = startX;
                    }
                } else if (it.kind === 'expander') {
                    cursorX += ctx.expanderWidth + extraPerExpander;
                } else if (it.kind === 'barline') {
                    const extra = it.barlineExtra || 0;
                    const postExtra = it.barlinePostExtra || 0;
                    cursorX += extra / 2;
                    const b = drawBarline(ctx, it.value, cursorX, staffBottomY);
                    parts.push(wrapSrc(it, b.svg, 'aretino-token aretino-barline', staffBottomY, ctx.staffHeight));
                    const offsetX = (it.value === '||' || it.value === ':|' || it.value === '|:' || it.value === ':|:' || it.value === '|||')
                        ? (METRICS.barlineOffsetX + METRICS.barlineDoubleSecondOffsetX) / 2
                        : METRICS.barlineOffsetX;
                    rowBarlines.push({ centerX: cursorX + ss(ctx, offsetX), value: it.value, globalIdx: globalBarlineIdx });
                    globalBarlineIdx++;
                    cursorX += b.advance + ss(ctx, METRICS.barlinePostGap) + extra / 2 + postExtra;
                } else if (it.kind === 'spacer') {
                    cursorX += ss(ctx, METRICS.spacerAdvance) * it.multiplier;
                } else if (it.kind === 'paren-open') {
                    const placeIdx = parts.length;
                    parts.push('');
                    cursorX += ss(ctx, METRICS.parenthesisWidth);
                    const hingeX = cursorX;
                    cursorX += ss(ctx, METRICS.parenthesisInnerGap);
                    parenState = { placeIdx, hingeX, closeHingeX: hingeX, minY: Infinity, maxY: -Infinity };
                } else if (it.kind === 'paren-close') {
                    if (parenState) {
                        const vPad = ss(ctx, METRICS.parenthesisVPadding);
                        const spanTop = parenState.minY - vPad;
                        const spanBot = parenState.maxY + vPad;
                        const parenWidth = ss(ctx, METRICS.parenthesisWidth);
                        const innerGap = ss(ctx, METRICS.parenthesisInnerGap);
                        parts[parenState.placeIdx] = drawParenthesis(ctx, parenState.hingeX, spanTop, spanBot, 'left');
                        parts.push(drawParenthesis(ctx, parenState.closeHingeX - innerGap - parenWidth, spanTop, spanBot, 'right'));
                        parenState = null;
                    }
                    cursorX += ss(ctx, METRICS.parenthesisInnerGap) + ss(ctx, METRICS.parenthesisWidth);
                } else if (it.kind === 'brace-open') {
                    if (completedBraceOpens.has(it)) {
                        const placeIdx = parts.length;
                        parts.push('');
                        braceState = { placeIdx, braceKind: it.braceKind, startX: cursorX, endX: cursorX, minY: Infinity, isStart: true };
                    }
                } else if (it.kind === 'brace-close') {
                    if (braceState) {
                        braceState.label = it.label ?? null;
                        _flushBrace(ctx, parts, braceState, staffBottomY, true, lyricFont);
                        braceState = null;
                    }
                } else if (it.kind === 'ligature') {
                    const r = emitLigature(ctx, it.groups, cursorX, staffBottomY, it.gaps ?? [], it.leadingCourtesyAccidentals ?? []);
                    let ligSvg = r.svg;
                    if (it.label != null && r.minY < Infinity) {
                        const fontSize = ctx.lyricSize * 0.8;
                        const staffTopY = staffBottomY - 4 * ctx.staffSpace - ctx.lyricSize * 0.16;
                        const labelY = Math.min(r.minY, staffTopY) - fontSize * 0.15;
                        ligSvg += `<text x="${r.leftX}" y="${labelY}" font-family="${escapeAttr(ctx.lyricFont)}" font-size="${fontSize}" text-anchor="start" fill="#000">${renderSegments(parseFormattingToSegments(it.label))}</text>`;
                    }
                    parts.push(wrapSrc(it, ligSvg, 'aretino-token aretino-ligature', staffBottomY, ctx.staffHeight, r.leftX, r.rightX - r.leftX));
                    rowLigatures.push({ centerX: r.centerX, leftX: r.leftX, shouldAlignLeft: r.shouldAlignLeft });
                    if (parenState) {
                        if (r.minY < parenState.minY) parenState.minY = r.minY;
                        if (r.maxY > parenState.maxY) parenState.maxY = r.maxY;
                        parenState.closeHingeX = cursorX + r.advance;
                    }
                    if (braceState) {
                        if (r.minY < braceState.minY) braceState.minY = r.minY;
                        braceState.endX = r.rightX;
                    }
                    cursorX += r.advance + (it.syllableExtra || 0);
                }
                if (idx < row.items.length - 1 && extraPerGap > 0) {
                    // Don't insert justification gap between an accidental and its neume.
                    const nextIt = row.items[idx + 1];
                    if (!(it.kind === 'accidental' && nextIt.kind === 'ligature')) {
                        cursorX += extraPerGap;
                    }
                }
            }

            // If a parenthesised group was opened on this row but its paren-close
            // sits on a later row, close the arcs visually here and carry the open
            // state to the next row.
            if (parenState) {
                const vPad = ss(ctx, METRICS.parenthesisVPadding);
                const spanTop = parenState.minY < Infinity ? parenState.minY - vPad : staffBottomY - 4 * ctx.staffSpace - vPad;
                const spanBot = parenState.maxY > -Infinity ? parenState.maxY + vPad : staffBottomY + vPad;
                const parenWidth = ss(ctx, METRICS.parenthesisWidth);
                const innerGap = ss(ctx, METRICS.parenthesisInnerGap);
                parts[parenState.placeIdx] = drawParenthesis(ctx, parenState.hingeX, spanTop, spanBot, 'left');
                parts.push(drawParenthesis(ctx, parenState.closeHingeX - innerGap - parenWidth, spanTop, spanBot, 'right'));
                // Signal the next row to re-open the group (parenState truthy = continuation).
                parenState = { continuation: true };
            }

            // If a brace/arc span was opened on this row but its close is on a
            // later row, draw this row's segment and carry the state forward.
            if (braceState) {
                _flushBrace(ctx, parts, braceState, staffBottomY, false, lyricFont);
                braceState = { braceKind: braceState.braceKind, label: braceState.label, continuation: true };
            }

            const isLastRow = rowIdx === rows.length - 1;
            const rowLigCount = rowLigatures.length;
            const lowestNoteY = rowLowestNoteY(ctx, row, staffBottomY);
            const lyricTopY = lowestNoteY > staffBottomY
                ? lowestNoteY + ctx.lyricDistance
                : staffBottomY + ctx.lyricDistance;
            let lyricY = lyricTopY + ctx.lyricSize;

            if (alignSyllables) {
                for (let v = 0; v < verseCount; v++) {
                    const notes = verseNotes[v];
                    const start = ligOffset;
                    const end = isLastRow
                        ? Math.max(notes.length, ligOffset + rowLigCount)
                        : ligOffset + rowLigCount;
                    const rowSyllables = notes.slice(start, end);
                    parts.push(emitAlignedSyllables(ctx, rowSyllables, rowLigatures, lyricY));
                    const barlineMap = verseBarlineMaps[v];
                    const matchedLabels = [];
                    const matchedBarlines = [];
                    for (const rb of rowBarlines) {
                        const lbl = barlineMap.get(rb.globalIdx);
                        if (lbl) {
                            matchedLabels.push(lbl);
                            matchedBarlines.push(rb);
                        }
                    }
                    if (matchedLabels.length > 0) {
                        parts.push(emitBarlineLabels(ctx, matchedLabels, matchedBarlines, lyricY));
                    }
                    lyricY += lyricLineHeight;
                }
                ligOffset += rowLigCount;
                // lyricY has advanced one full line past the last rendered baseline;
                // only add descender clearance, not another full line height.
                const lastLyricBottom = lyricY - lyricLineHeight + ctx.lyricSize * 0.3;
                contentBottom = Math.max(contentBottom, lastLyricBottom);
                sectionContentBottom = lastLyricBottom;
                y = lastLyricBottom + ctx.staffGap;
            } else if (isLastRow && verseCount > 0) {
                for (const lyric of sec.lyrics) {
                    const lyricSvg = `<text xml:space="preserve" x="${staffLeftX}" y="${lyricY}" font-family="${escapeAttr(ctx.lyricFont)}" font-size="${ctx.lyricSize}" fill="#000">${formatLyricLine(lyric)}</text>`;
                    parts.push(wrapSrc(lyric, lyricSvg, 'aretino-lyric aretino-lyric-line'));
                    lyricY += lyricLineHeight;
                }
                const lastLyricBottom = lyricY - lyricLineHeight + ctx.lyricSize * 0.3;
                contentBottom = Math.max(contentBottom, lastLyricBottom);
                sectionContentBottom = lastLyricBottom;
                y = lastLyricBottom + ctx.staffGap;
            } else {
                y = staffBottomY + ctx.staffGap;
                sectionContentBottom = y;
                contentBottom = Math.max(contentBottom, y);
            }
        });

        if (sec.verses && sec.verses.length > 0) {
            const verseResult = renderVerseLines(ctx, sec.verses, ctx.leftMargin, staffRightX, sectionContentBottom);
            parts.push(verseResult.svg);
            y = verseResult.bottom + ctx.staffGap;
            contentBottom = Math.max(contentBottom, verseResult.bottom);
        }

        currentClef = trailingClef(items, currentClef);
        currentKeySig = trailingKeySig(items, currentKeySig);
    }

    const totalHeight = canvasHeight || Math.max(contentBottom, y + ctx.staffSpace, 100);
    // viewBox is the logical layout space; the intrinsic width/height are the
    // physical pixel size magnified by `zoom`. Emitting concrete dimensions
    // (rather than width="100%") means a staff space renders at its true
    // physical size regardless of container width. Consumers that want
    // shrink-to-fit can add `max-width:100%;height:auto` in CSS.
    const renderW = Math.round(width * zoom);
    const renderH = Math.round(totalHeight * zoom);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${totalHeight}" width="${renderW}" height="${renderH}" preserveAspectRatio="xMidYMin meet" style="display:block">${HIGHLIGHT_STYLE}${parts.join('')}</svg>`;
}

function trailingClef(items, fallback) {
    for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].kind === 'clef') {
            return items[i].clef;
        }
    }
    return fallback;
}

function trailingKeySig(items, fallback) {
    for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].kind === 'keysig') {
            return items[i].accidentals;
        }
    }
    return fallback;
}

// A section bundles music tokens and lyric lines separated from other sections
// by a blank line (empty line). A new section starts only on a blank line —
// single linebreaks in either the notation or w: parts do not break sections.
function groupSections(lines) {
    const sections = [];
    let pending = null;

    function flushPending() {
        if (pending && (pending.tokens.length > 0 || pending.lyrics.length > 0 || pending.verses.length > 0)) {
            sections.push(pending);
        }
        pending = null;
    }

    for (const item of lines) {
        if (item.type === 'blank') {
            flushPending();
            continue;
        }
        if (!pending) {
            pending = { tokens: [], lyrics: [], verses: [] };
        }
        if (item.type === 'music') {
            pending.tokens.push(...item.tokens);
        } else if (item.type === 'lyrics') {
            pending.lyrics.push(item);
        } else if (item.type === 'verse') {
            pending.verses.push(item.lines);
        }
    }
    flushPending();
    return sections;
}

function flattenItems(tokens) {
    const items = [];
    for (const tok of tokens) {
        const src = { srcStart: tok.srcStart, srcEnd: tok.srcEnd };
        if (tok.type === 'directive') {
            const v = tok.value;
            const clefM = v.match(/^([gfcGFC])([0-9])$/);
            if (clefM) {
                items.push({ kind: 'clef', clef: { letter: clefM[1].toLowerCase(), line: parseInt(clefM[2], 10) }, ...src });
                continue;
            }
            const accM = matchAccidental(v);
            if (accM) {
                items.push({ kind: 'accidental', pitch: accM.pitch, symbol: accM.symbol, ...(accM.high ? { high: accM.high } : {}), ...src });
                continue;
            }
            const keyM = v.match(/^K:\s*(.*)$/);
            if (keyM) {
                const inner = keyM[1].trim();
                const accidentals = [];
                if (inner) {
                    for (const part of inner.split(/\s+/)) {
                        const acc = matchAccidental(part);
                        if (acc) {
                            accidentals.push({ pitch: acc.pitch, symbol: acc.symbol, ...(acc.high ? { high: acc.high } : {}) });
                        }
                    }
                }
                items.push({ kind: 'keysig', accidentals, ...src });
                continue;
            }
            if (v === 'z') {
                items.push({ kind: 'break', justify: true, ...src });
                continue;
            }
            if (v === 'Z') {
                items.push({ kind: 'break', justify: false, ...src });
                continue;
            }
            continue;
        }
        if (tok.type === 'expander') {
            items.push({ kind: 'expander', ...src });
            continue;
        }
        if (tok.type === 'barline') {
            items.push({ kind: 'barline', value: tok.kind, ...src });
            continue;
        }
        if (tok.type === 'spacer') {
            items.push({ kind: 'spacer', multiplier: tok.multiplier, ...src });
            continue;
        }
        if (tok.type === 'paren-open') {
            items.push({ kind: 'paren-open', ...src });
            continue;
        }
        if (tok.type === 'paren-close') {
            items.push({ kind: 'paren-close', ...src });
            continue;
        }
        if (tok.type === 'brace-open') {
            items.push({ kind: 'brace-open', braceKind: tok.kind, ...src });
            continue;
        }
        if (tok.type === 'brace-close') {
            items.push({ kind: 'brace-close', ...(tok.label != null ? { label: tok.label } : {}), ...src });
            continue;
        }
        if (tok.type === 'ligature') {
            items.push({ kind: 'ligature', groups: tok.groups, gaps: tok.gaps ?? [], ...(tok.label != null ? { label: tok.label } : {}), ...src });
            continue;
        }
    }
    return items;
}

// Mirrors the advance returned by drawClef in glyphs.js. We need it during
// the line-fit pass before any drawing happens.
function clefAdvance(ctx, clef) {
    const letter = (clef.letter || 'g').toLowerCase();
    const k = ctx.staffSpace / 591;
    if (letter === 'g') {
        return (2621 - 1186) * k + ss(ctx, METRICS.clefPostGap);
    }
    if (letter === 'f') {
        return (2889 - 1239) * k + ss(ctx, METRICS.clefPostGap);
    }
    if (letter === 'c') {
        return ss(ctx, METRICS.clefCWidth) + ss(ctx, METRICS.clefCRightPadding);
    }
    return 0;
}

function accidentalSymbolAdvance(ctx, symbol) {
    if (symbol === 'y') return ss(ctx, METRICS.accidentalAdvanceNatural);
    if (symbol === '#') return ss(ctx, METRICS.accidentalAdvanceSharp);
    return ss(ctx, METRICS.accidentalAdvanceFlat);
}

function accidentalAdvance(ctx, acc) {
    return accidentalSymbolAdvance(ctx, acc.symbol);
}

function accidentalListAdvance(ctx, accidentals) {
    if (!accidentals?.length) {
        return 0;
    }
    return accidentals.reduce((sum, acc) => sum + accidentalAdvance(ctx, acc), 0);
}

function accidentalKey(acc) {
    return `${pitchToPos(acc)}`;
}

function noteAccidentalKey(note) {
    return `${pitchToPos(note)}`;
}

function copyAccidental(acc) {
    return { pitch: acc.pitch, symbol: acc.symbol, ...(acc.high ? { high: true } : {}) };
}

function setActiveAccidental(active, acc) {
    active.set(accidentalKey(acc), copyAccidental(acc));
}

function clearCourtesyAccidentals(items) {
    for (const item of items) {
        if (item.kind === 'ligature') {
            delete item.leadingCourtesyAccidentals;
        }
    }
}

function courtesySignature(items) {
    return items
        .map((item, idx) => {
            if (item.kind !== 'ligature' || !item.leadingCourtesyAccidentals?.length) {
                return '';
            }
            const keys = item.leadingCourtesyAccidentals
                .map(acc => `${accidentalKey(acc)}=${acc.symbol}`)
                .join(',');
            return `${idx}:${keys}`;
        })
        .filter(Boolean)
        .join('|');
}

function updateActiveAccidentalsFromLigature(ligature, active, pendingCourtesy = null) {
    const courtesyByKey = new Map();
    for (const group of ligature.groups) {
        for (const note of group) {
            if (note.accidental) {
                const key = accidentalKey(note.accidental);
                pendingCourtesy?.delete(key);
                setActiveAccidental(active, note.accidental);
            }

            const noteKey = noteAccidentalKey(note);
            if (pendingCourtesy?.has(noteKey) && !courtesyByKey.has(noteKey)) {
                courtesyByKey.set(noteKey, copyAccidental(pendingCourtesy.get(noteKey)));
                pendingCourtesy.delete(noteKey);
            }
        }
    }
    return Array.from(courtesyByKey.values());
}

function annotateCourtesyAccidentals(items, rows) {
    clearCourtesyAccidentals(items);
    const active = new Map();

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        const pendingCourtesy = rowIdx === 0 ? new Map() : new Map(active);

        for (const item of row.items) {
            if (item.kind === 'barline') {
                active.clear();
                pendingCourtesy.clear();
                continue;
            }

            if (item.kind === 'accidental') {
                pendingCourtesy.delete(accidentalKey(item));
                setActiveAccidental(active, item);
                continue;
            }

            if (item.kind === 'ligature') {
                const courtesy = updateActiveAccidentalsFromLigature(item, active, pendingCourtesy);
                if (courtesy.length > 0) {
                    item.leadingCourtesyAccidentals = courtesy;
                }
            }
        }
    }

    return courtesySignature(items);
}

function layoutRowsWithCourtesyAccidentals(items, ctx, initialClef, staffRightX, drawStartClef, initialKeySig, allowedClefRows = Infinity, firstRowIndentWidth = 0) {
    clearCourtesyAccidentals(items);
    let previousSignature = null;
    let rows = [];

    for (let pass = 0; pass < 8; pass++) {
        rows = layoutRows(items, ctx, initialClef, staffRightX, drawStartClef, initialKeySig, allowedClefRows, firstRowIndentWidth);
        const signature = annotateCourtesyAccidentals(items, rows);
        if (signature === previousSignature) {
            return rows;
        }
        previousSignature = signature;
    }

    rows = layoutRows(items, ctx, initialClef, staffRightX, drawStartClef, initialKeySig, allowedClefRows, firstRowIndentWidth);
    annotateCourtesyAccidentals(items, rows);
    return rows;
}

function keySigAdvance(ctx, accidentals) {
    if (!accidentals?.length) return 0;
    return accidentals.reduce((sum, acc) => sum + accidentalSymbolAdvance(ctx, acc.symbol), 0);
}

function measureItem(ctx, item) {
    if (item.kind === 'clef') {
        return clefAdvance(ctx, item.clef) + ss(ctx, METRICS.clefInlinePostGap);
    }
    if (item.kind === 'accidental') {
        if (item.symbol === 'x') return ss(ctx, METRICS.accidentalAdvanceFlat);
        if (item.symbol === 'y') return ss(ctx, METRICS.accidentalAdvanceNatural);
        if (item.symbol === '#') return ss(ctx, METRICS.accidentalAdvanceSharp);
        return ss(ctx, METRICS.accidentalAdvanceFlat); // fallback
    }
    if (item.kind === 'keysig') {
        return keySigAdvance(ctx, item.accidentals);
    }
    if (item.kind === 'barline') {
        return measureBarline(ctx, item.value) + (item.barlineExtra || 0) + (item.barlinePostExtra || 0);
    }
    if (item.kind === 'spacer') {
        return ss(ctx, METRICS.spacerAdvance) * item.multiplier;
    }
    if (item.kind === 'expander') {
        return ctx.expanderWidth;
    }
    if (item.kind === 'paren-open' || item.kind === 'paren-close') {
        return ss(ctx, METRICS.parenthesisWidth) + ss(ctx, METRICS.parenthesisInnerGap);
    }
    if (item.kind === 'brace-open' || item.kind === 'brace-close') {
        return 0;
    }
    if (item.kind === 'ligature') {
        return accidentalListAdvance(ctx, item.leadingCourtesyAccidentals)
            + measureLigature(ctx, item.groups, item.gaps ?? [])
            + (item.syllableExtra || 0);
    }
    return 0;
}

// Greedy line-fit. Walks items, accumulating widths, breaking before any
// item that would push the row past the right margin. Explicit (z)/(Z)
// directives appear as `break` items and force a row finalization.
function layoutRows(items, ctx, initialClef, staffRightX, drawStartClef, initialKeySig, allowedClefRows = Infinity, firstRowIndentWidth = 0) {
    const rows = [];
    let cur = [];
    let curWidth = 0;
    let rowStartClef = initialClef;
    let rowStartClefSource = null;
    let runningClef = initialClef;
    let rowStartKeySig = initialKeySig ?? [];
    let runningKeySig = initialKeySig ?? [];
    let clefRowsDrawn = 0;
    let isFirstRow = true;

    function currentRowDrawsClef() {
        return drawStartClef && clefRowsDrawn < allowedClefRows;
    }

    function rowItemsAvailable() {
        const showClef = currentRowDrawsClef();
        let reserved = isFirstRow ? firstRowIndentWidth : 0;
        const hasKeySig = rowStartKeySig.length > 0;
        if (showClef) {
            const clefSlot = hasKeySig
                ? clefAdvance(ctx, rowStartClef) - ss(ctx, METRICS.clefPostGap) + ss(ctx, METRICS.clefInlinePostGap)
                : clefAdvance(ctx, rowStartClef) + ss(ctx, METRICS.clefInlinePostGap);
            reserved += clefSlot;
        }
        if (hasKeySig) {
            reserved += keySigAdvance(ctx, rowStartKeySig);
            if (!showClef) {
                reserved += ss(ctx, METRICS.clefPostGap);
            } else {
                reserved += ss(ctx, 1);
            }
        }
        if (!showClef && !hasKeySig) {
            reserved += ctx.staffSpace;
        }
        return staffRightX - ctx.leftMargin - reserved;
    }

    function finalize(justify) {
        if (cur.length === 0) {
            return;
        }
        const showClef = currentRowDrawsClef();
        const rowIsFirst = isFirstRow;
        isFirstRow = false;
        rows.push({
            items: cur,
            itemsWidth: curWidth,
            justify,
            startClef: rowStartClef,
            startClefSource: rowStartClefSource,
            startKeySig: rowStartKeySig,
            drawStartClef: showClef,
            indentWidth: rowIsFirst ? firstRowIndentWidth : 0,
        });
        if (showClef) {
            clefRowsDrawn++;
        }
        cur = [];
        curWidth = 0;
        rowStartClef = runningClef;
        rowStartClefSource = null;
        rowStartKeySig = runningKeySig;
    }

    for (let ii = 0; ii < items.length; ii++) {
        const item = items[ii];
        if (item.kind === 'break') {
            finalize(item.justify);
            continue;
        }
        if (item.kind === 'clef') {
            runningClef = item.clef;
            if (cur.length === 0) {
                rowStartClef = item.clef;
                rowStartClefSource = item;
                continue;
            }
        }
        if (item.kind === 'keysig') {
            runningKeySig = item.accidentals;
            if (cur.length === 0) {
                rowStartKeySig = item.accidentals;
                continue;
            }
        }
        // Accidentals are glued to the following neume — measure them as a
        // single atomic unit for line-breaking purposes.
        let w = measureItem(ctx, item);
        if (item.kind === 'accidental' && ii + 1 < items.length && items[ii + 1].kind === 'ligature') {
            w += measureItem(ctx, items[ii + 1]);
        }
        // Parenthesised groups are atomic: measure open+contents+close together
        // so the opening bracket never gets stranded at the end of a line with
        // the content wrapping to the next.  Only apply when the group fits in a
        // single row; if it is wider than a full row we let items wrap normally.
        if (item.kind === 'paren-open') {
            let groupW = w;
            for (let j = ii + 1; j < items.length; j++) {
                groupW += measureItem(ctx, items[j]);
                if (items[j].kind === 'paren-close') break;
            }
            if (groupW <= rowItemsAvailable()) {
                w = groupW;
            }
        }
        // If the previous item was an accidental glued to this item, skip the
        // overflow check (it was already accounted for).
        const gluedToPrev = ii > 0 && items[ii - 1].kind === 'accidental' && item.kind === 'ligature';
        if (!gluedToPrev && cur.length > 0 && curWidth + w > rowItemsAvailable()) {
            if (item.kind === 'barline') {
                // Barlines must not start a row — carry the preceding note/neume
                // unit (optionally with its leading accidental) to the new row.
                let splitIdx = -1;
                for (let k = cur.length - 1; k >= 0; k--) {
                    if (cur[k].kind === 'ligature') {
                        splitIdx = (k > 0 && cur[k - 1].kind === 'accidental') ? k - 1 : k;
                        break;
                    }
                }
                if (splitIdx >= 0) {
                    const carried = cur.splice(splitIdx);
                    curWidth -= carried.reduce((sum, it) => sum + measureItem(ctx, it), 0);
                    finalize(true);
                    for (const it of carried) {
                        cur.push(it);
                        curWidth += measureItem(ctx, it);
                    }
                } else {
                    finalize(true);
                }
            } else {
                finalize(true);
                if (item.kind === 'clef') {
                    rowStartClef = item.clef;
                    rowStartClefSource = item;
                    continue;
                }
                if (item.kind === 'keysig') {
                    rowStartKeySig = item.accidentals;
                    continue;
                }
            }
        }
        cur.push(item);
        curWidth += measureItem(ctx, item);
    }
    finalize(false);
    return rows;
}

function measureBarline(ctx, kind) {
    if (kind === ':|:') {
        return ss(ctx, METRICS.barlineDoubleAdvance) * 1.5 + ss(ctx, METRICS.barlinePostGap);
    }
    const base = (kind === '||' || kind === ':|' || kind === '|:' || kind === '|||')
        ? ss(ctx, METRICS.barlineDoubleAdvance)
        : ss(ctx, METRICS.barlineAdvance);
    return base + ss(ctx, METRICS.barlinePostGap);
}

// A mora on a non-final note within a group acts like an implicit '/' cut:
// the group is split after that note so the remaining notes form a new group.
// Exception: when the last 2 notes of the group both carry a mora, no split is
// inserted between them and both moras are drawn after the last notehead.
// Returns { groups, gaps } where gaps[i] is the gap type after groups[i]:
//   'mora'  — implicit split from an internal mora (compact spacing)
//   N (number) — explicit '/' separator repeated N times (N × neumeGapAdvance)
function splitGroupsAtInternalMora(groups, gaps = []) {
    const resultGroups = [];
    const resultGaps = [];
    for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi];
        let current = [];
        for (let i = 0; i < group.length; i++) {
            current.push(group[i]);
            const hasMora = group[i].modifiers && group[i].modifiers.includes('mora');
            if (i < group.length - 1 && hasMora) {
                // Don't split between the last two notes when both carry a mora.
                const isSecondToLast = i === group.length - 2;
                const nextHasMora = isSecondToLast &&
                    group[i + 1].modifiers && group[i + 1].modifiers.includes('mora');
                if (!nextHasMora) {
                    resultGroups.push(current);
                    resultGaps.push('mora');
                    current = [];
                }
            }
        }
        if (current.length > 0) {
            resultGroups.push(current);
            if (gi < groups.length - 1) {
                resultGaps.push(gaps[gi] ?? 1);
            }
        }
    }
    return { groups: resultGroups, gaps: resultGaps };
}

// groups: Note[][] — each group is a run of notes; groups are separated by neumatic cuts ('/').
// All groups except the last contribute a gap advance; the last group contributes singleNoteAdvance.
// Gap types: N (number) = N × neumeGapAdvance; 'mora' = compact spacing just past the mora dot.
function measureLigature(ctx, groups, gaps = []) {
    const split = splitGroupsAtInternalMora(groups, gaps);
    return measureSplitLigature(ctx, split.groups, split.gaps);
}

function measureSplitLigature(ctx, groups, gaps) {
    let total = 0;
    for (let g = 0; g < groups.length; g++) {
        const notes = groups[g];
        const n = notes.length;
        // Add advance for any inline accidentals on notes in this group.
        const accExtra = notes.reduce((sum, note) => sum + (note.accidental ? accidentalSymbolAdvance(ctx, note.accidental.symbol) : 0), 0);
        if (g < groups.length - 1) {
            const gapType = gaps[g] ?? 1;
            const slashCount = typeof gapType === 'number' ? gapType : 0;
            const lastNote = notes[n - 1];
            const hasMora = lastNote.modifiers && lastNote.modifiers.includes('mora');
            const moraNoteCount = notes.filter(note => note.modifiers && note.modifiers.includes('mora')).length;
            // The mora dot extends past the note box right edge; account for that overhang
            // whether the gap after it is an explicit '/' or an implicit mora split.
            // For multi-mora groups, the dot is drawn after the last notehead even if it
            // doesn't itself carry a mora.
            const moraOverhang = (hasMora || moraNoteCount >= 2)
                ? ss(ctx, METRICS.moraOffsetX + METRICS.moraRadius)
                : 0;
            total += ss(ctx, METRICS.noteBoxWidth) + (n - 1) * ctx.ligatureStepAdvance + slashCount * ctx.neumeGapAdvance + moraOverhang + accExtra;
        } else {
            const lastNote = notes[n - 1];
            const hasMora = lastNote.modifiers && lastNote.modifiers.includes('mora');
            const moraNoteCount = notes.filter(note => note.modifiers && note.modifiers.includes('mora')).length;
            const moraExtra = (hasMora || moraNoteCount >= 2) ? ss(ctx, METRICS.moraOffsetX + METRICS.moraRadius) : 0;
            const hasTenor = notes.some(n => n.shape === 'tenor');
            const tenorExtra = hasTenor ? ss(ctx, METRICS.tenorAdvanceExtra) : 0;
            total += ctx.singleNoteAdvance + (n - 1) * ctx.ligatureStepAdvance + moraExtra + accExtra + tenorExtra;
        }
    }
    return total;
}

function rowLowestNoteY(ctx, row, staffBottomY) {
    let maxY = staffBottomY;
    const halfNoteH = ss(ctx, METRICS.noteBoxHeight) * 0.5;
    for (const it of row.items) {
        if (it.kind !== 'ligature') {
            continue;
        }
        for (const group of it.groups) {
            for (const note of group) {
                const cy = pitchY(ctx, note, staffBottomY);
                if (cy > maxY) {
                    maxY = cy + halfNoteH;
                }
            }
        }
    }
    return maxY;
}

function emitLigature(ctx, groups, x, staffBottomY, gaps = [], leadingCourtesyAccidentals = []) {
    const splitResult = splitGroupsAtInternalMora(groups, gaps);
    groups = splitResult.groups;
    gaps = splitResult.gaps;
    const parts = [];
    const halfSW = ligatureConnectorHalfStroke(ctx);
    let groupStartX = x;
    let courtesyAdvance = 0;
    let firstNoteCx = null;
    let lastNoteCx = null;
    let allNotesMinY = Infinity;
    let allNotesMaxY = -Infinity;

    for (const acc of leadingCourtesyAccidentals) {
        const accX = groupStartX + courtesyAdvance;
        const a = drawAccidental(ctx, acc.pitch, acc.symbol, accX, staffBottomY, acc.high ?? false);
        parts.push(`<g class="aretino-accidental aretino-courtesy-accidental">${a.svg}</g>`);
        courtesyAdvance += accidentalAdvance(ctx, acc);
    }
    groupStartX += courtesyAdvance;

    for (let g = 0; g < groups.length; g++) {
        const notes = groups[g];
        const positions = [];
        let cx = groupStartX + ss(ctx, METRICS.noteBoxWidth) * 0.5;

        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            // Draw inline accidental before this note if present.
            if (note.accidental) {
                const accX = cx - ss(ctx, METRICS.noteBoxWidth) * 0.5;
                const a = drawAccidental(ctx, note.accidental.pitch, note.accidental.symbol, accX, staffBottomY, note.accidental.high ?? false);
                parts.push(wrapSrc(note.accidental, a.svg, 'aretino-accidental aretino-inline-accidental', staffBottomY, ctx.staffHeight));
                cx += accidentalSymbolAdvance(ctx, note.accidental.symbol);
            }
            const cy = pitchY(ctx, note, staffBottomY);
            positions.push({ note, cx, cy });
            if (firstNoteCx === null) {
                firstNoteCx = cx;
            }
            lastNoteCx = cx;
            const halfH = ss(ctx, METRICS.noteBoxHeight) * 0.5;
            if (cy - halfH < allNotesMinY) allNotesMinY = cy - halfH;
            if (cy + halfH > allNotesMaxY) allNotesMaxY = cy + halfH;
            if (i < notes.length - 1) {
                cx += ctx.ligatureStepAdvance;
            }
        }

        // Auto-virga per group: every local pitch peak gets a downward stem on the left.
        // Left side non-strict (>=), right side strict (>) so only the last note of a
        // plateau is marked (e.g. "ggf" → virga on the second g).
        const autoVirga = new Array(notes.length).fill(false);
        if (notes.length >= 2) {
            const pitchPositions = notes.map(n => pitchToPos(n));
            const hasVariation = Math.max(...pitchPositions) > Math.min(...pitchPositions);
            if (hasVariation) {
                for (let i = 0; i < notes.length; i++) {
                    const atLeastAsHighAsLeft = i === 0 || pitchPositions[i] >= pitchPositions[i - 1];
                    const higherThanRight = i === notes.length - 1 || pitchPositions[i] > pitchPositions[i + 1];
                    if (atLeastAsHighAsLeft && higherThanRight && !notes[i].noVirga) {
                        autoVirga[i] = true;
                    }
                }
            }
        }

        // Draw ligature connectors first (under the heads).
        for (let i = 1; i < positions.length; i++) {
            const prev = positions[i - 1];
            const cur = positions[i];
            if (cur.note.shape === 'virga' || cur.note.virga || autoVirga[i]) {
                continue;
            }
            // Skip connector into a note preceded by an inline accidental —
            // the accidental glyph occupies the space where the connector would be.
            if (cur.note.accidental) {
                continue;
            }
            const prevPos = pitchToPos(prev.note);
            const curPos = pitchToPos(cur.note);
            if (curPos === prevPos) {
                continue;
            }
            const prevScale = prev.note.modifiers && prev.note.modifiers.includes('small') ? METRICS.smallNoteScale : 1;
            const curScale = cur.note.modifiers && cur.note.modifiers.includes('small') ? METRICS.smallNoteScale : 1;
            const from = noteheadRightPoint(ctx, prev.cx, prev.cy, prevScale);
            const to = noteheadLeftPoint(ctx, cur.cx, cur.cy, curScale);
            const kind = curPos > prevPos ? 'up' : 'down';
            parts.push(drawLigatureConnector(ctx, from.x - halfSW, from.y, to.x + halfSW, to.y, kind));
        }

        // Detect runs of consecutive notes that all carry an episema.
        // For each run of 2+ notes, draw one spanning episema at the highest
        // note's vertical position so all segments touch.
        const halfEW = ss(ctx, METRICS.episemaWidth) / 2;
        const episemaInGroup = new Set(); // indices covered by a group episema
        {
            let runStart = null;
            const flushRun = (end) => {
                if (runStart === null) {
                    return;
                }
                if (end - runStart >= 2) {
                    const run = positions.slice(runStart, end);
                    const highest = run.reduce((best, p) => (p.cy < best.cy ? p : best), run[0]);
                    const onLine = pitchToPos(highest.note) % 2 === 0;
                    const x1 = run[0].cx - halfEW;
                    const x2 = run[run.length - 1].cx + halfEW;
                    parts.push(drawEpisemaSpan(ctx, x1, x2, highest.cy, onLine));
                    for (let j = runStart; j < end; j++) {
                        episemaInGroup.add(j);
                    }
                }
                runStart = null;
            };
            for (let i = 0; i <= positions.length; i++) {
                const hasEpisema = i < positions.length && positions[i].note.modifiers.includes('episema');
                if (hasEpisema) {
                    if (runStart === null) {
                        runStart = i;
                    }
                } else {
                    flushRun(i);
                }
            }
        }

        // Draw note heads + modifiers, wrapped per-note so each note can be
        // highlighted independently when the cursor sits on it.
        for (let i = 0; i < positions.length; i++) {
            const p = positions[i];
            const prevCy = i > 0 ? positions[i - 1].cy : null;
            const drawnNote = autoVirga[i] ? { ...p.note, virga: true } : p.note;
            const noteParts = [drawNoteHead(ctx, drawnNote, p.cx, p.cy, staffBottomY, prevCy)];
            const modifierSpans = p.note.modifierSpans ?? [];
            for (let mi = 0; mi < p.note.modifiers.length; mi++) {
                const mod = p.note.modifiers[mi];
                let glyph = null;
                if (mod === 'episema') {
                    if (!episemaInGroup.has(i)) {
                        const onLine = pitchToPos(p.note) % 2 === 0;
                        glyph = drawEpisema(ctx, p.cx, p.cy, onLine);
                    }
                } else if (mod === 'mora') {
                    const onLine = pitchToPos(p.note) % 2 === 0;
                    const moraNoteCount = notes.filter(n => n.modifiers.includes('mora')).length;
                    // Multi-mora: all dots share the same x position (after the last notehead),
                    // each at their own vertical pitch position.
                    const drawCx = moraNoteCount >= 2 ? positions[positions.length - 1].cx : p.cx;
                    glyph = drawMora(ctx, drawCx, p.cy, onLine);
                } else if (mod === 'ictus') {
                    const onLine = pitchToPos(p.note) % 2 === 0;
                    const below = p.note.modifiers.includes('episema');
                    glyph = drawIctus(ctx, p.cx, p.cy, onLine, below);
                } else if (mod === 'liquescens') {
                    glyph = drawLiquescens(ctx, p.cx, p.cy, 'down');
                }
                if (glyph === null) continue;
                noteParts.push(wrapSrc(modifierSpans[mi] ?? {}, glyph, `aretino-modifier aretino-mod-${mod}`));
            }
            parts.push(wrapSrc(p.note, noteParts.join(''), 'aretino-note', staffBottomY, ctx.staffHeight, p.cx - ss(ctx, METRICS.noteBoxWidth) * 0.5, ss(ctx, METRICS.noteBoxWidth)));
        }

        if (g < groups.length - 1) {
            const gapType = gaps[g] ?? 1;
            const slashCount = typeof gapType === 'number' ? gapType : 0;
            const lastNote = notes[notes.length - 1];
            const hasMora = lastNote.modifiers && lastNote.modifiers.includes('mora');
            const moraOverhang = hasMora
                ? ss(ctx, METRICS.moraOffsetX + METRICS.moraRadius)
                : 0;
            const accExtra = notes.reduce((sum, note) => sum + (note.accidental ? accidentalSymbolAdvance(ctx, note.accidental.symbol) : 0), 0);
            groupStartX += ss(ctx, METRICS.noteBoxWidth) + (notes.length - 1) * ctx.ligatureStepAdvance + slashCount * ctx.neumeGapAdvance + moraOverhang + accExtra;
        }
    }

    const advance = courtesyAdvance + measureSplitLigature(ctx, groups, gaps);
    const totalNotes = groups.reduce((sum, g) => sum + g.length, 0);
    const lastNote = groups[groups.length - 1]?.[groups[groups.length - 1].length - 1];
    const lastNoteHasMora = lastNote?.modifiers?.includes('mora');
    const allMoraNoteCount = groups.reduce((sum, g) => sum + g.filter(n => n.modifiers?.includes('mora')).length, 0);
    // A mora dot appears past the last notehead if the final note has one, or when
    // multiple notes in the neume carry moras (they all stack at the last notehead's x).
    const hasMora = lastNoteHasMora || allMoraNoteCount >= 2;
    const isTenor = groups.some(g => g.some(n => n.shape === 'tenor'));
    const shouldAlignLeft = totalNotes > 1 || isTenor;
    // centerX is the notehead center used for lyric alignment — mora and gap are excluded.
    const centerX = firstNoteCx !== null
        ? (firstNoteCx + lastNoteCx) / 2
        : x + advance / 2;
    const leftX = firstNoteCx !== null
        ? firstNoteCx - ss(ctx, METRICS.noteBoxWidth) * 0.5
        : x;
    // Visual right edge of the last notehead (extended for a trailing mora dot),
    // distinct from `advance` which also includes inter-neume spacing.
    const rightX = lastNoteCx !== null
        ? lastNoteCx + ss(ctx, hasMora ? METRICS.moraOffsetX + METRICS.moraRadius : METRICS.noteBoxWidth * 0.5)
        : x + advance;

    return { svg: parts.join(''), advance, centerX, leftX, rightX, shouldAlignLeft, minY: allNotesMinY, maxY: allNotesMaxY };
}

let _measureCanvas = null;

function measureTextWidth(text, fontSize, fontFamily, bold = false, italic = false) {
    if (text === '') {
        return 0;
    }
    if (typeof document !== 'undefined') {
        try {
            if (!_measureCanvas) {
                _measureCanvas = document.createElement('canvas');
            }
            const c2d = _measureCanvas.getContext('2d');
            const style = (italic ? 'italic ' : '') + (bold ? 'bold ' : '');
            c2d.font = `${style}${fontSize}px ${fontFamily}`;
            return c2d.measureText(text).width;
        } catch (_e) {
            // fall through to estimation
        }
    }
    return text.length * fontSize * 0.55 * (bold ? 1.1 : 1.0) * (italic ? 0.95 : 1.0);
}

function measureSegmentsWidth(segments, fontSize, fontFamily) {
    if (!segments || segments.length === 0) return 0;
    return segments.reduce(
        (sum, seg) => sum + measureTextWidth(seg.text, fontSize, fontFamily, seg.bold, seg.italic),
        0
    );
}

// Return a copy of `segments` covering only the characters from `startChar` onwards.
function sliceSegments(segments, startChar) {
    const result = [];
    let pos = 0;
    for (const seg of segments) {
        const segEnd = pos + seg.text.length;
        if (segEnd > startChar) {
            const cutStart = Math.max(pos, startChar) - pos;
            result.push({ ...seg, text: seg.text.slice(cutStart) });
        }
        pos = segEnd;
    }
    return result;
}

// Return a copy of `segments` covering only the first `length` characters.
function trimSegmentsEnd(segments, length) {
    const result = [];
    let pos = 0;
    for (const seg of segments) {
        if (pos >= length) break;
        const segEnd = pos + seg.text.length;
        const cutEnd = Math.min(segEnd, length);
        result.push({ ...seg, text: seg.text.slice(0, cutEnd - pos) });
        pos = segEnd;
    }
    return result;
}

// "San-ctus, (M.:) Do-mi-nus" → [
//   {text:'San', hyphenAfter:true,  kind:'note'},
//   {text:'ctus,', hyphenAfter:false, kind:'note'},
//   {text:'M.:', hyphenAfter:false, kind:'barline'},
//   {text:'Do', hyphenAfter:true,  kind:'note'},
//   {text:'mi', hyphenAfter:true,  kind:'note'},
//   {text:'nus', hyphenAfter:false, kind:'note'},
// ]
// Parenthesized tokens are barline labels: rendered centered under the next
// barline rather than the next ligature.
// Parses lyric text with the formatting syntax into an array of segments.
// Each segment: { text, bold, italic, underline, color }
// Syntax:
//   {text}           bold
//   \sc{text}        small caps
//   <text>           italic
//   [text]           underline
//   \R               responsory sign ℟
//   \V               versicle sign ℣
//   \red{text}       red colored text
//   \color:X{text}   X-colored text (generic)
//   +                dagger †
//   ++               double dagger ‡
//   \X               literal X (escape for any special char)
function parseFormattingToSegmentsInternal(text, sourceMap = null) {
    text = String(text ?? '');
    const withSource = Array.isArray(sourceMap);
    const stack = [{ type: 'root', bold: false, italic: false, underline: false, color: null, smallCaps: false }];
    const segments = [];

    function sourceAt(idx) {
        const value = sourceMap?.[idx];
        return Number.isFinite(value) ? value : null;
    }

    function effectiveState() {
        const s = { bold: false, italic: false, underline: false, color: null, smallCaps: false };
        for (const e of stack) {
            if (e.bold) s.bold = true;
            if (e.italic) s.italic = true;
            if (e.underline) s.underline = true;
            if (e.color !== null) s.color = e.color;
            if (e.smallCaps) s.smallCaps = true;
        }
        return s;
    }

    function addText(str, offsets = null) {
        if (!str) return;
        const st = effectiveState();
        const sourceOffsets = withSource
            ? (offsets ?? Array.from({ length: str.length }, () => null))
            : null;
        const last = segments[segments.length - 1];
        if (last && last.bold === st.bold && last.italic === st.italic &&
                last.underline === st.underline && last.color === st.color && last.smallCaps === st.smallCaps) {
            last.text += str;
            if (withSource) {
                last.sourceOffsets.push(...sourceOffsets);
            }
        } else {
            const segment = { text: str, bold: st.bold, italic: st.italic, underline: st.underline, color: st.color, smallCaps: st.smallCaps };
            if (withSource) {
                segment.sourceOffsets = sourceOffsets.slice();
            }
            segments.push(segment);
        }
    }

    function popType(...types) {
        for (let k = stack.length - 1; k >= 0; k--) {
            if (types.includes(stack[k].type)) { stack.splice(k, 1); return; }
        }
    }

    let i = 0;
    while (i < text.length) {
        if (text[i] === '+' && text[i + 1] === '+') {
            addText('‡', [sourceAt(i)]); i += 2;
        } else if (text[i] === '+') {
            addText('†', [sourceAt(i)]); i++;
        } else if (text[i] === '\\') {
            const slashIdx = i;
            i++;
            if (i >= text.length) { addText('\\', [sourceAt(slashIdx)]); break; }
            if (text[i] === 'R') {
                addText('℟', [sourceAt(slashIdx) ?? sourceAt(i)]); i++;
            } else if (text[i] === 'V') {
                addText('℣', [sourceAt(slashIdx) ?? sourceAt(i)]); i++;
            } else if (text.slice(i, i + 3) === 'sc{') {
                stack.push({ type: 'command', bold: false, italic: false, underline: false, color: null, smallCaps: true });
                i += 3;
            } else if (text.slice(i, i + 4) === 'red{') {
                stack.push({ type: 'command', bold: false, italic: false, underline: false, color: 'red', smallCaps: false });
                i += 4;
            } else if (text.slice(i, i + 6) === 'color:') {
                i += 6;
                const braceIdx = text.indexOf('{', i);
                if (braceIdx >= 0) {
                    const colorName = text.slice(i, braceIdx);
                    i = braceIdx + 1;
                    stack.push({ type: 'command', bold: false, italic: false, underline: false, color: colorName });
                } else {
                    addText('\\color:', Array.from({ length: 7 }, (_, k) => sourceAt(slashIdx + k)));
                }
            } else {
                addText(text[i], [sourceAt(i)]); i++;
            }
        } else if (text[i] === '{') {
            stack.push({ type: 'brace', bold: true, italic: false, underline: false, color: null }); i++;
        } else if (text[i] === '}') {
            popType('brace', 'command'); i++;
        } else if (text[i] === '<') {
            stack.push({ type: 'angle', bold: false, italic: true, underline: false, color: null }); i++;
        } else if (text[i] === '>') {
            popType('angle'); i++;
        } else if (text[i] === '[') {
            stack.push({ type: 'bracket', bold: false, italic: false, underline: true, color: null }); i++;
        } else if (text[i] === ']') {
            popType('bracket'); i++;
        } else {
            addText(text[i], [sourceAt(i)]); i++;
        }
    }

    return segments.filter(s => s.text !== '');
}

function parseFormattingToSegments(text) {
    return parseFormattingToSegmentsInternal(text);
}

function parseFormattingToSegmentsWithSource(text, sourceMap) {
    return parseFormattingToSegmentsInternal(text, sourceMap);
}

function lyricText(input) {
    return typeof input === 'string' ? input : (input?.text ?? '');
}

function lyricSourceMap(input) {
    return typeof input === 'string' ? null : (Array.isArray(input?.sourceMap) ? input.sourceMap : null);
}

function sourceSpanFromOffsets(offsets) {
    const real = offsets.filter(Number.isFinite);
    if (real.length === 0) {
        return {};
    }
    return { srcStart: Math.min(...real), srcEnd: Math.max(...real) + 1 };
}

// Expands a per-syllable array into a per-ligature array. A syllable with
// noteGroupCount=N occupies N consecutive ligature slots: the first slot
// carries the real text; subsequent slots are empty placeholders with
// hyphenAfter=true so the hyphen-connector and snug spacing still apply.
function expandSyllablesForLigatures(notes) {
    const expanded = [];
    for (const syl of notes) {
        const n = syl.noteGroupCount || 1;
        expanded.push(syl);
        for (let k = 1; k < n; k++) {
            expanded.push({
                text: '',
                alignText: '',
                segments: [],
                alignSegments: [],
                suffixSegments: [],
                hyphenAfter: k < n - 1 ? true : syl.hyphenAfter,
                kind: 'note',
            });
        }
    }
    return expanded;
}

function parseSyllables(input) {
    const text = lyricText(input);
    const sourceMap = lyricSourceMap(input);
    const result = [];
    // Parse formatting first, then reconstruct clean text + per-char format map.
    const rawSegments = sourceMap
        ? parseFormattingToSegmentsWithSource(text || '', sourceMap)
        : parseFormattingToSegments(text || '');
    let cleaned = '';
    const formatMap = [];
    const cleanedSourceMap = [];
    for (const seg of rawSegments) {
        for (let ci = 0; ci < seg.text.length; ci++) {
            const c = seg.text[ci];
            cleaned += c;
            formatMap.push({ bold: seg.bold, italic: seg.italic, underline: seg.underline, color: seg.color, smallCaps: seg.smallCaps });
            cleanedSourceMap.push(seg.sourceOffsets?.[ci] ?? null);
        }
    }

    function sourceSpanForCleanedRange(start, end) {
        return sourceSpanFromOffsets(cleanedSourceMap.slice(start, end));
    }

    // Build segments for a range [start, end) in cleaned, collapsing same-formatting runs.
    function buildSegments(start, end, displayFn) {
        const segments = [];
        if (start >= end) return segments;
        let runStart = start;
        let f0 = formatMap[start] || { bold: false, italic: false, underline: false, color: null, smallCaps: false };
        let runBold = f0.bold, runItalic = f0.italic, runUnderline = f0.underline, runColor = f0.color, runSmallCaps = f0.smallCaps;
        for (let p = start + 1; p < end; p++) {
            const f = formatMap[p] || { bold: false, italic: false, underline: false, color: null, smallCaps: false };
            if (f.bold !== runBold || f.italic !== runItalic || f.underline !== runUnderline || f.color !== runColor || f.smallCaps !== runSmallCaps) {
                segments.push({ text: displayFn(cleaned.slice(runStart, p)), bold: runBold, italic: runItalic, underline: runUnderline, color: runColor, smallCaps: runSmallCaps });
                runStart = p;
                runBold = f.bold; runItalic = f.italic; runUnderline = f.underline; runColor = f.color; runSmallCaps = f.smallCaps;
            }
        }
        segments.push({ text: displayFn(cleaned.slice(runStart, end)), bold: runBold, italic: runItalic, underline: runUnderline, color: runColor, smallCaps: runSmallCaps });
        return segments;
    }

    let i = 0;
    let noteCount = 0;
    while (i < cleaned.length) {
        const ch = cleaned[i];
        if (ch === ' ' || ch === '\t') {
            i++;
            continue;
        }
        if (ch === '(') {
            const end = cleaned.indexOf(')', i);
            const innerStart = i + 1;
            const innerEnd = end < 0 ? cleaned.length : end;
            const fullEnd = end < 0 ? innerEnd : end + 1;
            const segments = buildSegments(innerStart, innerEnd, s => s.replace(/~/g, ' '));
            i = end < 0 ? cleaned.length : end + 1;
            result.push({
                text: cleaned.slice(innerStart, innerEnd).replace(/~/g, ' '),
                segments,
                hyphenAfter: false,
                kind: 'barline',
                notesBefore: noteCount,
                ...sourceSpanForCleanedRange(innerStart - 1, fullEnd),
            });
            continue;
        }
        const wordChars = [];
        const wordCharIndexes = [];
        let j = i;
        let skipWhitespaceAfterHyphen = false;
        while (j < cleaned.length) {
            const c = cleaned[j];
            if (c === '(') {
                break;
            }
            if (c === ' ' || c === '\t') {
                if (skipWhitespaceAfterHyphen) {
                    j++;
                    continue;
                }
                // Peek past spaces: if a hyphen follows, continue (handles "Al - le")
                let peek = j + 1;
                while (peek < cleaned.length && (cleaned[peek] === ' ' || cleaned[peek] === '\t')) peek++;
                if (peek < cleaned.length && cleaned[peek] === '-') {
                    j++;
                    continue;
                }
                break;
            }
            wordChars.push(c);
            wordCharIndexes.push(j);
            skipWhitespaceAfterHyphen = c === '-';
            j++;
        }
        const word = wordChars.join('');
        i = j;
        // Parse syllables and consecutive-hyphen counts. N hyphens between
        // syllables means the left syllable spans N note groups (split melisma).
        const sylParts = [];
        let wPos = 0;
        while (wPos < word.length) {
            const sylStart = wPos;
            while (wPos < word.length && word[wPos] !== '-') wPos++;
            const sylEnd = wPos;
            let trailingHyphens = 0;
            while (wPos < word.length && word[wPos] === '-') { trailingHyphens++; wPos++; }
            if (sylEnd > sylStart) {
                sylParts.push({ raw: word.slice(sylStart, sylEnd), startIdx: sylStart, endIdx: sylEnd, trailingHyphens });
            }
        }
        for (const { raw, startIdx, endIdx, trailingHyphens } of sylParts) {
            const absStart = wordCharIndexes[startIdx];
            const absEnd = wordCharIndexes[endIdx - 1] + 1;
            const sourceSpan = sourceSpanForCleanedRange(absStart, absEnd);
            const tildeIdx = raw.indexOf('~~');
            let text, alignText;
            if (tildeIdx !== -1) {
                text = raw.slice(0, tildeIdx).replace(/~/g, ' ') + ' ' + raw.slice(tildeIdx + 2).replace(/~/g, ' ');
                alignText = raw.slice(tildeIdx + 2).replace(/~/g, ' ');
            } else {
                text = raw.replace(/~/g, ' ');
                alignText = text;
            }
            const segments = buildSegments(absStart, absEnd, s => s.replace(/~~/g, ' ').replace(/~/g, ' '));
            let alignSegments = text === alignText
                ? segments
                : sliceSegments(segments, text.length - alignText.length);
            // Trailing punctuation must not be included in the centering width.
            // Strip it from alignSegments and record it as suffixSegments.
            const trailingPunctMatch = alignText.match(/[.,;:!?]+$/);
            let suffixSegments = [];
            if (trailingPunctMatch) {
                const coreLen = alignText.length - trailingPunctMatch[0].length;
                suffixSegments = sliceSegments(alignSegments, coreLen);
                alignSegments = trimSegmentsEnd(alignSegments, coreLen);
            }
            result.push({
                text,
                alignText,
                segments,
                alignSegments,
                suffixSegments,
                hyphenAfter: trailingHyphens > 0,
                noteGroupCount: Math.max(1, trailingHyphens),
                kind: 'note',
                ...sourceSpan,
            });
            noteCount += Math.max(1, trailingHyphens);
        }
    }
    return result;
}

// Renders a syllable's segments array as SVG text content (plain or with tspans).
function renderSegments(segments) {
    if (!segments || segments.length === 0) return '';
    if (segments.every(s => !s.bold && !s.italic && !s.underline && !s.color && !s.smallCaps)) {
        return escapeText(segments.map(s => s.text).join(''));
    }
    return segments.map(s => {
        let attrs = '';
        if (s.bold) attrs += ' font-weight="bold"';
        if (s.italic) attrs += ' font-style="italic"';
        if (s.color) attrs += ` fill="${escapeAttr(s.color)}"`;
        if (s.smallCaps) attrs += ' font-variant="small-caps"';
        if (!attrs) return escapeText(s.text);
        return `<tspan${attrs}>${escapeText(s.text)}</tspan>`;
    }).join('');
}

// Returns SVG <line> elements for any underlined segments, drawn below the text
// baseline. textX/textY match the SVG text element's x/y attributes;
// textAnchor is 'middle' or 'start'.
function renderUnderlines(segments, textX, textY, fontSize, fontFamily, textAnchor) {
    if (!segments || segments.every(s => !s.underline)) return '';
    const totalW = measureSegmentsWidth(segments, fontSize, fontFamily);
    let x = textAnchor === 'middle' ? textX - totalW / 2 : textX;
    const lineY = textY + fontSize * 0.13;
    const strokeW = Math.max(0.4, fontSize * 0.055);
    const lines = [];
    for (const seg of segments) {
        const w = measureTextWidth(seg.text, fontSize, fontFamily, seg.bold, seg.italic);
        if (seg.underline) {
            const stroke = seg.color || '#000';
            lines.push(`<line x1="${x}" y1="${lineY}" x2="${x + w}" y2="${lineY}" stroke="${escapeAttr(stroke)}" stroke-width="${strokeW}"/>`);
        }
        x += w;
    }
    return lines.join('');
}

// Converts a lyric line with formatting syntax into SVG tspan elements.
function formatLyricLine(text) {
    return renderSegments(parseFormattingToSegments(lyricText(text)));
}

// Renders parenthesized lyric tokens centered under their corresponding
// barlines. Each label pairs in order with the barlines that appeared in this
// row; extra labels beyond the row's barline count are skipped.
function emitBarlineLabels(ctx, labels, barlines, lyricY) {
    if (labels.length === 0 || barlines.length === 0) {
        return '';
    }
    const fontSize = ctx.lyricSize;
    const fontFamily = ctx.lyricFont;
    const parts = [];
    const n = Math.min(labels.length, barlines.length);
    for (let i = 0; i < n; i++) {
        const text = labels[i].text;
        if (text === '') {
            continue;
        }
        const cx = barlines[i].centerX;
        const label = labels[i];
        const labelSvg = `<text xml:space="preserve" x="${cx}" y="${lyricY}" font-family="${escapeAttr(fontFamily)}" font-size="${fontSize}" text-anchor="middle" fill="#000">${renderSegments(label.segments)}</text>`
            + renderUnderlines(label.segments, cx, lyricY, fontSize, fontFamily, 'middle');
        parts.push(wrapSrc(label, labelSvg, 'aretino-lyric aretino-barline-label'));
    }
    return parts.join('');
}

// Hungarian digraphs that form doubled consonants at hyphenated syllable boundaries
// (longest first to prevent partial matches, e.g. 'dzs' before 'dz').
const HU_DIGRAPHS = ['dzs', 'cs', 'dz', 'gy', 'ly', 'ny', 'sz', 'ty', 'zs'];

// Returns a new segment array with the last `removeCount` chars removed and `appendStr` appended.
// Appended text inherits the formatting of the last segment.
function modifySegsSuffix(segs, removeCount, appendStr) {
    let result = segs.map(s => ({ ...s }));
    let rem = removeCount;
    for (let i = result.length - 1; i >= 0 && rem > 0; i--) {
        const len = result[i].text.length;
        if (len <= rem) { rem -= len; result[i].text = ''; }
        else { result[i].text = result[i].text.slice(0, len - rem); rem = 0; }
    }
    result = result.filter(s => s.text !== '');
    if (appendStr) {
        if (result.length > 0) {
            const last = result[result.length - 1];
            result[result.length - 1] = { ...last, text: last.text + appendStr };
        } else {
            const orig = segs[segs.length - 1] || {};
            result.push({ text: appendStr, bold: orig.bold || false, italic: orig.italic || false, underline: orig.underline || false, color: orig.color || null });
        }
    }
    return result;
}

// Returns a new segment array with the first `removeCount` chars removed.
function modifySegsPrefix(segs, removeCount) {
    let result = segs.map(s => ({ ...s }));
    let rem = removeCount;
    for (let i = 0; i < result.length && rem > 0; i++) {
        const len = result[i].text.length;
        if (len <= rem) { rem -= len; result[i].text = ''; }
        else { result[i].text = result[i].text.slice(rem); rem = 0; }
    }
    return result.filter(s => s.text !== '');
}

// Returns [newSyl1, newSyl2] if a Hungarian doubled digraph is found at the boundary,
// null otherwise.  Called only when the inter-syllable hyphen is being collapsed.
// When digraph G ends syl1 and starts syl2, syl1 loses its trailing G[1:] and gains G[0]
// (e.g. osz → oss), while syl[i+1] loses its leading G[0] (e.g. szad → zad).
// Combined they display as osszad when collapsed — correct.
function hungarianDigraphTransformPair(syl1, syl2) {
    const text1 = syl1.segments.map(s => s.text).join('');
    const text2 = syl2.segments.map(s => s.text).join('');
    for (const g of HU_DIGRAPHS) {
        if (text1.endsWith(g) && text2.startsWith(g)) {
            const gRest = g.slice(1);
            const newSegs1 = modifySegsSuffix(syl1.segments, gRest.length, g[0]);
            const newSegs2 = modifySegsPrefix(syl2.segments, 1);
            const oldAlign1 = syl1.alignSegments;
            const oldAlign2 = syl2.alignSegments;
            const newAlign1 = oldAlign1 === syl1.segments ? newSegs1 : modifySegsSuffix(oldAlign1, gRest.length, g[0]);
            const newAlign2 = oldAlign2 === syl2.segments ? newSegs2 : modifySegsPrefix(oldAlign2, 1);
            return [
                { ...syl1, segments: newSegs1, alignSegments: newAlign1 },
                { ...syl2, segments: newSegs2, alignSegments: newAlign2 },
            ];
        }
    }
    return null;
}

// Lays out a row's worth of syllables centered under their corresponding
// ligature centers. Adjusts for collisions and emits hyphens between
// syllables of the same word when there's room.
function emitAlignedSyllables(ctx, syllables, ligatures, lyricY) {
    if (syllables.length === 0) {
        return '';
    }
    const fontSize = ctx.lyricSize;
    const fontFamily = ctx.lyricFont;
    // Minimum gap between syllables of different words: the font's real space
    // character, so an implicit word break is spaced exactly like an explicit
    // ~ (which renders a literal space). A fixed fraction of the font size
    // (e.g. 0.18em) is narrower than a true space and reads as too tight.
    const minGap = measureTextWidth(' ', fontSize, fontFamily) || fontSize * 0.25;
    // A hyphen occupies the width of an 'n' character; if the gap between
    // syllables is smaller than that, there is no room to render it.
    const hyphenSpaceW = measureTextWidth('.', fontSize, fontFamily);
    const trailingAdvance = fontSize * 0.6;

    const parts = [];
    let prevRight = -Infinity;
    let lastRight = null;
    // Track the parts[] index and left position of the previous syllable so it can be
    // re-rendered in-place when a Hungarian digraph transform fires on collapse.
    let prevSylIdx = -1;
    let prevLeft = 0;
    const workSyllables = syllables.slice();

    for (let i = 0; i < workSyllables.length; i++) {
        let syl = workSyllables[i];
        let fullW = measureSegmentsWidth(syl.segments, fontSize, fontFamily);
        let alignW = measureSegmentsWidth(syl.alignSegments || syl.segments, fontSize, fontFamily);
        let suffixW = syl.suffixSegments ? measureSegmentsWidth(syl.suffixSegments, fontSize, fontFamily) : 0;
        // Offset from the left edge of fullW to the left edge of alignText portion.
        // Subtract suffixW because trailing punctuation sits after the centered core.
        let prefixW = fullW - alignW - suffixW;
        let center;
        if (i < ligatures.length) {
            const lig = ligatures[i];
            if (lig.shouldAlignLeft) {
                // Align left edge: multi-note neume or tenor note.
                center = lig.leftX + alignW / 2 - ctx.staffSpace * 0.1;
            } else {
                // Center syllable on the notehead width only (mora excluded).
                center = lig.centerX;
            }
        } else {
            // More syllables than ligatures: lay them out after the last one
            // with default spacing.
            center = prevRight + trailingAdvance + alignW / 2;
        }
        // left edge of full text: align portion starts at (center - alignW/2),
        // prefix sits to the left of it
        let left = center - alignW / 2 - prefixW;
        let hyphenX = null;
        if (i > 0) {
            const needsHyphen = workSyllables[i - 1].hyphenAfter;
            if (needsHyphen) {
                if (left - prevRight >= hyphenSpaceW) {
                    hyphenX = (left + prevRight) / 2;
                } else {
                    // Hyphen collapsed: apply Hungarian double-consonant rule if applicable.
                    // The previous syllable's SVG is re-rendered in-place at the same left
                    // position; the current syllable is re-measured with the new text.
                    const transformed = hungarianDigraphTransformPair(workSyllables[i - 1], syl);
                    if (transformed) {
                        workSyllables[i - 1] = transformed[0];
                        syl = transformed[1];
                        workSyllables[i] = syl;
                        const newFullW1 = measureSegmentsWidth(transformed[0].segments, fontSize, fontFamily);
                        const newTC1 = prevLeft + newFullW1 / 2;
                        const newSvg1 = `<text xml:space="preserve" x="${newTC1}" y="${lyricY}" font-family="${escapeAttr(fontFamily)}" font-size="${fontSize}" text-anchor="middle" fill="#000">${renderSegments(transformed[0].segments)}</text>`
                            + renderUnderlines(transformed[0].segments, newTC1, lyricY, fontSize, fontFamily, 'middle');
                        parts[prevSylIdx] = wrapSrc(transformed[0], newSvg1, 'aretino-lyric aretino-syllable');
                        prevRight = prevLeft + newFullW1;
                        fullW = measureSegmentsWidth(syl.segments, fontSize, fontFamily);
                        alignW = measureSegmentsWidth(syl.alignSegments || syl.segments, fontSize, fontFamily);
                        suffixW = syl.suffixSegments ? measureSegmentsWidth(syl.suffixSegments, fontSize, fontFamily) : 0;
                        prefixW = fullW - alignW - suffixW;
                    }
                    left = prevRight;
                    center = left + prefixW + alignW / 2;
                }
            } else if (left < prevRight + minGap) {
                left = prevRight + minGap;
                center = left + prefixW + alignW / 2;
            }
        }
        const right = left + fullW;
        const textCenter = left + fullW / 2;

        const syllableSvg = `<text xml:space="preserve" x="${textCenter}" y="${lyricY}" font-family="${escapeAttr(fontFamily)}" font-size="${fontSize}" text-anchor="middle" fill="#000">${renderSegments(syl.segments)}</text>`
            + renderUnderlines(syl.segments, textCenter, lyricY, fontSize, fontFamily, 'middle');
        prevSylIdx = parts.length;
        prevLeft = left;
        parts.push(wrapSrc(syl, syllableSvg, 'aretino-lyric aretino-syllable'));
        if (hyphenX !== null) {
            parts.push(`<text x="${hyphenX}" y="${lyricY}" font-family="${escapeAttr(fontFamily)}" font-size="${fontSize}" text-anchor="middle" fill="#000">-</text>`);
        }
        prevRight = right;
        lastRight = right;
    }

    // Word broken at the row boundary: render a trailing hyphen so the reader
    // knows the syllable continues on the next row.
    const lastSyl = workSyllables[workSyllables.length - 1];
    if (lastSyl && lastSyl.hyphenAfter && lastRight !== null) {
        const hyphenX = lastRight + hyphenSpaceW / 2;
        parts.push(`<text x="${hyphenX}" y="${lyricY}" font-family="${escapeAttr(fontFamily)}" font-size="${fontSize}" text-anchor="middle" fill="#000">-</text>`);
    }
    return parts.join('');
}

// Collapses a flat array of {ch, bold, italic, underline, color} into segments,
// merging consecutive chars with identical formatting.
function charsToSegments(chars) {
    const segs = [];
    for (const c of chars) {
        const last = segs[segs.length - 1];
        if (last && last.bold === c.bold && last.italic === c.italic &&
                last.underline === c.underline && last.color === c.color) {
            last.text += c.ch;
        } else {
            segs.push({ text: c.ch, bold: c.bold, italic: c.italic, underline: c.underline, color: c.color });
        }
    }
    return segs;
}

// Wraps one verse input line into display lines that fit within availW.
// Continuation display lines (after wrapping) start at contX and use contAvailW.
// Returns an array of { x, segments }.
function wrapVerseText(lineText, firstX, contX, firstAvailW, contAvailW, fontSize, fontFamily) {
    // ~ is unbreakable space in verse lines
    const processed = lineText.replace(/~/g, ' ');
    const allSegs = parseFormattingToSegments(processed);

    // Build flat per-char array with formatting metadata
    const chars = [];
    for (const seg of allSegs) {
        for (const ch of seg.text) {
            chars.push({ ch, bold: seg.bold, italic: seg.italic, underline: seg.underline, color: seg.color });
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
            lineChars.push(word.spaceBefore || { ch: ' ', bold: false, italic: false, underline: false, color: null });
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
function renderVerseLines(ctx, verses, leftX, rightX, startY) {
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
