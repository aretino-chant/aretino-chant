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
    drawPlica,
    drawParenthesis,
    drawOverbrace,
    drawOverarc,
    drawOverline,
    drawSlur,
    escapeAttr,
    pitchY,
    pitchToPos,
    drawPlicaBarline,
} from './glyphs.js';
import { parseHeaderRendererOptions } from './options.js';
import { renderVerseLines } from './verse.js';
import { wrapSrc } from './svg.js';
import {
    parseSyllables,
    expandSyllablesForLigatures,
    hasRealLyricText,
    formatLyricLine,
    emitBarlineLabels,
    emitAlignedSyllables,
} from './lyrics.js';
import {
    measureTextWidth,
    measureSegmentsWidth,
    sliceSegments,
    trimSegmentsEnd,
    parseFormattingToSegments,
    renderSegments,
    renderMixedLabel,
} from './text.js';
import { ss } from './units.js';
import { groupSections, flattenItems } from './items.js';
import { trailingClef, trailingKeySig } from './clef.js';
import { layoutRowsWithCourtesyAccidentals } from './layout.js';
import { createTransposeState, applyTranspose } from './transpose.js';
import { measureLigature, measureLigatureVisualRight, measureBarline, rowLowestNoteY, isLeveledGap, isLevelingTargetGap, gapFloor, levelingTarget } from './measure.js';
import { emitLigature } from './ligature.js';

const DEFAULT_FONT = "'Palatino Linotype', 'Book Antiqua', Palatino, serif";

// Distribute a budget of extra horizontal space across the row's inter-neume
// gaps so the *visible* spacing between neumes becomes uniform, independent of
// syllable width. Each gap has a floor (the lyric-driven minimum already baked
// into it, so the syllable never overlaps the next neume); we raise the narrow
// gaps toward the widest by "water-filling": pour the budget in from the bottom
// until every gap reaches a common level L, i.e. the smallest L with
// Σ max(0, L − floorᵢ) == budget. Gaps whose floor already exceeds L keep their
// floor (an unavoidably wide syllable stays wide); all others rise to L. Returns
// L; callers add max(0, L − floorᵢ) to each gap.
function justificationWaterLevel(floors, budget) {
    if (floors.length === 0 || budget <= 0) {
        return floors.length ? Math.min(...floors) : 0;
    }
    const sorted = [...floors].sort((a, b) => a - b);
    let level = sorted[0];
    let remaining = budget;
    for (let i = 1; i <= sorted.length; i++) {
        const next = i < sorted.length ? sorted[i] : Infinity;
        const count = i; // gaps at or below the current level
        const cost = (next - level) * count;
        if (!isFinite(cost) || cost >= remaining) {
            return level + remaining / count;
        }
        remaining -= cost;
        level = next;
    }
    return level;
}

let recitationChainCounter = 0;

// Splits a recitation syllable's whitespace-separated words into one syllable
// per word, preserving per-character formatting via segment slicing. Returns
// null when the syllable is a single word (nothing to wrap).
function splitRecitationWords(syl) {
    const text = syl.text || '';
    // A ~~ prefix (display-only text before the alignment text) is not part of
    // the recited phrase: only the alignment text splits into words, and the
    // prefix stays glued to the first word so it hangs left of the tenor note.
    const alignText = syl.alignText ?? text;
    const prefixLen = Math.max(0, text.length - alignText.length);
    if (!/\s/.test(alignText.trim())) return null;
    const segments = syl.segments || [];
    const words = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(alignText)) !== null) {
        const start = prefixLen + m.index;
        const wordSegs = trimSegmentsEnd(sliceSegments(segments, start), m[0].length);
        const withPrefix = words.length === 0 && prefixLen > 0;
        words.push({
            text: withPrefix ? text.slice(0, start + m[0].length) : m[0],
            alignText: m[0],
            segments: withPrefix ? trimSegmentsEnd(segments, start + m[0].length) : wordSegs,
            alignSegments: wordSegs, suffixSegments: [],
            realLyric: hasRealLyricText(m[0]),
            hyphenAfter: false, hyphenMandatory: false, kind: 'note',
        });
    }
    if (words.length < 2) return null;
    // The hyphen/connection to the syllable *after* the recited phrase
    // (e.g. the "lán" of "...orosz-lán") belongs to the last word, so it
    // butts up against the following note with a snug hyphen gap instead of
    // a full word gap.
    const last = words[words.length - 1];
    last.hyphenAfter = syl.hyphenAfter || false;
    last.hyphenMandatory = syl.hyphenMandatory || false;
    return words;
}

// A tenor (recitation) note carries its whole recited phrase as one syllable
// (words joined by ~). To let that phrase wrap between words — repeating the
// tenor notehead at each line start — expand the single tenor ligature into one
// glyphless "piece" per word, splitting the matching syllable so the
// 1-ligature⇄1-syllable indexing the renderer relies on holds.
//
// Only a single stanza can wrap this way: with two or more lyrics rows on the
// same tenor note each verse would need its own — generally different — word
// break points, which the lockstep 1-ligature⇄1-syllable layout cannot express,
// so we leave the note whole and don't wrap at all.
function expandTenorRecitations(items, verseNotes) {
    if (verseNotes.length !== 1) return;
    const notes = verseNotes[0];
    let li = 0;
    for (let ii = 0; ii < items.length; ii++) {
        const it = items[ii];
        if (it.kind !== 'ligature') continue;
        const isSingleTenor = it.groups.length === 1
            && it.groups[0].length === 1
            && it.groups[0][0].shape === 'tenor';
        const syl = notes[li];
        const words = isSingleTenor && syl ? splitRecitationWords(syl) : null;
        if (!words) { li++; continue; }
        const chainId = ++recitationChainCounter;
        const pieces = words.map((w, k) => ({
            ...it, recitationGlyphless: true, recitationChainId: chainId,
            recitationChainIndex: k, recitationChainLen: words.length,
        }));
        items.splice(ii, 1, ...pieces);
        ii += pieces.length - 1;
        notes.splice(li, 1, ...words);
        li += words.length;
    }
}

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

function _flushBrace(ctx, parts, state, staffBottomY, isEnd, textFont) {
    const gap = ss(ctx, METRICS.overbraceGap);
    const staffTopY = staffBottomY - 4 * ctx.staffSpace;
    const topNoteY = state.minY < Infinity
        ? Math.min(state.minY, staffTopY)
        : staffTopY;
    
    const { braceKind, startX, endX, isStart, placeIdx, label } = state;
    let markY;
    let svg;
    // Topmost rendered y of the shape (and, below, of any label) so the caller
    // can grow the viewBox to include decorations drawn above the staff.
    let braceTopY;
    if (braceKind === 'arc') {
        markY = topNoteY - gap;
        svg = drawOverarc(ctx, startX, endX, markY);
        braceTopY = markY - ss(ctx, METRICS.overarcBulge);
    } else if (braceKind === 'line') {
        markY = topNoteY - gap;
        svg = drawOverline(ctx, startX, endX, markY);
        braceTopY = markY;
    } else {
        markY = topNoteY - gap * 1.5;
        svg = drawOverbrace(ctx, startX, endX, markY, isStart !== false, isEnd);
        braceTopY = markY - (isStart !== false ? ss(ctx, METRICS.overbraceTipDepth) : 0);
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
        svg += renderMixedLabel(parseFormattingToSegments(label), mx, textY, fontSize, textFont, 'middle', ctx.measureText);
        // Label text ascends ~one font size above its baseline.
        braceTopY = Math.min(braceTopY, textY - fontSize);
    }
    parts[placeIdx] = svg;
    return braceTopY;
}

