/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { parseAretino } from './parser.js';
import {
    METRICS,
    drawStaffLines,
    drawClef,
    drawAccidental,
    drawBarline,
    drawLiquescens,
    drawParenthesis,
    drawOverbrace,
    drawOverarc,
    drawOverline,
    escapeAttr,
    pitchY,
} from './glyphs.js';
import { parseHeaderRendererOptions } from './options.js';
import { renderVerseLines } from './verse.js';
import { wrapSrc } from './svg.js';
import {
    parseSyllables,
    expandSyllablesForLigatures,
    formatLyricLine,
    emitBarlineLabels,
    emitAlignedSyllables,
} from './lyrics.js';
import {
    measureTextWidth,
    measureSegmentsWidth,
    parseFormattingToSegments,
    renderSegments,
} from './text.js';
import { ss } from './units.js';
import { groupSections, flattenItems } from './items.js';
import { trailingClef, trailingKeySig } from './clef.js';
import { layoutRowsWithCourtesyAccidentals } from './layout.js';
import { measureLigature, measureBarline, rowLowestNoteY } from './measure.js';
import { emitLigature } from './ligature.js';

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
    ctx.measureText = options.measureText ?? measureTextWidth;
    const lyricLineHeight = ctx.lyricSize * 1.2;

    const hasIndent = 'indent' in ast.header || 'behúzás' in ast.header;
    const indentText = hasIndent ? (ast.header['indent'] ?? ast.header['behúzás'] ?? '') : '';
    const indentFontSize = ctx.lyricSize * 0.85;
    const indentLines = indentText ? indentText.split('|').map(l => l.trim()) : [];
    let indentWidth = 0;
    if (hasIndent) {
        const maxTextW = indentLines.length > 0
            ? Math.max(...indentLines.map(l => measureSegmentsWidth(parseFormattingToSegments(l), indentFontSize, lyricFont, ctx.measureText)))
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

    if (ast.header && (ast.header['title'] || ast.header['subtitle'] || ast.header['caption'] || ast.header['rubric'])) {
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
            const minGap = ctx.measureText(' ', ctx.lyricSize, ctx.lyricFont) || ctx.lyricSize * 0.25;
            const halfNoteW = ss(ctx, METRICS.noteBoxWidth) * 0.5;
            const ligInfo = [];
            let li = 0;
            for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
                const it = items[itemIdx];
                if (it.kind !== 'ligature') {
                    continue;
                }
                const totalNotes = it.groups.reduce((sum, g) => sum + g.length, 0);
                const lastG = it.groups[it.groups.length - 1];
                const lastN = lastG?.[lastG.length - 1];
                const isCentered = totalNotes === 1
                    && !it.groups.some(g => g.some(n => n.shape === 'tenor'));
                let maxSylW = 0;
                let maxCurrRight = 0;
                for (const notes of verseNotes) {
                    if (li < notes.length) {
                        const alignW = measureSegmentsWidth(notes[li].alignSegments || notes[li].segments, ctx.lyricSize, ctx.lyricFont, ctx.measureText);
                        const suffixW = notes[li].suffixSegments
                            ? measureSegmentsWidth(notes[li].suffixSegments, ctx.lyricSize, ctx.lyricFont, ctx.measureText)
                            : 0;
                        if (alignW > maxSylW) maxSylW = alignW;
                        const rightEdge = isCentered ? halfNoteW + alignW / 2 + suffixW : alignW + suffixW;
                        if (rightEdge > maxCurrRight) maxCurrRight = rightEdge;
                    }
                }
                ligInfo.push({ item: it, maxSylW, maxCurrRight, isCentered, itemIdx });
                li++;
            }
            for (let i = 0; i < ligInfo.length; i++) {
                const { item, maxSylW, maxCurrRight, isCentered } = ligInfo[i];
                const baseAdv = measureLigature(ctx, item.groups, item.gaps ?? []);
                // Right-edge offset from the ligature's left, including trailing punctuation.
                const currRight = maxCurrRight;
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
            const lyricSpace = ctx.measureText(' ', ctx.lyricSize, ctx.lyricFont) || ctx.lyricSize * 0.25;
            let bi = 0;
            for (const it of items) {
                if (it.kind !== 'barline') {
                    continue;
                }
                let maxW = 0;
                for (const barlineMap of verseBarlineMaps) {
                    const lbl = barlineMap.get(bi);
                    if (lbl) {
                        const w = measureSegmentsWidth(lbl.segments, ctx.lyricSize, ctx.lyricFont, ctx.measureText);
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
        let lastNote = null;
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
                    let barlineSvg, barlineAdvance;
                    if (it.value === '~') {
                        const cy = lastNote ? pitchY(ctx, lastNote, staffBottomY) : staffBottomY - 2 * ctx.staffSpace;
                        barlineSvg = drawLiquescens(ctx, cursorX + ss(ctx, METRICS.barlineOffsetX), cy, 'down');
                        barlineAdvance = ss(ctx, METRICS.barlineAdvance);
                    } else {
                        const b = drawBarline(ctx, it.value, cursorX, staffBottomY);
                        barlineSvg = b.svg;
                        barlineAdvance = b.advance;
                    }
                    parts.push(wrapSrc(it, barlineSvg, 'aretino-token aretino-barline', staffBottomY, ctx.staffHeight));
                    const offsetX = (it.value === '||' || it.value === ':|' || it.value === '|:' || it.value === ':|:' || it.value === '|||')
                        ? (METRICS.barlineOffsetX + METRICS.barlineDoubleSecondOffsetX) / 2
                        : METRICS.barlineOffsetX;
                    rowBarlines.push({ centerX: cursorX + ss(ctx, offsetX), value: it.value, globalIdx: globalBarlineIdx });
                    globalBarlineIdx++;
                    cursorX += barlineAdvance + ss(ctx, METRICS.barlinePostGap) + extra / 2 + postExtra;
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
                    const lastGroup = it.groups[it.groups.length - 1];
                    lastNote = lastGroup[lastGroup.length - 1];
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
