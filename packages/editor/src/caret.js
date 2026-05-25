/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const SVG_NS = 'http://www.w3.org/2000/svg';

const _highlightCache = new WeakMap();

const MODIFIER_CLASS = 'aretino-modifier';

const DEFAULT_ACTIVE_CLASS = 'aretino-active';
const DEFAULT_CURSOR_CLASS = 'aretino-cursor-rect';
const DEFAULT_CURSOR_BACKGROUND_CLASS = 'aretino-cursor-bg';
const DEFAULT_CURSOR_LINE_CLASS = 'aretino-cursor-line';
const DEFAULT_MODIFIER_BOX_CLASS = 'aretino-cursor-modbox';
const DEFAULT_CURSOR_FILL = 'rgba(234, 88, 12, 0.13)';
// The line caret and the modifier box mark an exact position (rather than a
// whole token), so they read as a solid orange rather than the faint band.
const DEFAULT_CURSOR_LINE_FILL = 'rgba(234, 88, 12, 0.85)';
const DEFAULT_VERTICAL_PADDING = 0.25;
// Caret-line thickness as a fraction of the staff height (4 staff spaces).
const DEFAULT_LINE_WIDTH_FACTOR = 0.045;

function classSelector(className) {
    const css = globalThis.CSS;
    if (css?.escape) return `.${css.escape(className)}`;
    return `.${className.replace(/[^a-zA-Z0-9_-]/g, '\\$&')}`;
}

function isModifierTarget(el) {
    return typeof el?.classList?.contains === 'function' && el.classList.contains(MODIFIER_CLASS);
}

// Modifier glyphs (mora, ictus, …) are recolored rather than given a cursor
// band: a band sits at the notehead x and couldn't distinguish "on the note"
// from "on its episema". A solid color directly marks which modifier the caret
// follows.
function effectiveMode(target, mode) {
    return isModifierTarget(target) ? 'class' : mode;
}

function datasetNumber(el, name) {
    const value = Number(el.dataset?.[name]);
    return Number.isFinite(value) ? value : null;
}

function findSourceMappedElement(target, preview) {
    if (!target || typeof target.closest !== 'function') return null;

    const el = target.closest('[data-src-start]');
    if (!el) return null;
    if (preview && typeof preview.contains === 'function' && !preview.contains(el)) {
        return null;
    }
    return el;
}

function bestMatchingTarget(candidates, matches) {
    let best = null, bestA = 0, bestB = 0;
    for (const el of candidates) {
        const a = datasetNumber(el, 'srcStart');
        const b = datasetNumber(el, 'srcEnd');
        if (a === null || b === null || !matches(a, b)) continue;
        if (!best || (b - a) < (bestB - bestA)) {
            best = el;
            bestA = a;
            bestB = b;
        }
    }
    return best;
}

function findPrecedingTarget(candidates, position) {
    let best = null, bestEnd = -1;
    for (const el of candidates) {
        const b = datasetNumber(el, 'srcEnd');
        if (b === null || b > position) continue;
        if (best === null || b > bestEnd) {
            best = el;
            bestEnd = b;
        }
    }
    return best;
}

function findTargetAtCaret(preview, caret) {
    if (!preview || typeof preview.querySelectorAll !== 'function') return null;

    const position = Number(caret);
    if (!Number.isFinite(position)) return null;

    const candidates = preview.querySelectorAll('[data-src-start]');
    const direct = bestMatchingTarget(candidates, (a, b) => position > a && position <= b);
    if (direct) return direct;
    return findPrecedingTarget(candidates, position);
}

function normalizeSelection(selection) {
    if (typeof selection === 'number') {
        return Number.isFinite(selection) ? { from: selection, to: selection } : null;
    }

    if (!selection || typeof selection !== 'object') return null;

    const rawFrom = selection.from ?? selection.start ?? selection.anchor ?? selection.head ?? selection.caret;
    const rawTo = selection.to ?? selection.end ?? selection.head ?? selection.anchor ?? selection.caret ?? rawFrom;
    const from = Number(rawFrom);
    const to = Number(rawTo);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;

    return from <= to ? { from, to } : { from: to, to: from };
}

