/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { escapeText, escapeAttr, drawInlineGlyph } from './glyphs.js';

// Placeholder emitted by \- escape so the syllable splitter doesn't treat it
// as a separator. Replaced with '-' in display text and segments.
export const LITERAL_HYPHEN = '\uE001';

// Placeholder emitted by \( escape so the syllable splitter doesn't treat it
// as a barline-label opener. Replaced with '(' in display text and segments.
export const LITERAL_OPEN_PAREN = '\uE002';

// Placeholder emitted by \_ escape so the syllable splitter doesn't treat it
// as an extender-line marker. Replaced with '_' in display text and segments.
export const LITERAL_UNDERSCORE = '\uE003';

let _measureCanvas = null;

export function measureTextWidth(text, fontSize, fontFamily, bold = false, italic = false) {
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

// Baseline-to-top of the letters a string actually contains, in the same units
// as fontSize. The first lyric line is hung from this rather than from the font
// size, so a row of short lower-case syllables rides closer to the music than a
// row carrying capitals or Hungarian accents — which is how the clearance is
// reckoned by hand.
//
// A browser measures the real ink (`actualBoundingBoxAscent`). Headless there is
// no face to measure, so the letters are classed the way measureTextWidth
// estimates widths there: an accented capital reaches highest, an ascender,
// capital or digit next, and an x-height letter least.
const ACCENTED_CAP_ASCENT = 0.95;
const ASCENDER_ASCENT = 0.75;
const XHEIGHT_ASCENT = 0.52;

// Lower-case letters whose stem rises to the ascender line.
const LOWER_ASCENDERS = 'bdfhklß';

function estimateAscentFactor(text) {
    let factor = 0;
    for (const ch of text) {
        // NFD splits a precomposed letter into its base and its diacritics, so
        // one table answers for á, ő and û alike.
        const decomposed = ch.normalize('NFD');
        const base = decomposed[0];
        const accented = decomposed.length > 1;
        const upper = base !== base.toLowerCase() && base === base.toUpperCase();
        let f;
        if (upper && accented) {
            f = ACCENTED_CAP_ASCENT;
        } else if (upper || accented || /[0-9]/.test(base)
                || LOWER_ASCENDERS.includes(base.toLowerCase()) && base === base.toLowerCase()
                || '([{|/\\!?†‡'.includes(base)) {
            f = ASCENDER_ASCENT;
        } else if (/[\p{L}\p{N}]/u.test(base)) {
            f = XHEIGHT_ASCENT;
        } else {
            // Punctuation sitting on the baseline (. , ; : - ~ space) adds no height.
            continue;
        }
        if (f > factor) factor = f;
    }
    return factor;
}

export function measureTextAscent(text, fontSize, fontFamily, bold = false, italic = false) {
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
            const m = c2d.measureText(text);
            if (m.actualBoundingBoxAscent) {
                return m.actualBoundingBoxAscent;
            }
            if (m.fontBoundingBoxAscent) {
                return m.fontBoundingBoxAscent;
            }
        } catch (_e) {
            // fall through to estimation
        }
    }
    return estimateAscentFactor(text) * fontSize;
}

// Baseline to the top of the lower-case letters. A lyric hyphen is hung in
// x-heights (see METRICS.lyricHyphenPos) so that it crosses the middle of the
// letters it stands between in any face: an x-height is a real measurement and
// not a fixed part of the body — .44 of it in Times, .55 in Merriweather — so a
// stroke reckoned in x-heights sits where the eye expects it, where one reckoned
// in the body would ride up and down with the face.
export function measureXHeight(fontSize, fontFamily) {
    if (typeof document !== 'undefined') {
        try {
            if (!_measureCanvas) {
                _measureCanvas = document.createElement('canvas');
            }
            const c2d = _measureCanvas.getContext('2d');
            c2d.font = `${fontSize}px ${fontFamily}`;
            const m = c2d.measureText('x');
            if (m.actualBoundingBoxAscent) {
                return m.actualBoundingBoxAscent;
            }
        } catch (_e) {
            // fall through to estimation
        }
    }
    // Times' own x-height, which is the face string widths fall back to as well.
    return fontSize * 0.45;
}

