/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { escapeText, escapeAttr } from './glyphs.js';

// Placeholder emitted by \- escape so the syllable splitter doesn't treat it
// as a separator. Replaced with '-' in display text and segments.
export const LITERAL_HYPHEN = '\uE001';

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

export function measureSegmentsWidth(segments, fontSize, fontFamily) {
    if (!segments || segments.length === 0) return 0;
    return segments.reduce(
        (sum, seg) => sum + measureTextWidth(seg.text, fontSize, fontFamily, seg.bold, seg.italic),
        0
    );
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
            } else if (text[i] === '-') {
                addText(LITERAL_HYPHEN, [sourceAt(slashIdx) ?? sourceAt(i)]); i++;
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

export function parseFormattingToSegments(text) {
    return parseFormattingToSegmentsInternal(text);
}

export function parseFormattingToSegmentsWithSource(text, sourceMap) {
    return parseFormattingToSegmentsInternal(text, sourceMap);
}

export function renderSegments(segments) {
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
export function renderUnderlines(segments, textX, textY, fontSize, fontFamily, textAnchor) {
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