function selectionHead(selection) {
    if (typeof selection === 'number') {
        return Number.isFinite(selection) ? selection : null;
    }
    if (!selection || typeof selection !== 'object') return null;

    const value = Number(selection.head ?? selection.to ?? selection.end ?? selection.anchor ?? selection.from ?? selection.start ?? selection.caret);
    return Number.isFinite(value) ? value : null;
}

function overlapsSelection(el, from, to) {
    const a = datasetNumber(el, 'srcStart');
    const b = datasetNumber(el, 'srcEnd');
    if (a === null || b === null) return false;

    return a < to && b > from;
}

function mostSpecificTargets(targets) {
    return targets.filter(target => !targets.some(other => (
        other !== target
        && typeof target.contains === 'function'
        && target.contains(other)
    )));
}

function findTargetsInSelection(preview, selection) {
    if (!preview || typeof preview.querySelectorAll !== 'function') return [];

    const range = normalizeSelection(selection);
    if (!range) return [];
    if (range.from === range.to) {
        const target = findTargetAtCaret(preview, range.from);
        return target ? [target] : [];
    }

    const targets = [...preview.querySelectorAll('[data-src-start]')]
        .filter(el => !isModifierTarget(el) && overlapsSelection(el, range.from, range.to));
    return mostSpecificTargets(targets);
}

function scrollTargetForSelection(targets, selection) {
    if (targets.length <= 1) return targets[0] ?? null;

    const head = selectionHead(selection);
    if (head === null) return targets[0];

    let best = null;
    let bestDistance = Infinity;
    for (const target of targets) {
        const a = datasetNumber(target, 'srcStart');
        const b = datasetNumber(target, 'srcEnd');
        if (a === null || b === null) continue;
        if (head >= a && head <= b) return target;

        const distance = Math.min(Math.abs(head - a), Math.abs(head - b));
        if (distance < bestDistance) {
            best = target;
            bestDistance = distance;
        }
    }

    return best ?? targets[0];
}

function clearHighlight(preview, activeClass, cursorClass) {
    if (!preview || typeof preview.querySelectorAll !== 'function') return;

    const cache = _highlightCache.get(preview);
    if (cache) {
        cache.cursorRect?.remove();
        cache.activeEl?.classList.remove(activeClass);
        _highlightCache.delete(preview);
    } else {
        preview.querySelectorAll(classSelector(cursorClass)).forEach(el => el.remove());
        preview.querySelectorAll(classSelector(activeClass)).forEach(el => el.classList.remove(activeClass));
    }
}

function addCursorBackground(target, options) {
    const staffBottom = datasetNumber(target, 'staffBottom');
    const staffHeight = datasetNumber(target, 'staffHeight');
    const hasStaffBox = staffBottom !== null && staffHeight !== null;

    const bboxX = datasetNumber(target, 'bboxX');
    const bboxWidth = datasetNumber(target, 'bboxWidth');

    let rectX, rectWidth, rectY, rectHeight;

    if (bboxX !== null && bboxWidth !== null && hasStaffBox) {
        const padding = staffHeight * options.verticalPadding;
        rectX = bboxX;
        rectWidth = bboxWidth;
        rectY = staffBottom - staffHeight - padding;
        rectHeight = staffHeight + 2 * padding;
    } else {
        // Zero-width elements (e.g., barlines rendered as a vertical <line>) need
        // a minimum cursor width so the highlight rect is visible.
        if (typeof target.getBBox !== 'function') return false;
        const bbox = target.getBBox();
        if (bbox.height === 0) return false;
        const padding = hasStaffBox
            ? staffHeight * options.verticalPadding
            : bbox.height * options.verticalPadding;
        rectX = bbox.x;
        rectWidth = bbox.width;
        rectY = hasStaffBox ? staffBottom - staffHeight - padding : bbox.y - padding;
        rectHeight = (hasStaffBox ? staffHeight : bbox.height) + 2 * padding;
    }

    if (rectWidth === 0) {
        const minW = (hasStaffBox ? staffHeight : rectHeight) * 0.15;
        rectX -= minW / 2;
        rectWidth = minW;
    }

    const rect = target.ownerDocument.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', `${options.cursorClass} ${options.cursorBackgroundClass}`);
    rect.setAttribute('x', rectX);
    rect.setAttribute('y', rectY);
    rect.setAttribute('width', rectWidth);
    rect.setAttribute('height', rectHeight);
    rect.setAttribute('fill', options.fill);
    rect.setAttribute('stroke', 'none');
    target.prepend(rect);
    return rect;
}