function segFontSize(seg, fontSize) {
    if (seg.large) return fontSize * 4 / 3;
    if (seg.small) return fontSize * 0.75;
    return fontSize;
}

export function measureSegmentsWidth(segments, fontSize, fontFamily, measureFn = measureTextWidth) {
    if (!segments || segments.length === 0) return 0;
    return segments.reduce((sum, seg) => {
        if (seg.glyph) return sum + (seg.glyphAdvance || 0) * segFontSize(seg, fontSize) / 1000;
        return sum + measureFn(seg.text, segFontSize(seg, fontSize), fontFamily, seg.bold, seg.italic);
    }, 0);
}

// Tallest ascent among a run of segments, honouring each segment's own size
// ($small / $large) so a large-set initial is cleared by its own height.
// An inline glyph is measured by its em box, there being no ink metric for it.
export function measureSegmentsAscent(segments, fontSize, fontFamily, ascentFn = measureTextAscent) {
    if (!segments || segments.length === 0) return 0;
    let max = 0;
    for (const seg of segments) {
        const size = segFontSize(seg, fontSize);
        const a = seg.glyph
            ? size * ASCENDER_ASCENT
            : ascentFn(seg.text, size, fontFamily, seg.bold, seg.italic);
        if (a > max) max = a;
    }
    return max;
}

// Side padding renderMixedLabel puts around an inline glyph, as a fraction of
// the glyph's effective font size. Half of it goes before the glyph, the rest
// after, so a glyph advances by `advance + GLYPH_PAD * 1.5 * size`.
const GLYPH_PAD = 0.15;

// Width a run of segments actually occupies when drawn by renderMixedLabel —
// measureSegmentsWidth plus the padding around each inline glyph. Line
// breaking measures with this so a stress mark or accidental cannot overrun.
export function measureSegmentsAdvance(segments, fontSize, fontFamily, measureFn = measureTextWidth) {
    if (!segments || segments.length === 0) return 0;
    return segments.reduce((sum, seg) => {
        if (seg.glyph) return sum + (seg.glyphAdvance || 0) * segFontSize(seg, fontSize) / 1000
            + GLYPH_PAD * 1.5 * segFontSize(seg, fontSize);
        return sum + measureFn(seg.text, segFontSize(seg, fontSize), fontFamily, seg.bold, seg.italic);
    }, 0);
}

