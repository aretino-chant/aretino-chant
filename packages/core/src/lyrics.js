/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { escapeAttr } from './glyphs.js';
import { wrapSrc } from './svg.js';
import {
    LITERAL_HYPHEN,
    measureTextWidth,
    measureSegmentsWidth,
    sliceSegments,
    trimSegmentsEnd,
    parseFormattingToSegments,
    parseFormattingToSegmentsWithSource,
    renderSegments,
    renderUnderlines,
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
export function expandSyllablesForLigatures(notes) {
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
                hyphenMandatory: syl.hyphenMandatory || false,
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
            while (wPos < word.length && word[wPos] !== '-' && word[wPos] !== '=') wPos++;
            const sylEnd = wPos;
            let trailingHyphens = 0;
            let hyphenMandatory = false;
            while (wPos < word.length && (word[wPos] === '-' || word[wPos] === '=')) {
                if (word[wPos] === '=') hyphenMandatory = true;
                trailingHyphens++;
                wPos++;
            }
            if (sylEnd > sylStart) {
                sylParts.push({ raw: word.slice(sylStart, sylEnd), startIdx: sylStart, endIdx: sylEnd, trailingHyphens, hyphenMandatory });
            }
        }
        for (const { raw, startIdx, endIdx, trailingHyphens, hyphenMandatory } of sylParts) {
            const absStart = wordCharIndexes[startIdx];
            const absEnd = wordCharIndexes[endIdx - 1] + 1;
            const sourceSpan = sourceSpanForCleanedRange(absStart, absEnd);
            const tildeIdx = raw.indexOf('~~');
            let text, alignText;
            if (tildeIdx !== -1) {
                text = raw.slice(0, tildeIdx).replace(/~/g, ' ').replaceAll(LITERAL_HYPHEN, '-') + ' ' + raw.slice(tildeIdx + 2).replace(/~/g, ' ').replaceAll(LITERAL_HYPHEN, '-');
                alignText = raw.slice(tildeIdx + 2).replace(/~/g, ' ').replaceAll(LITERAL_HYPHEN, '-');
            } else {
                text = raw.replace(/~/g, ' ').replaceAll(LITERAL_HYPHEN, '-');
                alignText = text;
            }
            const segments = buildSegments(absStart, absEnd, s => s.replace(/~~/g, ' ').replace(/~/g, ' ').replaceAll(LITERAL_HYPHEN, '-'));
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
                hyphenMandatory: trailingHyphens > 0 && hyphenMandatory,
                noteGroupCount: Math.max(1, trailingHyphens),
                kind: 'note',
                ...sourceSpan,
            });
            noteCount += Math.max(1, trailingHyphens);
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
export function emitAlignedSyllables(ctx, syllables, ligatures, lyricY) {
    if (syllables.length === 0) {
        return '';
    }
    const fontSize = ctx.lyricSize;
    const fontFamily = ctx.lyricFont;
    // Minimum gap between syllables of different words: the font's real space
    // character, so an implicit word break is spaced exactly like an explicit
    // ~ (which renders a literal space). A fixed fraction of the font size
    // (e.g. 0.18em) is narrower than a true space and reads as too tight.
    const minGap = measureTextWidth(' ', fontSize, fontFamily) || fontSize * 0.25;
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