// Horizontal edges of a token's drawn glyph, in viewBox units. Notes and
// ligatures carry data-bbox-*; barlines/clefs/accidentals don't, so we fall
// back to the live getBBox().
function elementEdges(el) {
    const bboxX = datasetNumber(el, 'bboxX');
    const bboxWidth = datasetNumber(el, 'bboxWidth');
    if (bboxX !== null && bboxWidth !== null) {
        return { left: bboxX, right: bboxX + bboxWidth };
    }
    if (typeof el.getBBox === 'function') {
        const b = el.getBBox();
        return { left: b.x, right: b.x + b.width };
    }
    return null;
}

// Vertical extent a caret line should span for a token, padded like the band.
function elementStaffBox(el, verticalPadding) {
    const staffBottom = datasetNumber(el, 'staffBottom');
    const staffHeight = datasetNumber(el, 'staffHeight');
    if (staffBottom !== null && staffHeight !== null) {
        const pad = staffHeight * verticalPadding;
        return { top: staffBottom - staffHeight - pad, height: staffHeight + 2 * pad, staffHeight };
    }
    if (typeof el.getBBox === 'function') {
        const b = el.getBBox();
        if (b.height > 0) {
            const pad = b.height * verticalPadding;
            return { top: b.y - pad, height: b.height + 2 * pad, staffHeight: b.height };
        }
    }
    return null;
}

// Staff tokens (notes, ligatures, barlines, clefs, …) all carry data-staff-bottom;
// lyrics and other non-staff mappings don't. We anchor caret lines to staff tokens.
function hasStaff(el) {
    return datasetNumber(el, 'staffBottom') !== null;
}

// Innermost staff token starting at or after the caret (the token a glued
// insertion would attach to / Delete would remove).
function findNextToken(candidates, caret) {
    let best = null, bestStart = Infinity, bestSpan = Infinity;
    for (const el of candidates) {
        if (isModifierTarget(el) || !hasStaff(el)) continue;
        const a = datasetNumber(el, 'srcStart');
        const b = datasetNumber(el, 'srcEnd');
        if (a === null || b === null || a < caret) continue;
        const span = b - a;
        if (a < bestStart || (a === bestStart && span <= bestSpan)) {
            best = el; bestStart = a; bestSpan = span;
        }
    }
    return best;
}

// Innermost staff token ending at or before the caret.
function findPrevToken(candidates, caret) {
    let best = null, bestEnd = -Infinity, bestSpan = Infinity;
    for (const el of candidates) {
        if (isModifierTarget(el) || !hasStaff(el)) continue;
        const a = datasetNumber(el, 'srcStart');
        const b = datasetNumber(el, 'srcEnd');
        if (a === null || b === null || b > caret) continue;
        const span = b - a;
        if (b > bestEnd || (b === bestEnd && span <= bestSpan)) {
            best = el; bestEnd = b; bestSpan = span;
        }
    }
    return best;
}