// Return a copy of `segments` covering only the characters from `startChar` onwards.
export function sliceSegments(segments, startChar) {
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
export function trimSegmentsEnd(segments, length) {
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

// Parses lyric text with the formatting syntax into an array of segments.
// Each segment: { text, bold, italic, underline, color }
// Syntax:
//   {text}           bold
//   \sc{text}        small caps
//   <text>           italic
//   [text]           underline
//   \R               responsory sign ℟
//   \V               versicle sign ℣
//   \small{text}     75% font size
//   \large{text}     133% font size
//   \red{text}       red colored text
//   \color:X{text}   X-colored text (generic)
//   +                dagger †
//   ++               double dagger ‡
//   |                line break, when `options.breaks` is set (verse text only)
//   \X               literal X (escape for any special char)
function parseFormattingToSegmentsInternal(text, sourceMap = null, options = {}) {
    text = String(text ?? '');
    const withSource = Array.isArray(sourceMap);
    const allowBreaks = !!options.breaks;
    const stack = [{ type: 'root', bold: false, italic: false, underline: false, color: null, smallCaps: false, small: false, large: false }];
    const segments = [];

    function sourceAt(idx) {
        const value = sourceMap?.[idx];
        return Number.isFinite(value) ? value : null;
    }

    function effectiveState() {
        const s = { bold: false, italic: false, underline: false, color: null, smallCaps: false, small: false, large: false };
        for (const e of stack) {
            if (e.bold) s.bold = true;
            if (e.italic) s.italic = true;
            if (e.underline) s.underline = true;
            if (e.color !== null) s.color = e.color;
            if (e.smallCaps) s.smallCaps = true;
            if (e.small) s.small = true;
            if (e.large) s.large = true;
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
        if (last && !last.glyph && !last.break && last.bold === st.bold && last.italic === st.italic &&
                last.underline === st.underline && last.color === st.color && last.smallCaps === st.smallCaps &&
                last.small === st.small && last.large === st.large) {
            last.text += str;
            if (withSource) {
                last.sourceOffsets.push(...sourceOffsets);
            }
        } else {
            const segment = { text: str, bold: st.bold, italic: st.italic, underline: st.underline, color: st.color, smallCaps: st.smallCaps, small: st.small, large: st.large };
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
                stack.push({ type: 'command', bold: false, italic: false, underline: false, color: null, smallCaps: true, small: false, large: false });
                i += 3;
            } else if (text.slice(i, i + 6) === 'small{') {
                stack.push({ type: 'command', bold: false, italic: false, underline: false, color: null, smallCaps: false, small: true, large: false });
                i += 6;
            } else if (text.slice(i, i + 6) === 'large{') {
                stack.push({ type: 'command', bold: false, italic: false, underline: false, color: null, smallCaps: false, small: false, large: true });
                i += 6;
            } else if (text.slice(i, i + 4) === 'red{') {
                stack.push({ type: 'command', bold: false, italic: false, underline: false, color: 'red', smallCaps: false, small: false, large: false });
                i += 4;
            } else if (text.slice(i, i + 6) === 'color:') {
                i += 6;
                const braceIdx = text.indexOf('{', i);
                if (braceIdx >= 0) {
                    const colorName = text.slice(i, braceIdx);
                    i = braceIdx + 1;
                    stack.push({ type: 'command', bold: false, italic: false, underline: false, color: colorName, smallCaps: false, small: false, large: false });
                } else {
                    addText('\\color:', Array.from({ length: 7 }, (_, k) => sourceAt(slashIdx + k)));
                }
            } else if (text[i] === '-') {
                addText(LITERAL_HYPHEN, [sourceAt(slashIdx) ?? sourceAt(i)]); i++;
            } else if (text[i] === '(') {
                addText(LITERAL_OPEN_PAREN, [sourceAt(slashIdx) ?? sourceAt(i)]); i++;
            } else if (text[i] === '_') {
                addText(LITERAL_UNDERSCORE, [sourceAt(slashIdx) ?? sourceAt(i)]); i++;
            } else if (text[i] === 'b' || text[i] === 'n' || text[i] === '#' || text[i] === "'") {
                const glyphMap = { b: ['flat', 226], n: ['natural', 168], '#': ['sharp', 249], "'": ['stress', 235] };
                const [glyphName, glyphAdvance] = glyphMap[text[i]];
                const st = effectiveState();
                const seg = { text: '', glyph: glyphName, glyphAdvance, ...st };
                if (withSource) seg.sourceOffsets = [sourceAt(slashIdx) ?? sourceAt(i)];
                segments.push(seg);
                i++;
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
        } else if (text[i] === '|' && allowBreaks) {
            // Rides through as a segment rather than pre-splitting the source,
            // so inline formatting may span the break. `\|` is a literal pipe.
            const seg = { text: '', break: true, ...effectiveState() };
            if (withSource) seg.sourceOffsets = [sourceAt(i)];
            segments.push(seg);
            i++;
        } else {
            addText(text[i], [sourceAt(i)]); i++;
        }
    }

    return segments.filter(s => s.text !== '' || s.glyph || s.break);
}

export function parseFormattingToSegments(text, options = {}) {
    return parseFormattingToSegmentsInternal(text, null, options);
}

export function parseFormattingToSegmentsWithSource(text, sourceMap, options = {}) {
    return parseFormattingToSegmentsInternal(text, sourceMap, options);
}

export function renderSegments(segments) {
    if (!segments || segments.length === 0) return '';
    if (segments.every(s => !s.bold && !s.italic && !s.underline && !s.color && !s.smallCaps && !s.small && !s.large)) {
        return escapeText(segments.map(s => s.text).join(''));
    }
    return segments.map(s => {
        let attrs = '';
        if (s.bold) attrs += ' font-weight="bold"';
        if (s.italic) attrs += ' font-style="italic"';
        if (s.color) attrs += ` fill="${escapeAttr(s.color)}"`;
        if (s.smallCaps) attrs += ' font-variant="small-caps"';
        if (s.small && !s.large) attrs += ' style="font-size:0.75em"';
        if (s.large)             attrs += ' style="font-size:1.3333333em"';
        if (!attrs) return escapeText(s.text);
        return `<tspan${attrs}>${escapeText(s.text)}</tspan>`;
    }).join('');
}

// Renders segments as SVG, mixing <text> elements for text runs and <path> elements
// for inline glyphs (\b flat, \n natural, \# sharp). Handles centering via textAnchor.
// Returns a string of one or more SVG elements.
export function renderMixedLabel(segments, cx, y, fontSize, fontFamily, textAnchor = 'middle', measureFn = measureTextWidth, fill = '#000') {
    if (!segments || segments.length === 0) return '';
    const hasGlyphs = segments.some(s => s.glyph);
    if (!hasGlyphs) {
        return `<text xml:space="preserve" x="${cx}" y="${y}" font-family="${escapeAttr(fontFamily)}" font-size="${fontSize}" text-anchor="${textAnchor}" fill="${escapeAttr(fill)}">${renderSegments(segments)}</text>`;
    }
    const totalWidth = measureSegmentsWidth(segments, fontSize, fontFamily, measureFn);
    let x = textAnchor === 'middle' ? cx - totalWidth / 2 : cx;
    const parts = [];
    let textRun = [];
    let textRunX = x;

    function flushTextRun() {
        if (textRun.length === 0) return;
        const content = renderSegments(textRun);
        if (content) {
            parts.push(`<text xml:space="preserve" x="${textRunX}" y="${y}" font-family="${escapeAttr(fontFamily)}" font-size="${fontSize}" text-anchor="start" fill="${escapeAttr(fill)}">${content}</text>`);
        }
        textRun = [];
    }

    for (const seg of segments) {
        if (seg.glyph) {
            flushTextRun();
            const efs = segFontSize(seg, fontSize);
            const pad = GLYPH_PAD * efs;
            const { svg } = drawInlineGlyph(seg.glyph, x + pad / 2, y, efs, seg.color || fill);
            parts.push(svg);
            x += (seg.glyphAdvance || 0) * efs / 1000 + pad * 1.5;
        } else {
            if (textRun.length === 0) textRunX = x;
            textRun.push(seg);
            x += measureFn(seg.text, segFontSize(seg, fontSize), fontFamily, seg.bold, seg.italic);
        }
    }
    flushTextRun();
    return parts.join('');
}

// Returns SVG <line> elements for any underlined segments, drawn below the text
// baseline. textX/textY match the SVG text element's x/y attributes;
// textAnchor is 'middle' or 'start'.
export function renderUnderlines(segments, textX, textY, fontSize, fontFamily, textAnchor, measureFn = measureTextWidth) {
    if (!segments || segments.every(s => !s.underline)) return '';
    const totalW = measureSegmentsWidth(segments, fontSize, fontFamily, measureFn);
    let x = textAnchor === 'middle' ? textX - totalW / 2 : textX;
    const lineY = textY + fontSize * 0.13;
    const strokeW = Math.max(0.4, fontSize * 0.055);
    const lines = [];
    for (const seg of segments) {
        const w = seg.glyph
            ? (seg.glyphAdvance || 0) * segFontSize(seg, fontSize) / 1000
            : measureFn(seg.text, segFontSize(seg, fontSize), fontFamily, seg.bold, seg.italic);
        if (seg.underline && !seg.glyph) {
            const stroke = seg.color || '#000';
            lines.push(`<line x1="${x}" y1="${lineY}" x2="${x + w}" y2="${lineY}" stroke="${escapeAttr(stroke)}" stroke-width="${strokeW}"/>`);
        }
        x += w;
    }
    return lines.join('');
}
