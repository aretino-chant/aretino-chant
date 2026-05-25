/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const SVG_NS = 'http://www.w3.org/2000/svg';

const _highlightCache = new WeakMap();

const DEFAULT_ACTIVE_CLASS = 'aretino-active';
const DEFAULT_CURSOR_CLASS = 'aretino-cursor-rect';
const DEFAULT_CURSOR_BACKGROUND_CLASS = 'aretino-cursor-bg';
const DEFAULT_CURSOR_FILL = 'rgba(234, 88, 12, 0.13)';
const DEFAULT_VERTICAL_PADDING = 0.25;

function classSelector(className) {
    const css = globalThis.CSS;
    if (css?.escape) return `.${css.escape(className)}`;
    return `.${className.replace(/[^a-zA-Z0-9_-]/g, '\\$&')}`;
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
        .filter(el => overlapsSelection(el, range.from, range.to));
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

function normalizeOptions(options) {
    return {
        mode: options.mode ?? 'background',
        activeClass: options.activeClass ?? DEFAULT_ACTIVE_CLASS,
        cursorClass: options.cursorClass ?? DEFAULT_CURSOR_CLASS,
        cursorBackgroundClass: options.cursorBackgroundClass ?? DEFAULT_CURSOR_BACKGROUND_CLASS,
        fill: options.fill ?? DEFAULT_CURSOR_FILL,
        verticalPadding: options.verticalPadding ?? DEFAULT_VERTICAL_PADDING,
        scrollIntoView: options.scrollIntoView ?? false,
    };
}

function applyHighlight(targets, options) {
    for (const target of targets) {
        if (options.mode === 'class' || options.mode === 'both') {
            target.classList.add(options.activeClass);
        }
        if (options.mode === 'background' || options.mode === 'both') {
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

export function highlightAtCaret(preview, caret, options = {}) {
    const normalized = normalizeOptions(options);
    clearHighlight(preview, normalized.activeClass, normalized.cursorClass);

    const target = findTargetAtCaret(preview, caret);
    if (!target) return null;

    let cursorRect = null;
    if (normalized.mode === 'class' || normalized.mode === 'both') {
        target.classList.add(normalized.activeClass);
    }
    if (normalized.mode === 'background' || normalized.mode === 'both') {
        cursorRect = addCursorBackground(target, normalized) || null;
    }

    _highlightCache.set(preview, { activeEl: target, cursorRect });
    scrollElementIntoView(target, normalized.scrollIntoView);
    return target;
}

export function highlightAtSelection(preview, selection, options = {}) {
    const normalized = normalizeOptions(options);
    clearHighlight(preview, normalized.activeClass, normalized.cursorClass);

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