// When the caret sits in a whitespace gap (no token spans it), it marks a
// position before the next token rather than "on" a token. We draw a thin
// vertical line there instead of banding the preceding token. Returns null
// when there is no following token (trailing caret) — callers then fall back
// to highlighting the preceding token.
function computeCaretLine(candidates, caret, options) {
    const next = findNextToken(candidates, caret);
    if (!next) return null;

    const staffBox = elementStaffBox(next, options.verticalPadding);
    if (!staffBox) return null;
    const nextEdges = elementEdges(next);
    if (!nextEdges) return null;

    const prev = findPrevToken(candidates, caret);
    const gap = staffBox.staffHeight * 0.12;

    let x;
    if (datasetNumber(next, 'srcStart') === caret) {
        // No space between caret and the next token: line hugs its left edge.
        x = nextEdges.left;
    } else if (prev) {
        // Caret sits in whitespace: line goes midway between the two glyphs.
        const pe = elementEdges(prev);
        x = pe ? (pe.right + nextEdges.left) / 2 : nextEdges.left - gap;
    } else {
        x = nextEdges.left - gap;
    }

    const width = Math.max(1, staffBox.staffHeight * options.lineWidthFactor);
    return { x: x - width / 2, top: staffBox.top, width, height: staffBox.height, owner: next };
}

function addCaretLine(line, options) {
    const rect = line.owner.ownerDocument.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', `${options.cursorClass} ${options.cursorLineClass}`);
    rect.setAttribute('x', line.x);
    rect.setAttribute('y', line.top);
    rect.setAttribute('width', line.width);
    rect.setAttribute('height', line.height);
    rect.setAttribute('fill', options.lineFill);
    rect.setAttribute('stroke', 'none');
    line.owner.prepend(rect);
    return rect;
}

// A modifier glyph (mora, ictus, …) is small and recoloring alone is easy to
// miss, so we frame it in a square outline as well.
function addModifierBox(target, options) {
    if (typeof target.getBBox !== 'function') return null;
    const b = target.getBBox();
    const extent = Math.max(b.width, b.height);
    const pad = Math.max(extent * 0.4, 1);
    const size = extent + 2 * pad;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;

    const rect = target.ownerDocument.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', `${options.cursorClass} ${options.modifierBoxClass}`);
    rect.setAttribute('x', cx - size / 2);
    rect.setAttribute('y', cy - size / 2);
    rect.setAttribute('width', size);
    rect.setAttribute('height', size);
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', options.lineFill);
    rect.setAttribute('stroke-width', Math.max(0.5, size * 0.08));
    target.prepend(rect);
    return rect;
}

function normalizeOptions(options) {
    return {
        mode: options.mode ?? 'background',
        activeClass: options.activeClass ?? DEFAULT_ACTIVE_CLASS,
        cursorClass: options.cursorClass ?? DEFAULT_CURSOR_CLASS,
        cursorBackgroundClass: options.cursorBackgroundClass ?? DEFAULT_CURSOR_BACKGROUND_CLASS,
        cursorLineClass: options.cursorLineClass ?? DEFAULT_CURSOR_LINE_CLASS,
        modifierBoxClass: options.modifierBoxClass ?? DEFAULT_MODIFIER_BOX_CLASS,
        fill: options.fill ?? DEFAULT_CURSOR_FILL,
        lineFill: options.lineFill ?? DEFAULT_CURSOR_LINE_FILL,
        verticalPadding: options.verticalPadding ?? DEFAULT_VERTICAL_PADDING,
        lineWidthFactor: options.lineWidthFactor ?? DEFAULT_LINE_WIDTH_FACTOR,
        scrollIntoView: options.scrollIntoView ?? false,
    };
}

function applyHighlight(targets, options) {
    for (const target of targets) {
        const mode = effectiveMode(target, options.mode);
        if (mode === 'class' || mode === 'both') {
            target.classList.add(options.activeClass);
        }
        if (mode === 'background' || mode === 'both') {
            addCursorBackground(target, options);
        }
    }
}

function scrollElementIntoView(target, scrollIntoView) {
    if (!scrollIntoView || typeof target?.scrollIntoView !== 'function') return;

    const options = scrollIntoView === true
        ? { block: 'nearest', inline: 'nearest' }
        : scrollIntoView;
    target.scrollIntoView(options);
}