function _flushSlur(ctx, parts, state, staffBottomY, isEnd) {
    const gap = ss(ctx, METRICS.slurGap);
    const startNoteY = state.startNoteY != null ? state.startNoteY : staffBottomY;
    const endNoteY = state.endNoteY > -Infinity ? state.endNoteY : staffBottomY;
    const y1 = startNoteY + gap;
    const y2 = endNoteY + gap;
    const svg = drawSlur(ctx, state.startX, state.endX, y1, y2, state.dashed, state.isStart !== false, isEnd);
    parts[state.placeIdx] = svg;
    // Lowest y the downward arc can reach (safe upper bound on the bezier peak),
    // so the caller can grow the viewBox to include a slur below a lyric-less staff.
    return Math.max(y1, y2) + ss(ctx, METRICS.slurBulge);
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
    const textFont = options.textFont || DEFAULT_FONT;
    const hideRepeatClef = !!options.hideRepeatClef;
    // Opt back into leveling/justifying neume gaps that no lyric text touches
    // (see isLeveledGap): by default a lyric-less psalm melody keeps the plain
    // default advance between its notes.
    const justifyWithoutLyrics = !!options.justifyWithoutLyrics;
    const sourceMap = options.sourceMap !== false;

    // The whole engraving is parameterised by a single pixel-size: staffSpace.
    // Everything else (margins, advances, glyph dimensions) is a multiple of
    // it via METRICS.
    const ctx = {
        staffSpace: staffSpacePx,
        sourceMap,
    };
    ctx.pitchStep = ctx.staffSpace / 2;
    ctx.staffHeight = (METRICS.staffLineCount - 1) * ctx.staffSpace;
    ctx.singleNoteAdvance = ss(ctx, METRICS.singleNoteAdvance) * noteSpacing;
    ctx.ligatureStepAdvance = ss(ctx, METRICS.ligatureStepAdvance);
    ctx.expanderWidth = ss(ctx, METRICS.expanderWidth);
    ctx.neumeGapAdvance = ss(ctx, METRICS.neumeGapAdvance);
    ctx.gapOutlierThreshold = Number.isFinite(options.gapOutlierThreshold)
        ? Math.max(0, options.gapOutlierThreshold)
        : METRICS.gapOutlierThreshold;
    ctx.leftMargin = ss(ctx, METRICS.leftMargin);
    ctx.rightMargin = ss(ctx, METRICS.rightMargin);
    ctx.staffGap = ss(ctx, options.staffGap ?? METRICS.staffGap);
    ctx.lyricDistance = ss(ctx, options.lyricDistance ?? METRICS.lyricDistance);
    ctx.lyricMinStaffDistance = ss(ctx, options.lyricMinStaffDistance ?? METRICS.lyricMinStaffDistance);
    // Virga stem geometry (in spatia); read by drawNote/noteInkBounds via ss().
    ctx.virgaStemLength = options.virgaStemLength ?? METRICS.virgaStemLength;
    ctx.virgaStemDescentBelowPrev = options.virgaStemDescentBelowPrev ?? METRICS.virgaStemDescentBelowPrev;
    ctx.virgaMaxBelowBottom = options.virgaMaxBelowBottom ?? METRICS.virgaMaxBelowBottom;
    ctx.textFont = textFont;
    // W: text-block styling. `textStyle` is the document default (block markers
    // override it), `textStyles` lets a host tune the presets, and
    // `textMaxIndent` caps the text column a `~~` marker opens, and
    // `textMarkerAlign` sets markers flush left or flush against that column.
    ctx.textStyle = typeof options.textStyle === 'string' ? options.textStyle : undefined;
    ctx.textStyles = options.textStyles;
    ctx.textMaxIndent = Number.isFinite(options.textMaxIndent) ? options.textMaxIndent : undefined;
    ctx.textMarkerAlign = typeof options.textMarkerAlign === 'string' ? options.textMarkerAlign : undefined;
    // Escaped once: textFont is constant for the whole render but feeds the
    // font-family attribute of every <text> element emitted below.
    const escapedTextFont = escapeAttr(textFont);
    // Lyric font size in typographic points (default 12pt), converted to
    // logical units via dpi. Set independently of staff space and layout width.
    const lyricPt = Math.max(1, options.lyricSize ?? DEFAULT_LYRIC_SIZE_PT);
    ctx.lyricSize = lyricPt * dpi / 72;
    // Memoise text measurement. The same syllable/label is measured several
    // times per render (the syllable-extra reserve pass, the first-syllable
    // row pass, and again when syllables are actually placed), and the
    // underlying canvas measurement re-parses the font shorthand on every call.
    // A per-render cache collapses those repeats; it is keyed on the variable
    // parts only (fontFamily is constant for the render). Cleared each render
    // so it never goes stale or grows unbounded.
    const rawMeasure = options.measureText ?? measureTextWidth;
    const measureCache = new Map();
    ctx.measureText = (text, fontSize, fontFamily, bold, italic) => {
        if (text === '') return 0;
        const key = text + '\0' + fontSize + (bold ? 'b' : '') + (italic ? 'i' : '');
        let w = measureCache.get(key);
        if (w === undefined) {
            w = rawMeasure(text, fontSize, fontFamily, bold, italic);
            measureCache.set(key, w);
        }
        return w;
    };
    const lyricLineHeight = ctx.lyricSize * 1.2;

    const hasIndent = 'indent' in ast.header || 'behúzás' in ast.header;
    const indentText = hasIndent ? (ast.header['indent'] ?? ast.header['behúzás'] ?? '') : '';
    const indentFontSize = ctx.lyricSize * 0.85;
    const indentLines = indentText ? indentText.split('|').map(l => l.trim()) : [];
    let indentWidth = 0;
    if (hasIndent) {
        const maxTextW = indentLines.length > 0
            ? Math.max(...indentLines.map(l => measureSegmentsWidth(parseFormattingToSegments(l), indentFontSize, textFont, ctx.measureText)))
            : 0;
        indentWidth = Math.max(maxTextW + ctx.staffSpace * 1.5, ctx.staffSpace * 2);
    }

    const sections = groupSections(ast.lines);

    const transposeAmount = parseInt(ast.header?.['transpose'] ?? '', 10) || 0;
    const transposeState = transposeAmount ? createTransposeState(transposeAmount) : null;

    const parts = [];
    let currentClef = { letter: 'g', line: 2 };
    let currentKeySig = [];
    let hasSeenClef = false;
    let clefRowsBudget = hideRepeatClef ? 1 : Infinity;
    let firstSectionLayoutDone = false;
    let y = ss(ctx, METRICS.titleTopPadding);
    let contentBottom = y;
    let globalRowIdx = 0;
    // Tracks the actual bottom of rendered content in the previous row so that
    // per-row SVG viewBoxes always include the full content, even when staffGap
    // is smaller than the 2-staff-space above-staff headroom in the marker.
    let prevRowBottom = 0;
    // Highest (most negative) y any content reaches and the rightmost x it
    // reaches, so the final viewBox can grow to include decorations drawn above
    // the staff top (overbraces/arcs/labels/high notes) or a trailing row-break
    // hyphen pushed past the canvas width.
    let minRenderedY = 0;
    let maxRenderedX = width;

    if (!options.noHeader && ast.header && (ast.header['title'] || ast.header['subtitle'] || ast.header['caption'] || ast.header['rubric'])) {
        const title = ast.header['title'];
        const subtitle = ast.header['subtitle'];
        const titleFontSize = ctx.lyricSize * 1.2;
        const titleLineHeight = titleFontSize * 1.2;
        if (title) {                        
            const lines = title.split('|').map(l => l.trim());
            y += titleFontSize;
            for (let li = 0; li < lines.length; li++) {
                if (li > 0) y += titleLineHeight;
                parts.push(`<text x="${width / 2}" y="${y}" font-family="${escapedTextFont}" font-size="${titleFontSize}" font-weight="bold" text-anchor="middle" fill="#000">${renderSegments(parseFormattingToSegments(lines[li]))}</text>`);
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
                parts.push(`<text x="${width / 2}" y="${y}" font-family="${escapedTextFont}" font-size="${subTitleFontSize}" font-weight="bold" text-anchor="middle" fill="#000">${renderSegments(parseFormattingToSegments(lines[li]))}</text>`);
            }            
        }
        if (title || subtitle) y += titleLineHeight * 1.2;
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
                    parts.push(`<text x="${ctx.leftMargin}" y="${y - 1.4 * ctx.staffSpace}" font-family="${escapedTextFont}" font-size="${fontSize}" font-variant="small-caps" text-anchor="start" fill="#000">${renderSegments(parseFormattingToSegments(rubricLines[ri]))}</text>`);
                }
                if (ci >= 0) {
                    parts.push(`<text x="${width - ctx.rightMargin}" y="${y}" font-family="${escapedTextFont}" font-size="${fontSize}" font-style="italic" text-anchor="end" fill="#000">${renderSegments(parseFormattingToSegments(captionLines[ci]))}</text>`);
                }
            }
            y += fontSize * 0.4;
        }
    }

    const staffRightX = width - ctx.rightMargin;

    // Advances/offsets that depend only on staffSpace + METRICS (not on any
    // section/row/item state) are materialised once here instead of re-running
    // ss() on every item in the row loop below.
    const clefPostGapPx = ss(ctx, METRICS.clefPostGap);
    const clefInlinePostGapPx = ss(ctx, METRICS.clefInlinePostGap);
    const keySigInlinePostGapPx = ss(ctx, METRICS.keySigInlinePostGap);
    const barlineOffsetXPx = ss(ctx, METRICS.barlineOffsetX);
    const barlineAdvancePx = ss(ctx, METRICS.barlineAdvance);
    const barlinePostGapPx = ss(ctx, METRICS.barlinePostGap);
    const barlineDoubleCenterOffsetPx = ss(ctx, (METRICS.barlineOffsetX + METRICS.barlineDoubleSecondOffsetX) / 2);
    const parenWidthPx = ss(ctx, METRICS.parenthesisWidth);
    const parenInnerGapPx = ss(ctx, METRICS.parenthesisInnerGap);
    const parenVPadPx = ss(ctx, METRICS.parenthesisVPadding);
    // The closing arc is drawn tight to the last note's ink (its spine lands just
    // past rightX because the note's trailing advance is absorbed). Mirror that same
    // ink gap onto the opening arc so the two hug the group symmetrically, rather than
    // leaving the opening at the full reserved inner gap (which reads as too far away).
    const parenLeftSpine = (pstate, rightSpine) => {
        if (pstate.firstLeftX == null || pstate.lastRightX == null) return pstate.hingeX;
        const closingInkGap = rightSpine - pstate.lastRightX;
        return pstate.firstLeftX - closingInkGap;
    };
    const spacerAdvancePx = ss(ctx, METRICS.spacerAdvance);
    const halfNoteWPx = ss(ctx, METRICS.noteBoxWidth) * 0.5;
    const accAdvFlatPx = ss(ctx, METRICS.accidentalAdvanceFlat);
    const accAdvNaturalPx = ss(ctx, METRICS.accidentalAdvanceNatural);
    const accAdvSharpPx = ss(ctx, METRICS.accidentalAdvanceSharp);

    for (const sec of sections) {
        const items = flattenItems(sec.tokens);
        if (transposeState) applyTranspose(items, transposeState);
        const sectionHasClef = items.some(it => it.kind === 'clef');
        if (sectionHasClef) {
            hasSeenClef = true;
        }
        const drawClefForRows = hasSeenClef;

        // Barline-label targets are expressed in the user's lyric stream.
        // Record the source music counts before tenor recitations are expanded
        // into synthetic per-word layout pieces.
        let _labelLc = 0;
        const barlineLigsBeforeLabels = [];
        for (const it of items) {
            if (it.kind === 'ligature') { _labelLc++; }
            else if (it.kind === 'barline') { barlineLigsBeforeLabels.push(_labelLc); }
        }

        const verseSyllables = sec.lyrics.map(parseSyllables);
        const verseNotes = verseSyllables.map(arr => expandSyllablesForLigatures(arr.filter(s => s.kind === 'note')));
        // Expand any tenor recitation (single tenor note + multi-word syllable)
        // into one glyphless piece per word so the phrase can wrap between words.
        // Only happens with a single stanza (see expandTenorRecitations).
        expandTenorRecitations(items, verseNotes);
        const verseBarlines = verseSyllables.map(arr => arr.filter(s => s.kind === 'barline'));
        const verseCount = sec.lyrics.length;
        const totalLigatures = items.reduce((n, it) => n + (it.kind === 'ligature' ? 1 : 0), 0);
        const alignSyllables = totalLigatures > 0 && verseCount > 0;
        const hasBarlineLabels = verseBarlines.some(arr => arr.length > 0);

        // Build per-verse maps: globalBarlineIdx → label.
        // A label with notesBefore=K targets the first barline where ligsBefore >= K.
        const verseBarlineMaps = verseBarlines.map(lbls => {
            const m = new Map();
            for (const lbl of lbls) {
                const K = lbl.notesBefore ?? 0;
                for (let bi = 0; bi < barlineLigsBeforeLabels.length; bi++) {
                    if (barlineLigsBeforeLabels[bi] >= K && !m.has(bi)) {
                        m.set(bi, lbl);
                        break;
                    }
                }
            }
            return m;
        });

        // Which neumes carry real lyric text. Only gaps touching one of these
        // are leveled or justified (see isLeveledGap in measure.js), so a psalm
        // melody written without lyrics — or with nothing but division marks
        // such as `*` or `+` under it — keeps the default advance between its
        // notes instead of being spread across the row.
        for (const it of items) {
            if (it.kind === 'ligature') {
                it.hasLyric = justifyWithoutLyrics;
            }
        }

        // Reserve extra advance after a neume whose syllable is wider than the
        // neume's natural trailing slack, so the next neume isn't overlapped.
        if (alignSyllables) {
            // Inter-word gap reserved between neumes must match the gap the
            // lyric layout actually renders (a real space character), so the
            // note spacing follows the widened word break.
            const minGap = ctx.measureText(' ', ctx.lyricSize, ctx.textFont) || ctx.lyricSize * 0.25;
            // Width reserved for a forced ("=") hyphen between two syllables; must
            // match the gap emitAlignedSyllables opens for a mandatory hyphen.
            const hyphenReserve = ctx.measureText('.', ctx.lyricSize, ctx.textFont);
            const halfNoteW = halfNoteWPx;
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
                let maxPrefixW = 0;
                for (const notes of verseNotes) {
                    if (li < notes.length) {
                        const note = notes[li];
                        // Any stanza with real text here makes the neume lyric-bearing.
                        if (note.realLyric ?? hasRealLyricText(note)) {
                            it.hasLyric = true;
                        }
                        const alignW = measureSegmentsWidth(note.alignSegments || note.segments, ctx.lyricSize, ctx.textFont, ctx.measureText);
                        const suffixW = note.suffixSegments
                            ? measureSegmentsWidth(note.suffixSegments, ctx.lyricSize, ctx.textFont, ctx.measureText)
                            : 0;
                        if (alignW > maxSylW) maxSylW = alignW;
                        const rightEdge = isCentered ? halfNoteW + alignW / 2 + suffixW : alignW + suffixW;
                        if (rightEdge > maxCurrRight) maxCurrRight = rightEdge;
                        const fullW = measureSegmentsWidth(note.segments, ctx.lyricSize, ctx.textFont, ctx.measureText);
                        const prefixW = fullW - alignW - suffixW;
                        if (prefixW > maxPrefixW) maxPrefixW = prefixW;
                    }
                }
                const visualRight = it.recitationGlyphless
                    ? 0
                    : measureLigatureVisualRight(ctx, it.groups, it.gaps ?? []);
                const protectedCurrRight = isCentered
                    ? maxCurrRight
                    : Math.max(maxCurrRight, visualRight);
                ligInfo.push({ item: it, maxSylW, protectedCurrRight, isCentered, maxPrefixW, itemIdx });
                li++;
            }
            for (let i = 0; i < ligInfo.length; i++) {
                const { item, maxSylW, protectedCurrRight, isCentered } = ligInfo[i];
                // Recitation pieces have no notehead footprint: their whole advance
                // is the word's prose width carried by syllableExtra.
                const baseAdv = item.recitationGlyphless ? 0 : measureLigature(ctx, item.groups, item.gaps ?? []);
                // Right-edge offset from the ligature's left, including trailing punctuation.
                const currRight = protectedCurrRight;
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
                        // Prefix text (before ~~) extends leftward past the note center.
                        nextLeftIntrusion = Math.max(0, next.maxSylW / 2 + next.maxPrefixW - halfNoteW);
                    } else {
                        // Left-aligned neumes: text starts at the note's left edge; prefix extends further left.
                        nextLeftIntrusion = next.maxPrefixW;
                    }
                } else if (hasBarlineBetween && i + 1 < ligInfo.length) {
                    // The next syllable's leftward intrusion relative to its ligature
                    // start may eat into the barline's post-gap. Assign any excess as
                    // barlinePostExtra on the last barline before that ligature.
                    const next = ligInfo[i + 1];
                    const nextIntrusion = next.isCentered
                        ? Math.max(0, next.maxSylW / 2 + next.maxPrefixW - halfNoteW)
                        : next.maxPrefixW;
                    if (nextIntrusion > 0) {
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
                // A mandatory ("=") hyphen is always drawn, so unlike an ordinary
                // hyphen the pair cannot butt together: room for the hyphen must be
                // reserved in the note advance.
                let pairMandatory = false;
                if (i + 1 < ligInfo.length && !hasBarlineBetween) {
                    let pairExists = false;
                    let allHyphenated = true;
                    for (const notes of verseNotes) {
                        if (i < notes.length && i + 1 < notes.length) {
                            pairExists = true;
                            // Neumes within an extender run butt together with no word
                            // gap, just like a hyphen. The run's last slot (a single-
                            // underscore head, or the final placeholder) ends the word,
                            // so it does not connect to the following neume.
                            const ni = notes[i];
                            const connects = ni.hyphenAfter
                                || (ni.extenderCount || 0) >= 2
                                || (ni.extender && !ni.extenderLast);
                            if (!connects) {
                                allHyphenated = false;
                                break;
                            }
                            if (ni.hyphenAfter && ni.hyphenMandatory) pairMandatory = true;
                        }
                    }
                    pairConnected = pairExists && allHyphenated;
                }
                const gap = pairConnected ? (pairMandatory ? hyphenReserve : 0) : minGap;
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
            const lyricSpace = ctx.measureText(' ', ctx.lyricSize, ctx.textFont) || ctx.lyricSize * 0.25;
            let bi = 0;
            for (const it of items) {
                if (it.kind !== 'barline') {
                    continue;
                }
                let maxW = 0;
                for (const barlineMap of verseBarlineMaps) {
                    const lbl = barlineMap.get(bi);
                    if (lbl) {
                        const w = measureSegmentsWidth(lbl.segments, ctx.lyricSize, ctx.textFont, ctx.measureText);
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
        // slurState tracks an open \slur{ } or \slurSolid{ } span across rows.
        let slurState = null;

        // Pre-scan: only render a brace/slur span when both open and close are present.
        const completedBraceOpens = new Set();
        const completedSlurOpens = new Set();
        let pendingOpen = null;
        for (const row of rows) {
            for (const it of row.items) {
                if (it.kind === 'brace-open') {
                    pendingOpen = it;
                } else if (it.kind === 'brace-close' && pendingOpen) {
                    const isSlurKind = pendingOpen.braceKind === 'slur' || pendingOpen.braceKind === 'slurSolid';
                    if (isSlurKind) {
                        completedSlurOpens.add(pendingOpen);
                    } else {
                        completedBraceOpens.add(pendingOpen);
                    }
                    pendingOpen = null;
                }
            }
        }

        rows.forEach((row, rowIdx) => {
            const rowIndent = row.indentWidth || 0;
            const staffLeftX = ctx.leftMargin + rowIndent;
            // The marker carries the actual content top, which isn't known until
            // the row's decorations are drawn, so push a placeholder and patch it
            // at the end of the row. Capture per-row values that later code mutates.
            const nominalTop = Math.max(0, y - 2 * ctx.staffSpace);
            const rowPrevBottom = prevRowBottom;
            const rowIdxGlobal = globalRowIdx++;
            const markerIdx = parts.length;
            parts.push('');
            // Topmost / bottommost y reached by content in this row (Infinity /
            // -Infinity = nothing beyond the staff in that direction).
            let rowTopY = Infinity;
            let rowBottomY = -Infinity;
            const staffBottomY = y + ctx.staffHeight;
            parts.push(drawStaffLines(ctx, staffLeftX, staffRightX, staffBottomY));

            if (rowIndent > 0 && indentLines.length > 0) {
                const tx = ctx.leftMargin + rowIndent / 2;
                const indentLineHeight = indentFontSize * 1.2;
                const blockFirstY = staffBottomY - ctx.staffHeight / 2 + indentFontSize * 0.35
                    - (indentLines.length - 1) * indentLineHeight / 2;
                for (let li = 0; li < indentLines.length; li++) {
                    parts.push(`<text x="${tx}" y="${blockFirstY + li * indentLineHeight}" font-family="${escapedTextFont}" font-size="${indentFontSize}" text-anchor="middle" fill="#000">${renderSegments(parseFormattingToSegments(indentLines[li]))}</text>`);
                }
            }

            let cursorX = staffLeftX;
            const rowLigatures = [];
            const rowBarlines = [];
            // Recitation chains whose tenor notehead has already been drawn on
            // this row; the first piece of each chain per row draws the glyph,
            // giving the "repeat the note at each line start" behaviour.
            const recitationGlyphDrawn = new Set();

            // Bottom and visual right edge of the row's start clef — used below to
            // keep first-syllable lyric text from running under a clef whose tail
            // dips into the lyric band (treble clef, bottom-line C clef).
            let rowClefBottomY = -Infinity;
            let rowClefRightX = -Infinity;
            if (row.drawStartClef) {
                const c = drawClef(ctx, row.startClef, cursorX, staffBottomY);
                if (c.minY < rowTopY) rowTopY = c.minY;
                if (c.maxY > rowBottomY) rowBottomY = c.maxY;
                parts.push(wrapSrc(row.startClefSource || {}, c.svg, 'aretino-token aretino-clef', staffBottomY, ctx.staffHeight, undefined, undefined, sourceMap));
                rowClefBottomY = c.maxY;
                rowClefRightX = cursorX + c.advance - clefPostGapPx;
                cursorX += c.advance - clefPostGapPx + clefInlinePostGapPx;
            }

            const startKeySig = row.startKeySig ?? [];
            if (!row.drawStartClef && startKeySig.length > 0) {
                // Without a clef, leave the same minimum inset used by other
                // clefless row-start content before drawing the first accidental.
                cursorX += ctx.staffSpace / 2;
            }
            for (const acc of startKeySig) {
                const a = drawAccidental(ctx, acc.pitch, acc.symbol, cursorX, staffBottomY);
                parts.push(a.svg);
                cursorX += a.advance;
            }

            // Add proper spacing after clef/key sig and before notes
            if (row.drawStartClef || startKeySig.length > 0) {
                if (startKeySig.length === 0) {
                    cursorX += clefPostGapPx;
                } else {
                    cursorX += ctx.staffSpace;
                }
            } else {
                // No clef and no key sig: still add one staff space of emptiness
                cursorX += ctx.staffSpace;
            }

            // For the first syllable of a row, ensure prefix text (before ~~) doesn't
            // extend past the staff's left edge, and that no first-syllable text runs
            // under a start clef whose tail dips into the first lyric line.
            if (alignSyllables) {
                const firstLig = row.items.find(it => it.kind === 'ligature');
                // A neume continuation carries no syllable, so the row-start
                // left-limit (prefix/clef-overlap) logic doesn't apply to it.
                const firstLigItem = firstLig && !firstLig.neumeContinuation ? firstLig : null;
                if (firstLigItem) {
                    const halfNoteW = halfNoteWPx;
                    const isCenteredFirst = firstLigItem.groups.reduce((s, g) => s + g.length, 0) === 1
                        && !firstLigItem.groups.some(g => g.some(n => n.shape === 'tenor'));
                    let maxAlignW = 0;
                    let maxPrefixW = 0;
                    for (const notes of verseNotes) {
                        const ni = ligOffset;
                        if (ni < notes.length) {
                            const note = notes[ni];
                            const aW = measureSegmentsWidth(note.alignSegments || note.segments, ctx.lyricSize, ctx.textFont, ctx.measureText);
                            const sW = note.suffixSegments ? measureSegmentsWidth(note.suffixSegments, ctx.lyricSize, ctx.textFont, ctx.measureText) : 0;
                            const fW = measureSegmentsWidth(note.segments, ctx.lyricSize, ctx.textFont, ctx.measureText);
                            const pW = fW - aW - sW;
                            if (aW > maxAlignW) maxAlignW = aW;
                            if (pW > maxPrefixW) maxPrefixW = pW;
                        }
                    }
                    let leftLimit = maxPrefixW > 0 ? staffLeftX : -Infinity;
                    if ((maxAlignW > 0 || maxPrefixW > 0) && rowClefBottomY > -Infinity) {
                        const lowestNoteY = rowLowestNoteY(ctx, row, staffBottomY);
                        const lyricTopY = Math.max(
                            (lowestNoteY > staffBottomY ? lowestNoteY : staffBottomY) + ctx.lyricDistance,
                            staffBottomY + ctx.lyricMinStaffDistance);
                        if (rowClefBottomY > lyricTopY) {
                            const sideGap = ctx.measureText(' ', ctx.lyricSize, ctx.textFont) || ctx.lyricSize * 0.25;
                            leftLimit = Math.max(leftLimit, rowClefRightX + sideGap);
                        }
                    }
                    if (leftLimit > -Infinity) {
                        const textLeft = isCenteredFirst
                            ? cursorX + halfNoteW - maxAlignW / 2 - maxPrefixW
                            : cursorX - maxPrefixW;
                        const preGap = Math.max(0, leftLimit - textLeft);
                        cursorX += preGap;
                    }
                }
            }

            const remaining = staffRightX - cursorX;
            // When a row ends with a barline, the post-gap reserved for the
            // FOLLOWING syllable (barlinePostExtra) is meaningless — that syllable
            // has wrapped to the next line, so nothing follows the barline here.
            // Drop that reserve so the final barline keeps only its normal
            // barlinePostGap (plus any room its own centred label needs) before the
            // right margin, instead of the next syllable's reserve surviving as a
            // void. This makes a manual (z) break after a barline match an
            // automatic wrap.
            let itemsWidth = row.itemsWidth;
            const lastItem = row.items[row.items.length - 1];
            if (lastItem && lastItem.kind === 'barline') {
                itemsWidth -= (lastItem.barlinePostExtra || 0);
            }
            const extra = Math.max(0, remaining - itemsWidth);
            const expanderCount = row.items.reduce((n, it) => n + (it.kind === 'expander' ? 1 : 0), 0);
            let extraPerExpander = 0;
            // Per-gap justification space, indexed by the item the gap follows.
            const gapExtras = new Array(row.items.length).fill(0);
            if (extra > 0 && expanderCount > 0) {
                // Expanders are explicit slack absorbers: they soak up all the
                // leftover space (only when the row is justified).
                if (row.justify) {
                    extraPerExpander = extra / expanderCount;
                }
            } else if (extra > 0) {
                // Even out the space between neumes. Collect the justification
                // gaps (every inter-item boundary except an accidental glued to
                // its following neume) and the lyric-driven floor already baked
                // into each (a ligature's syllableExtra), then water-fill so the
                // gaps are as uniform as the budget permits.
                // Which boundaries count as gaps and how much whitespace each
                // already provides is shared with the line breaker (see
                // isLeveledGap/gapFloor in measure.js), which reserves the
                // leveling need when deciding where rows wrap.
                const gapIdx = [];
                const floors = [];
                const targetFloors = [];
                for (let i = 0; i < row.items.length - 1; i++) {
                    const it = row.items[i];
                    const next = row.items[i + 1];
                    if (!isLeveledGap(it, next)) {
                        continue;
                    }
                    gapIdx.push(i);
                    const f = gapFloor(ctx, it, next);
                    floors.push(f);
                    // Only plain neume-to-neume gaps set the water level; a
                    // barline-adjacent gap keeps its own width but must not drag
                    // the rest of the line out to match it.
                    if (isLevelingTargetGap(it, next)) targetFloors.push(f);
                }
                if (gapIdx.length > 0) {
                    // A justified row consumes all slack to reach the right
                    // margin. A ragged row levels every gap to the widest
                    // non-outlier floor (levelingTarget), so all neume
                    // distances on the line come out the same — except that a
                    // floor past gapOutlierThreshold keeps its own lyric-forced
                    // width instead of widening the whole line.
                    let budget;
                    if (row.justify) {
                        budget = extra;
                    } else {
                        const top = levelingTarget(ctx, targetFloors);
                        const neededToLevel = floors.reduce((s, f) => s + Math.max(0, top - f), 0);
                        budget = Math.min(extra, neededToLevel);
                    }
                    const level = justificationWaterLevel(floors, budget);
                    for (let k = 0; k < gapIdx.length; k++) {
                        gapExtras[gapIdx[k]] = Math.max(0, level - floors[k]);
                    }
                }
            }

            // If a parenthesised group carried over from the previous row, open a
            // new left-paren arc at the start of this row before the first item.
            if (parenState) {
                const placeIdx = parts.length;
                parts.push('');
                cursorX += parenWidthPx;
                const hingeX = cursorX;
                cursorX += parenInnerGapPx;
                parenState = { placeIdx, hingeX, closeHingeX: hingeX, minY: Infinity, maxY: -Infinity };
            }

            // If a brace/arc span carried over from the previous row, start a new
            // segment on this row from the current cursor position.
            if (braceState) {
                const placeIdx = parts.length;
                parts.push('');
                braceState = { ...braceState, placeIdx, startX: cursorX, endX: cursorX, minY: Infinity, isStart: false };
            }
            if (slurState) {
                const placeIdx = parts.length;
                parts.push('');
                slurState = { ...slurState, placeIdx, startX: cursorX, endX: cursorX, startNoteY: slurState.endNoteY, endNoteY: -Infinity, isStart: false };
            }

            for (let idx = 0; idx < row.items.length; idx++) {
                const it = row.items[idx];
                if (it.kind === 'clef') {
                    const c = drawClef(ctx, it.clef, cursorX, staffBottomY);
                    if (c.minY < rowTopY) rowTopY = c.minY;
                    if (c.maxY > rowBottomY) rowBottomY = c.maxY;
                    parts.push(wrapSrc(it, c.svg, 'aretino-token aretino-clef', staffBottomY, ctx.staffHeight, undefined, undefined, sourceMap));
                    cursorX += c.advance + clefInlinePostGapPx;
                } else if (it.kind === 'accidental') {
                    const a = drawAccidental(ctx, it.pitch, it.symbol, cursorX, staffBottomY);
                    parts.push(wrapSrc(it, a.svg, 'aretino-token aretino-accidental', staffBottomY, ctx.staffHeight, undefined, undefined, sourceMap));
                    let adv = a.advance;
                    if (it.symbol === 'x') adv = Math.max(adv, accAdvFlatPx);
                    else if (it.symbol === 'y') adv = Math.max(adv, accAdvNaturalPx);
                    else if (it.symbol === '#') adv = Math.max(adv, accAdvSharpPx);
                    cursorX += adv;
                } else if (it.kind === 'keysig') {
                    const startX = cursorX;
                    const pieces = [];
                    for (const acc of it.accidentals) {
                        const a = drawAccidental(ctx, acc.pitch, acc.symbol, cursorX, staffBottomY);
                        pieces.push(a.svg);
                        cursorX += a.advance;
                    }
                    if (pieces.length) {
                        parts.push(wrapSrc(it, pieces.join(''), 'aretino-token aretino-keysig', staffBottomY, ctx.staffHeight, undefined, undefined, sourceMap));
                        cursorX += keySigInlinePostGapPx;
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
                        const onLine = lastNote ? pitchToPos(lastNote) % 2 === 0 : true;
                        barlineSvg = drawPlicaBarline(ctx, cursorX + barlineOffsetXPx, cy, 'down', onLine);
                        barlineAdvance = barlineAdvancePx;
                    } else {
                        const b = drawBarline(ctx, it.value, cursorX, staffBottomY);
                        barlineSvg = b.svg;
                        barlineAdvance = b.advance;
                    }
                    parts.push(wrapSrc(it, barlineSvg, 'aretino-token aretino-barline', staffBottomY, ctx.staffHeight, undefined, undefined, sourceMap));
                    const offsetXPx = (it.value === '||' || it.value === ':|' || it.value === '|:' || it.value === ':|:' || it.value === '|||')
                        ? barlineDoubleCenterOffsetPx
                        : barlineOffsetXPx;
                    rowBarlines.push({ centerX: cursorX + offsetXPx, value: it.value, globalIdx: globalBarlineIdx });
                    globalBarlineIdx++;
                    cursorX += barlineAdvance + barlinePostGapPx + extra / 2 + postExtra;
                } else if (it.kind === 'spacer') {
                    cursorX += spacerAdvancePx * it.multiplier;
                } else if (it.kind === 'paren-open') {
                    const placeIdx = parts.length;
                    parts.push('');
                    cursorX += parenWidthPx;
                    const hingeX = cursorX;
                    cursorX += parenInnerGapPx;
                    parenState = { placeIdx, hingeX, closeHingeX: hingeX, minY: Infinity, maxY: -Infinity };
                } else if (it.kind === 'paren-close') {
                    if (parenState) {
                        const vPad = parenVPadPx;
                        const spanTop = parenState.minY - vPad;
                        if (parenState.minY < Infinity && spanTop < rowTopY) rowTopY = spanTop;
                        const spanBot = parenState.maxY + vPad;
                        if (parenState.maxY > -Infinity && spanBot > rowBottomY) rowBottomY = spanBot;
                        const rightSpine = parenState.closeHingeX - parenInnerGapPx - parenWidthPx;
                        parts[parenState.placeIdx] = drawParenthesis(ctx, parenLeftSpine(parenState, rightSpine), spanTop, spanBot, 'left');
                        parts.push(drawParenthesis(ctx, rightSpine, spanTop, spanBot, 'right'));
                        parenState = null;
                    }
                    cursorX += parenInnerGapPx + parenWidthPx;
                } else if (it.kind === 'brace-open') {
                    if (completedBraceOpens.has(it)) {
                        const placeIdx = parts.length;
                        parts.push('');
                        braceState = { placeIdx, braceKind: it.braceKind, startX: cursorX, endX: cursorX, minY: Infinity, isStart: true };
                    } else if (completedSlurOpens.has(it)) {
                        const placeIdx = parts.length;
                        parts.push('');
                        slurState = { placeIdx, dashed: it.braceKind === 'slur', startX: cursorX, endX: cursorX, startNoteY: null, endNoteY: -Infinity, isStart: true };
                    }
                } else if (it.kind === 'brace-close') {
                    if (braceState) {
                        braceState.label = it.label ?? null;
                        const braceTop = _flushBrace(ctx, parts, braceState, staffBottomY, true, textFont);
                        if (braceTop < rowTopY) rowTopY = braceTop;
                        braceState = null;
                    } else if (slurState) {
                        const slurBot = _flushSlur(ctx, parts, slurState, staffBottomY, true);
                        if (slurBot > rowBottomY) rowBottomY = slurBot;
                        slurState = null;
                    }
                } else if (it.kind === 'ligature' && it.recitationGlyphless) {
                    // Recitation piece: one word of a wrapping tenor phrase. Draw
                    // the tenor notehead only for the first piece of this chain on
                    // the row (the original on the first row, repeated thereafter);
                    // the word itself is laid out as a left-aligned syllable.
                    lastNote = it.groups[0][0];
                    if (!recitationGlyphDrawn.has(it.recitationChainId)) {
                        const g = emitLigature(ctx, it.groups, cursorX, staffBottomY, [], []);
                        parts.push(wrapSrc(it, g.svg, 'aretino-token aretino-ligature', staffBottomY, ctx.staffHeight, g.leftX, g.rightX - g.leftX, sourceMap));
                        if (g.minY < rowTopY) rowTopY = g.minY;
                        if (g.maxY > rowBottomY) rowBottomY = g.maxY;
                        recitationGlyphDrawn.add(it.recitationChainId);
                    }
                    rowLigatures.push({ centerX: cursorX, leftX: cursorX, rightX: cursorX, shouldAlignLeft: true });
                    cursorX += (it.syllableExtra || 0);
                } else if (it.kind === 'ligature') {
                    const lastGroup = it.groups[it.groups.length - 1];
                    lastNote = lastGroup[lastGroup.length - 1];
                    const r = emitLigature(ctx, it.groups, cursorX, staffBottomY, it.gaps ?? [], it.leadingCourtesyAccidentals ?? []);
                    let ligSvg = r.svg;
                    if (r.minY < rowTopY) rowTopY = r.minY;
                    if (r.maxY > rowBottomY) rowBottomY = r.maxY;
                    if (it.label != null && r.minY < Infinity) {
                        const fontSize = ctx.lyricSize * 0.8;
                        const staffTopY = staffBottomY - 4 * ctx.staffSpace - ctx.lyricSize * 0.16;
                        const labelY = Math.min(r.minY, staffTopY) - fontSize * 0.15;
                        ligSvg += renderMixedLabel(parseFormattingToSegments(it.label), r.leftX, labelY, fontSize, ctx.textFont, 'start', ctx.measureText);
                        if (labelY - fontSize < rowTopY) rowTopY = labelY - fontSize;
                    }
                    parts.push(wrapSrc(it, ligSvg, 'aretino-token aretino-ligature', staffBottomY, ctx.staffHeight, r.leftX, r.rightX - r.leftX, sourceMap));
                    // A neume continuation (the tail of a '/'-split neume wrapped
                    // to this row) carries no syllable, so it must not consume a
                    // syllable slot in the 1-ligature⇄1-syllable alignment.
                    if (!it.neumeContinuation) {
                        rowLigatures.push({ centerX: r.centerX, leftX: r.leftX, rightX: r.rightX, shouldAlignLeft: r.shouldAlignLeft });
                    }
                    if (parenState) {
                        if (r.minY < parenState.minY) parenState.minY = r.minY;
                        if (r.maxY > parenState.maxY) parenState.maxY = r.maxY;
                        if (parenState.firstLeftX == null) parenState.firstLeftX = r.leftX;
                        parenState.lastRightX = r.rightX;
                        parenState.closeHingeX = cursorX + r.advance;
                    }
                    if (braceState) {
                        if (r.minY < braceState.minY) braceState.minY = r.minY;
                        braceState.endX = r.rightX;
                    }
                    if (slurState) {
                        if (slurState.startNoteY == null) {
                            slurState.startNoteY = r.maxY;
                            slurState.startX = r.firstNoteCx ?? r.centerX;
                        }
                        slurState.endNoteY = r.maxY;
                        slurState.endX = r.lastNoteCx ?? r.centerX;
                    }
                    cursorX += r.advance + (it.syllableExtra || 0);
                }
                if (idx < row.items.length - 1) {
                    // gapExtras is already zero for glued accidental+neume pairs.
                    cursorX += gapExtras[idx];
                }
            }

            // If a parenthesised group was opened on this row but its paren-close
            // sits on a later row, close the arcs visually here and carry the open
            // state to the next row.
            if (parenState) {
                const vPad = parenVPadPx;
                const spanTop = parenState.minY < Infinity ? parenState.minY - vPad : staffBottomY - 4 * ctx.staffSpace - vPad;
                if (spanTop < rowTopY) rowTopY = spanTop;
                const spanBot = parenState.maxY > -Infinity ? parenState.maxY + vPad : staffBottomY + vPad;
                if (spanBot > rowBottomY) rowBottomY = spanBot;
                const overflowRightSpine = parenState.closeHingeX - parenInnerGapPx - parenWidthPx;
                parts[parenState.placeIdx] = drawParenthesis(ctx, parenLeftSpine(parenState, overflowRightSpine), spanTop, spanBot, 'left');
                parts.push(drawParenthesis(ctx, overflowRightSpine, spanTop, spanBot, 'right'));
                // Signal the next row to re-open the group (parenState truthy = continuation).
                parenState = { continuation: true };
            }

            // If a brace/arc span was opened on this row but its close is on a
            // later row, draw this row's segment and carry the state forward.
            if (braceState) {
                const braceTop = _flushBrace(ctx, parts, braceState, staffBottomY, false, textFont);
                if (braceTop < rowTopY) rowTopY = braceTop;
                braceState = { braceKind: braceState.braceKind, label: braceState.label, continuation: true };
            }
            if (slurState) {
                const slurBot = _flushSlur(ctx, parts, slurState, staffBottomY, false);
                if (slurBot > rowBottomY) rowBottomY = slurBot;
                slurState = { dashed: slurState.dashed, continuation: true };
            }

            const isLastRow = rowIdx === rows.length - 1;
            const rowLigCount = rowLigatures.length;
            const lowestNoteY = rowLowestNoteY(ctx, row, staffBottomY);
            const lyricTopY = Math.max(
                (lowestNoteY > staffBottomY ? lowestNoteY : staffBottomY) + ctx.lyricDistance,
                staffBottomY + ctx.lyricMinStaffDistance);
            let lyricY = lyricTopY + ctx.lyricSize;

            if (alignSyllables) {
                for (let v = 0; v < verseCount; v++) {
                    const notes = verseNotes[v];
                    const start = ligOffset;
                    const end = isLastRow
                        ? Math.max(notes.length, ligOffset + rowLigCount)
                        : ligOffset + rowLigCount;
                    const rowSyllables = notes.slice(start, end);
                    const aligned = emitAlignedSyllables(ctx, rowSyllables, rowLigatures, lyricY);
                    parts.push(aligned.svg);
                    if (aligned.maxX > maxRenderedX) maxRenderedX = aligned.maxX;
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
                prevRowBottom = lastLyricBottom;
            } else if (isLastRow && verseCount > 0) {
                for (const lyric of sec.lyrics) {
                    const lyricSvg = `<text xml:space="preserve" x="${staffLeftX}" y="${lyricY}" font-family="${escapedTextFont}" font-size="${ctx.lyricSize}" fill="#000">${formatLyricLine(lyric)}</text>`;
                    parts.push(wrapSrc(lyric, lyricSvg, 'aretino-lyric aretino-lyric-line', undefined, undefined, undefined, undefined, sourceMap));
                    lyricY += lyricLineHeight;
                }
                const lastLyricBottom = lyricY - lyricLineHeight + ctx.lyricSize * 0.3;
                contentBottom = Math.max(contentBottom, lastLyricBottom);
                sectionContentBottom = lastLyricBottom;
                y = lastLyricBottom + ctx.staffGap;
                prevRowBottom = lastLyricBottom;
            } else {
                y = staffBottomY;
                sectionContentBottom = y;
                contentBottom = Math.max(contentBottom, y);
                prevRowBottom = staffBottomY;
            }

            // Fold in any below-staff ink (slurs, low notes, paren arcs) that reaches
            // past the row's text/lyric bottom, so neither the full SVG nor the
            // per-row split (whose height keys off prevRowBottom) clips it.
            if (rowBottomY > prevRowBottom) {
                prevRowBottom = rowBottomY;
                y = Math.max(y, rowBottomY + ctx.staffGap);
            }
            contentBottom = Math.max(contentBottom, rowBottomY);
            sectionContentBottom = Math.max(sectionContentBottom, rowBottomY);

            // Patch the row marker now that the actual content top is known. The
            // marker carries: index, nominal top (2 SS above staff), previous row's
            // content bottom, and the real content top (which may sit above the
            // nominal top when high notes/decorations reach further up).
            const contentTopY = Math.min(nominalTop, rowTopY);
            if (rowTopY < minRenderedY) minRenderedY = rowTopY;
            parts[markerIdx] = `<!-- aretino-row ${rowIdxGlobal} ${nominalTop.toFixed(3)} ${rowPrevBottom.toFixed(3)} ${contentTopY.toFixed(3)} -->`;
        });

        if (sec.verses && sec.verses.length > 0) {
            const verseResult = renderVerseLines(ctx, sec.verses, ctx.leftMargin, staffRightX, sectionContentBottom);
            if (rows.length === 0) {
                // A section of pure text produces no staff row, so without this
                // the score would carry no row markers at all and could neither
                // be split for an incipit nor paginated. Each text block is its
                // own row; when the section does have staff rows the text
                // belongs to the last of them and stays inside it.
                let rowPrev = prevRowBottom;
                for (const block of verseResult.blocks) {
                    parts.push(`<!-- aretino-row ${globalRowIdx++} ${block.top.toFixed(3)} ${rowPrev.toFixed(3)} ${block.top.toFixed(3)} -->`);
                    parts.push(block.svg);
                    rowPrev = block.bottom;
                }
            } else {
                parts.push(verseResult.svg);
            }
            y = verseResult.bottom + ctx.staffGap;
            contentBottom = Math.max(contentBottom, verseResult.bottom);
            prevRowBottom = verseResult.bottom;
        }

        currentClef = trailingClef(items, currentClef);
        currentKeySig = trailingKeySig(items, currentKeySig);
    }

    const totalHeight = canvasHeight || contentBottom + ctx.staffSpace * 0.5;
    // viewBox is the logical layout space; the intrinsic width/height are the
    // physical pixel size magnified by `zoom`. Emitting concrete dimensions
    // (rather than width="100%") means a staff space renders at its true
    // physical size regardless of container width. Consumers that want
    // shrink-to-fit can add `max-width:100%;height:auto` in CSS.
    // Grow the viewBox upward/rightward to include anything drawn above the page
    // top (decorations on high notes in row 0) or past the canvas width (a trailing
    // row-break hyphen). viewTop <= 0; viewWidth >= width.
    const viewTop = Math.min(0, Math.floor(minRenderedY));
    const viewWidth = maxRenderedX > width ? Math.ceil(maxRenderedX) + 1 : width;
    const viewHeight = totalHeight - viewTop;
    const renderW = Math.round(viewWidth * zoom);
    const renderH = Math.round(viewHeight * zoom);
    const interactiveStyle = sourceMap ? HIGHLIGHT_STYLE : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${viewTop} ${viewWidth} ${viewHeight}" width="${renderW}" height="${renderH}" preserveAspectRatio="xMidYMin meet" style="display:block">${interactiveStyle}${parts.join('')}<!-- aretino-rows-end ${totalHeight.toFixed(3)} --></svg>`;
}

/**
 * Split a rendered Aretino SVG string into one standalone SVG per staff row.
 * Returns null if the SVG lacks the expected row marker comments.
 */
export function splitRowSVGs(svg) {
    const svgTagMatch = svg.match(/^<svg([^>]*)>/);
    if (!svgTagMatch) return null;
    const attrs = svgTagMatch[1];
    // The origin may be non-zero/negative when the renderer grew the viewBox to
    // include content above the page top or past the canvas width; capture width.
    const viewBoxMatch = attrs.match(/viewBox="-?[\d.]+ -?[\d.]+ ([\d.]+) -?[\d.]+"/);
    if (!viewBoxMatch) return null;
    const totalW = parseFloat(viewBoxMatch[1]);
    const widthAttrMatch = attrs.match(/\bwidth="(\d+)"/);
    const zoom = widthAttrMatch ? parseInt(widthAttrMatch[1]) / totalW : 1;

    const inner = svg.slice(svgTagMatch[0].length, svg.lastIndexOf('</svg>'));

    // Each marker stores topY (viewBox top) and prevContentBottom (content bottom of
    // the preceding row). The height of row i's SVG extends to at least prevContentBottom
    // of marker i+1 so that lyrics from row i are never clipped when staffGap < 2 staff
    // spaces. When staffGap >= 2 staff spaces the nextTopY term dominates and behaviour
    // is identical to the original formula.
    // 4th field (contentTopY) is the real content top; optional for SVGs produced
    // before it was added, in which case it falls back to the nominal top.
    const rowRe = /<!--\s*aretino-row\s+\d+\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s+(-?[\d.]+))?\s*-->/g;
    const markers = [];
    let m;
    while ((m = rowRe.exec(inner)) !== null) {
        const y = parseFloat(m[1]);
        markers.push({
            y,
            prevContentBottom: parseFloat(m[2]),
            contentTopY: m[3] !== undefined ? parseFloat(m[3]) : y,
            markerStart: m.index,
            contentStart: m.index + m[0].length,
        });
    }
    if (markers.length === 0) return null;

    const endMatch = inner.match(/<!--\s*aretino-rows-end\s+([\d.]+)\s*-->/);
    const totalH = endMatch ? parseFloat(endMatch[1]) : 0;
    const innerEnd = endMatch ? endMatch.index : inner.length;

    const preamble = inner.slice(0, markers[0].markerStart);

    return markers.map((marker, i) => {
        const contentEnd = i + 1 < markers.length ? markers[i + 1].markerStart : innerEnd;
        const content = inner.slice(marker.contentStart, contentEnd);
        const renderW = Math.round(totalW * zoom);
        const nextTopY = i + 1 < markers.length ? markers[i + 1].y : totalH;
        const nextPCB = i + 1 < markers.length ? markers[i + 1].prevContentBottom : totalH;
        const bottomY = Math.max(nextTopY, nextPCB);
        if (i === 0) {
            // First row: include headers (preamble) by covering the full region from
            // the page top (y=0), extended up to contentTopY if a decoration/high note
            // reaches above it. Extend down to at least the next marker's
            // prevContentBottom so row-0 lyrics are not clipped when staffGap is
            // smaller than the 2-staff-space headroom.
            const rowTop = Math.min(0, marker.contentTopY);
            const rowH = parseFloat((bottomY - rowTop).toFixed(3));
            const renderH = Math.round(rowH * zoom);
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${rowTop} ${totalW} ${rowH}" width="${renderW}" height="${renderH}" preserveAspectRatio="xMidYMin meet" style="display:block">${preamble}${content}</svg>`;
        }
        // Later rows are translated so their region starts at y=0; pull the origin up
        // to contentTopY when content reaches above the nominal top.
        const rowTop = Math.min(marker.y, marker.contentTopY);
        const rowH = parseFloat((bottomY - rowTop).toFixed(3));
        const renderH = Math.round(rowH * zoom);
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${rowH}" width="${renderW}" height="${renderH}" preserveAspectRatio="xMidYMin meet" style="display:block"><g transform="translate(0,${(-rowTop).toFixed(3)})">${content}</g></svg>`;
    });
}

/**
 * Render only the first musical staff row, with no title/header content.
 * Returns a standalone SVG string, or null if the source produces no rows.
 */
export function renderFirstRow(source, options = {}) {
    const svg = renderAretino(source, { ...options, noHeader: true });
    const rows = splitRowSVGs(svg);
    return rows ? rows[0] : null;
}
