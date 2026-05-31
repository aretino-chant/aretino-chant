/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { escapeAttr } from './glyphs.js';
import { wrapSrc } from './svg.js';
import {
    LITERAL_HYPHEN,
    LITERAL_OPEN_PAREN,
    LITERAL_UNDERSCORE,
    measureTextWidth,
    measureSegmentsWidth,
    sliceSegments,
    trimSegmentsEnd,
    parseFormattingToSegments,
    parseFormattingToSegmentsWithSource,
    renderSegments,
    renderUnderlines,
    renderMixedLabel,
} from './text.js';

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
//
// An extender syllable ("ro__") is held over extenderCount neumes total: its
// own neume plus one per *extra* underscore. So "ro_" covers just its own
// neume, "ro__" its own plus the next, etc. The placeholder slots (one per
// extra underscore) are marked `extender:true` so a continuous prolongation
// line is drawn over them instead of hyphens; the last one carries
// `extenderLast` (and the extender's trailing punctuation).
export function expandSyllablesForLigatures(notes) {
    const expanded = [];
    for (const syl of notes) {
        const n = syl.noteGroupCount || 1;
        const isExtender = (syl.extenderCount || 0) > 0;
        expanded.push(syl);
        for (let k = 1; k < n; k++) {
            const isLast = k === n - 1;
            expanded.push({
                text: '',
                alignText: '',
                segments: [],
                alignSegments: [],
                suffixSegments: [],
                hyphenAfter: isExtender ? false : (isLast ? syl.hyphenAfter : true),
                hyphenMandatory: isExtender ? false : (syl.hyphenMandatory || false),
                extender: isExtender,
                extenderLast: isExtender && isLast,
                extenderSuffixSegments: isExtender && isLast ? (syl.extenderSuffixSegments || []) : [],
                kind: 'note',
            });
        }
    }
    return expanded;
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
export function parseSyllables(input) {
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
            formatMap.push({ bold: seg.bold, italic: seg.italic, underline: seg.underline, color: seg.color, smallCaps: seg.smallCaps, small: seg.small, large: seg.large });
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
        let f0 = formatMap[start] || { bold: false, italic: false, underline: false, color: null, smallCaps: false, small: false, large: false };
        let runBold = f0.bold, runItalic = f0.italic, runUnderline = f0.underline, runColor = f0.color, runSmallCaps = f0.smallCaps, runSmall = f0.small, runLarge = f0.large;
        for (let p = start + 1; p < end; p++) {
            const f = formatMap[p] || { bold: false, italic: false, underline: false, color: null, smallCaps: false, small: false, large: false };
            if (f.bold !== runBold || f.italic !== runItalic || f.underline !== runUnderline || f.color !== runColor || f.smallCaps !== runSmallCaps || f.small !== runSmall || f.large !== runLarge) {
                segments.push({ text: displayFn(cleaned.slice(runStart, p)), bold: runBold, italic: runItalic, underline: runUnderline, color: runColor, smallCaps: runSmallCaps, small: runSmall, large: runLarge });
                runStart = p;
                runBold = f.bold; runItalic = f.italic; runUnderline = f.underline; runColor = f.color; runSmallCaps = f.smallCaps; runSmall = f.small; runLarge = f.large;
            }
        }
        segments.push({ text: displayFn(cleaned.slice(runStart, end)), bold: runBold, italic: runItalic, underline: runUnderline, color: runColor, smallCaps: runSmallCaps, small: runSmall, large: runLarge });
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
            const segments = buildSegments(innerStart, innerEnd, s => s.replace(/~/g, ' ').replaceAll(LITERAL_OPEN_PAREN, '('));
            i = end < 0 ? cleaned.length : end + 1;
            result.push({
                text: cleaned.slice(innerStart, innerEnd).replace(/~/g, ' ').replaceAll(LITERAL_OPEN_PAREN, '('),
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
                if (peek < cleaned.length && (cleaned[peek] === '-' || cleaned[peek] === '=')) {
                    j++;
                    continue;
                }
                break;
            }
            wordChars.push(c);
            wordCharIndexes.push(j);
            skipWhitespaceAfterHyphen = c === '-' || c === '=';
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
            while (wPos < word.length && word[wPos] !== '-' && word[wPos] !== '=' && word[wPos] !== '_') wPos++;
            const sylEnd = wPos;
            let trailingHyphens = 0;
            let hyphenMandatory = false;
            let extenderCount = 0;
            while (wPos < word.length && (word[wPos] === '-' || word[wPos] === '=' || word[wPos] === '_')) {
                if (word[wPos] === '=') { hyphenMandatory = true; trailingHyphens++; }
                else if (word[wPos] === '_') { extenderCount++; }
                else { trailingHyphens++; }
                wPos++;
            }
            // Punctuation right after an extender run (e.g. "ro_.") belongs to the
            // extender's end: it is drawn at the right edge of the last extended
            // neume, mirroring how "ro." sits at the right of ro's own neume.
            let sufStart = -1;
            let sufEnd = -1;
            if (extenderCount > 0) {
                sufStart = wPos;
                while (wPos < word.length && '.,;:!?'.includes(word[wPos])) wPos++;
                sufEnd = wPos;
            }
            if (sylEnd > sylStart) {
                sylParts.push({ raw: word.slice(sylStart, sylEnd), startIdx: sylStart, endIdx: sylEnd, trailingHyphens, hyphenMandatory, extenderCount, sufStart, sufEnd });
            }
        }
        for (const { raw, startIdx, endIdx, trailingHyphens, hyphenMandatory, extenderCount, sufStart, sufEnd } of sylParts) {
            const isExtender = extenderCount > 0;
            const absStart = wordCharIndexes[startIdx];
            const absEnd = wordCharIndexes[endIdx - 1] + 1;
            // Match the hyphen convention: a syllable's source span covers only its
            // own letters, not the trailing separators (hyphens/underscores).
            const sourceSpan = sourceSpanForCleanedRange(absStart, absEnd);
            const tildeIdx = raw.indexOf('~~');
            let text, alignText;
            if (tildeIdx !== -1) {
                text = raw.slice(0, tildeIdx).replace(/~/g, ' ').replaceAll(LITERAL_HYPHEN, '-').replaceAll(LITERAL_OPEN_PAREN, '(').replaceAll(LITERAL_UNDERSCORE, '_') + ' ' + raw.slice(tildeIdx + 2).replace(/~/g, ' ').replaceAll(LITERAL_HYPHEN, '-').replaceAll(LITERAL_OPEN_PAREN, '(').replaceAll(LITERAL_UNDERSCORE, '_');
                alignText = raw.slice(tildeIdx + 2).replace(/~/g, ' ').replaceAll(LITERAL_HYPHEN, '-').replaceAll(LITERAL_OPEN_PAREN, '(').replaceAll(LITERAL_UNDERSCORE, '_');
            } else {
                text = raw.replace(/~/g, ' ').replaceAll(LITERAL_HYPHEN, '-').replaceAll(LITERAL_OPEN_PAREN, '(').replaceAll(LITERAL_UNDERSCORE, '_');
                alignText = text;
            }
            const segments = buildSegments(absStart, absEnd, s => s.replace(/~~/g, ' ').replace(/~/g, ' ').replaceAll(LITERAL_HYPHEN, '-').replaceAll(LITERAL_OPEN_PAREN, '(').replaceAll(LITERAL_UNDERSCORE, '_'));
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
            // Extender trailing punctuation, rendered at the line's far end.
            let extenderSuffixSegments = [];
            if (isExtender && sufEnd > sufStart) {
                const sufAbsStart = wordCharIndexes[sufStart];
                const sufAbsEnd = wordCharIndexes[sufEnd - 1] + 1;
                extenderSuffixSegments = buildSegments(sufAbsStart, sufAbsEnd, s => s.replace(/~/g, ' ').replaceAll(LITERAL_HYPHEN, '-').replaceAll(LITERAL_OPEN_PAREN, '(').replaceAll(LITERAL_UNDERSCORE, '_'));
            }
            // An extender holds the syllable over its own neume plus one per
            // *extra* underscore, so it occupies extenderCount neumes in total.
            const groupCount = isExtender ? extenderCount : Math.max(1, trailingHyphens);
            result.push({
                text,
                alignText,
                segments,
                alignSegments,
                suffixSegments,
                hyphenAfter: !isExtender && trailingHyphens > 0,
                hyphenMandatory: !isExtender && trailingHyphens > 0 && hyphenMandatory,
                noteGroupCount: groupCount,
                extenderCount: isExtender ? extenderCount : 0,
                extenderSuffixSegments,
                kind: 'note',
                ...sourceSpan,
            });
            noteCount += groupCount;
        }
    }
    return result;
}