// Paint a single collapsed caret. Returns { target, activeEl, cursorRect,
// scrollTarget } or null. `target` is the token the caret is "on" (or null for
// a gap line); `activeEl`/`cursorRect` are what clearHighlight must undo.
function paintCollapsedCaret(preview, caret, options) {
    if (!preview || typeof preview.querySelectorAll !== 'function') return null;
    const position = Number(caret);
    if (!Number.isFinite(position)) return null;

    const candidates = [...preview.querySelectorAll('[data-src-start]')];

    // Caret on a token (inside it or just after its last char): band the token,
    // or frame the modifier when it lands on one.
    const direct = bestMatchingTarget(candidates, (a, b) => position > a && position <= b);
    if (direct) {
        let cursorRect = null;
        if (isModifierTarget(direct)) {
            direct.classList.add(options.activeClass);
            cursorRect = addModifierBox(direct, options);
            return { target: direct, activeEl: direct, cursorRect, scrollTarget: direct };
        }
        if (options.mode === 'class' || options.mode === 'both') {
            direct.classList.add(options.activeClass);
        }
        if (options.mode === 'background' || options.mode === 'both') {
            cursorRect = addCursorBackground(direct, options) || null;
        }
        return { target: direct, activeEl: direct, cursorRect, scrollTarget: direct };
    }

    // Caret in a gap before a token: draw a thin vertical line caret.
    const line = computeCaretLine(candidates, position, options);
    if (line) {
        const cursorRect = addCaretLine(line, options);
        return { target: null, activeEl: null, cursorRect, scrollTarget: line.owner };
    }

    // Trailing caret (nothing follows): keep banding the preceding token.
    const fallback = findPrecedingTarget(candidates, position);
    if (!fallback) return null;
    let cursorRect = null;
    if (options.mode === 'class' || options.mode === 'both') {
        fallback.classList.add(options.activeClass);
    }
    if (options.mode === 'background' || options.mode === 'both') {
        cursorRect = addCursorBackground(fallback, options) || null;
    }
    return { target: fallback, activeEl: fallback, cursorRect, scrollTarget: fallback };
}

export function highlightAtCaret(preview, caret, options = {}) {
    const normalized = normalizeOptions(options);
    clearHighlight(preview, normalized.activeClass, normalized.cursorClass);

    const result = paintCollapsedCaret(preview, caret, normalized);
    if (!result) return null;

    _highlightCache.set(preview, { activeEl: result.activeEl, cursorRect: result.cursorRect });
    scrollElementIntoView(result.scrollTarget, normalized.scrollIntoView);
    return result.target;
}

export function highlightAtSelection(preview, selection, options = {}) {
    const normalized = normalizeOptions(options);
    clearHighlight(preview, normalized.activeClass, normalized.cursorClass);

    const range = normalizeSelection(selection);
    if (range && range.from === range.to) {
        const result = paintCollapsedCaret(preview, range.from, normalized);
        if (!result) return [];
        _highlightCache.set(preview, { activeEl: result.activeEl, cursorRect: result.cursorRect });
        scrollElementIntoView(result.scrollTarget, normalized.scrollIntoView);
        return result.target ? [result.target] : [];
    }

    const targets = findTargetsInSelection(preview, selection);
    applyHighlight(targets, normalized);
    scrollElementIntoView(scrollTargetForSelection(targets, selection), normalized.scrollIntoView);
    return targets;
}

export function sourceSpanFromPreviewClick(event, preview = event?.currentTarget) {
    const target = findSourceMappedElement(event?.target, preview);
    if (!target) return null;

    const srcStart = datasetNumber(target, 'srcStart');
    const srcEnd = datasetNumber(target, 'srcEnd');
    if (srcStart === null || srcEnd === null) return null;

    return { element: target, srcStart, srcEnd };
}