// Converts a lyric line with formatting syntax into SVG tspan elements.
export function formatLyricLine(text) {
    return renderSegments(parseFormattingToSegments(lyricText(text)));
}

// Renders parenthesized lyric tokens centered under their corresponding
// barlines. Each label pairs in order with the barlines that appeared in this
// row; extra labels beyond the row's barline count are skipped.
export function emitBarlineLabels(ctx, labels, barlines, lyricY) {
    if (labels.length === 0 || barlines.length === 0) {
        return '';
    }
    const fontSize = ctx.lyricSize;
    const fontFamily = ctx.textFont;
    const parts = [];
    const n = Math.min(labels.length, barlines.length);
    for (let i = 0; i < n; i++) {
        const text = labels[i].text;
        if (text === '') {
            continue;
        }
        const cx = barlines[i].centerX;
        const label = labels[i];
        const labelSvg = renderMixedLabel(label.segments, cx, lyricY, fontSize, fontFamily, 'middle', ctx.measureText ?? measureTextWidth)
            + renderUnderlines(label.segments, cx, lyricY, fontSize, fontFamily, 'middle', ctx.measureText ?? measureTextWidth);
        parts.push(wrapSrc(label, labelSvg, 'aretino-lyric aretino-barline-label', undefined, undefined, undefined, undefined, ctx.sourceMap));
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
            result.push({ text: appendStr, bold: orig.bold || false, italic: orig.italic || false, underline: orig.underline || false, color: orig.color || null, smallCaps: orig.smallCaps || false, small: orig.small || false, large: orig.large || false });
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
export function emitAlignedSyllables(ctx, syllables, ligatures, lyricY) {
    if (syllables.length === 0) {
        return { svg: '', maxX: 0 };
    }
    const fontSize = ctx.lyricSize;
    const fontFamily = ctx.textFont;
    // Minimum gap between syllables of different words: the font's real space
    // character, so an implicit word break is spaced exactly like an explicit
    // ~ (which renders a literal space). A fixed fraction of the font size
    // (e.g. 0.18em) is narrower than a true space and reads as too tight.
    const measureFn = ctx.measureText ?? measureTextWidth;
    const minGap = measureFn(' ', fontSize, fontFamily) || fontSize * 0.25;
    // A hyphen occupies the width of an 'n' character; if the gap between
    // syllables is smaller than that, there is no room to render it.
    const hyphenSpaceW = measureFn('.', fontSize, fontFamily);
    const trailingAdvance = fontSize * 0.6;

    const parts = [];
    let prevRight = -Infinity;
    let lastRight = null;
    // Rightmost ink, including hyphens, so the caller can grow the viewBox width.
    let maxX = 0;
    // Track the parts[] index and left position of the previous syllable so it can be
    // re-rendered in-place when a Hungarian digraph transform fires on collapse.
    let prevSylIdx = -1;
    let prevLeft = 0;
    const workSyllables = syllables.slice();
    // Extender prolongation line: the x-span [extStartX, extEndX] of the line
    // currently being built, or nulls when no extender is in progress. State is
    // reset per call, i.e. per row, so a line that wraps simply restarts at the
    // next row's first extended neume.
    let extStartX = null;
    let extEndX = null;
    let extTextRightX = null;
    const extenderGap = fontSize * 0.15;
    const extenderStrokeW = Math.max(0.5, fontSize * 0.06);
    // Prolongation lines shorter than this are visual stubs, so they are dropped.
    // A single short note under the syllable text leaves little or no room past
    // the text, so most single-underscore ("ro_") extenders draw nothing.
    const extenderMinLen = fontSize * 0.5;
    const flushExtender = () => {
        let drewLine = false;
        if (extStartX !== null && extEndX !== null && extEndX - extStartX >= extenderMinLen) {
            parts.push(`<line x1="${extStartX}" y1="${lyricY}" x2="${extEndX}" y2="${lyricY}" stroke="#000" stroke-width="${extenderStrokeW}"/>`);
            if (extEndX > maxX) maxX = extEndX;
            drewLine = true;
        }
        extStartX = null;
        extEndX = null;
        extTextRightX = null;
        return drewLine;
    };

    for (let i = 0; i < workSyllables.length; i++) {
        let syl = workSyllables[i];
        let fullW = measureSegmentsWidth(syl.segments, fontSize, fontFamily, measureFn);
        let alignW = measureSegmentsWidth(syl.alignSegments || syl.segments, fontSize, fontFamily, measureFn);
        let suffixW = syl.suffixSegments ? measureSegmentsWidth(syl.suffixSegments, fontSize, fontFamily, measureFn) : 0;
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
            const prevSyl = workSyllables[i - 1];
            const needsHyphen = prevSyl.hyphenAfter;
            if (needsHyphen) {
                if (left - prevRight >= hyphenSpaceW || prevSyl.hyphenMandatory) {
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
                        const newFullW1 = measureSegmentsWidth(transformed[0].segments, fontSize, fontFamily, measureFn);
                        const newTC1 = prevLeft + newFullW1 / 2;
                        const newSvg1 = `<text xml:space="preserve" x="${newTC1}" y="${lyricY}" font-family="${escapeAttr(fontFamily)}" font-size="${fontSize}" text-anchor="middle" fill="#000">${renderSegments(transformed[0].segments)}</text>`
                            + renderUnderlines(transformed[0].segments, newTC1, lyricY, fontSize, fontFamily, 'middle', measureFn);
                        parts[prevSylIdx] = wrapSrc(transformed[0], newSvg1, 'aretino-lyric aretino-syllable', undefined, undefined, undefined, undefined, ctx.sourceMap);
                        prevRight = prevLeft + newFullW1;
                        fullW = measureSegmentsWidth(syl.segments, fontSize, fontFamily, measureFn);
                        alignW = measureSegmentsWidth(syl.alignSegments || syl.segments, fontSize, fontFamily, measureFn);
                        suffixW = syl.suffixSegments ? measureSegmentsWidth(syl.suffixSegments, fontSize, fontFamily, measureFn) : 0;
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
            + renderUnderlines(syl.segments, textCenter, lyricY, fontSize, fontFamily, 'middle', measureFn);
        prevSylIdx = parts.length;
        prevLeft = left;
        parts.push(wrapSrc(syl, syllableSvg, 'aretino-lyric aretino-syllable', undefined, undefined, undefined, undefined, ctx.sourceMap));
        if (hyphenX !== null) {
            parts.push(`<text x="${hyphenX}" y="${lyricY}" font-family="${escapeAttr(fontFamily)}" font-size="${fontSize}" text-anchor="middle" fill="#000">-</text>`);
            if (hyphenX + hyphenSpaceW / 2 > maxX) maxX = hyphenX + hyphenSpaceW / 2;
        }
        // Extender ("ro_", "ro__"): the syllable is held over its own neume plus
        // one further neume per extra underscore. Build a single continuous
        // prolongation line from just past the syllable text toward the right edge
        // of the last held neume; trailing punctuation ("ro_.") is included in
        // that held span rather than extending beyond it.
        const isExtenderHead = (syl.extenderCount || 0) > 0;
        if (isExtenderHead || syl.extender) {
            const lig = i < ligatures.length ? ligatures[i] : null;
            const ligRight = lig ? (lig.rightX ?? lig.centerX) : right;
            if (isExtenderHead) {
                // Head: the line starts past this syllable's text and already
                // covers the syllable's own (current) neume.
                extTextRightX = right;
                extStartX = right + extenderGap;
            } else if (extStartX === null) {
                // Row started mid-extender: begin at this neume's left edge.
                extStartX = lig ? lig.leftX : left;
            }
            extEndX = ligRight;
            const isLast = isExtenderHead ? syl.extenderCount === 1 : syl.extenderLast;
            if (isLast) {
                const suf = syl.extenderSuffixSegments || [];
                const targetRight = extEndX;
                const sufW = measureSegmentsWidth(suf, fontSize, fontFamily, measureFn);
                if (sufW > 0 && targetRight !== null) {
                    extEndX = targetRight - sufW - extenderGap;
                }
                const textRight = extTextRightX;
                const drewLine = flushExtender();
                if (suf.length) {
                    const sx = drewLine ? targetRight : (textRight ?? targetRight ?? right);
                    const anchor = drewLine ? 'end' : 'start';
                    parts.push(`<text xml:space="preserve" x="${sx}" y="${lyricY}" font-family="${escapeAttr(fontFamily)}" font-size="${fontSize}" text-anchor="${anchor}" fill="#000">${renderSegments(suf)}</text>`);
                    const suffixRight = drewLine ? sx : sx + sufW;
                    if (suffixRight > maxX) maxX = suffixRight;
                }
            }
        }
        prevRight = right;
        lastRight = right;
        if (right > maxX) maxX = right;
    }
    // An extender that runs to the end of the row (its last slot is on the next
    // row) still needs its in-row span drawn.
    flushExtender();

    // Word broken at the row boundary: render a trailing hyphen so the reader
    // knows the syllable continues on the next row.
    const lastSyl = workSyllables[workSyllables.length - 1];
    if (lastSyl && lastSyl.hyphenAfter && lastRight !== null) {
        const hyphenX = lastRight + hyphenSpaceW / 2;
        parts.push(`<text x="${hyphenX}" y="${lyricY}" font-family="${escapeAttr(fontFamily)}" font-size="${fontSize}" text-anchor="middle" fill="#000">-</text>`);
        if (hyphenX + hyphenSpaceW / 2 > maxX) maxX = hyphenX + hyphenSpaceW / 2;
    }
    return { svg: parts.join(''), maxX };
}
