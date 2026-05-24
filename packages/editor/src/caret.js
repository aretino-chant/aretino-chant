/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const SVG_NS = 'http://www.w3.org/2000/svg';

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

function findTargetAtCaret(preview, caret) {
    if (!preview || typeof preview.querySelectorAll !== 'function') return null;

    const position = Number(caret);
    if (!Number.isFinite(position)) return null;

    const candidates = preview.querySelectorAll('[data-src-start]');
    let best = null, bestA = 0, bestB = 0;
    for (const el of candidates) {
        const a = datasetNumber(el, 'srcStart');
        const b = datasetNumber(el, 'srcEnd');
        if (a === null || b === null) continue;
        if (position > a && position <= b) {
            if (!best || (b - a) < (bestB - bestA)) {
                best = el;
                bestA = a;
                bestB = b;
            }
        }
    }
    return best;
}

function clearHighlight(preview, activeClass, cursorClass) {
    if (!preview || typeof preview.querySelectorAll !== 'function') return;

    preview.querySelectorAll(classSelector(cursorClass)).forEach(el => el.remove());
    preview.querySelectorAll(classSelector(activeClass)).forEach(el => el.classList.remove(activeClass));
}

function addCursorBackground(target, options) {
    if (typeof target.getBBox !== 'function') return false;

    const staffBottom = datasetNumber(target, 'staffBottom');
    const staffHeight = datasetNumber(target, 'staffHeight');
    if (staffBottom === null || staffHeight === null) return false;

    const bbox = target.getBBox();
    if (bbox.width === 0) return false;

    const padding = staffHeight * options.verticalPadding;
    const rect = target.ownerDocument.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', `${options.cursorClass} ${options.cursorBackgroundClass}`);
    rect.setAttribute('x', bbox.x);
    rect.setAttribute('y', staffBottom - staffHeight - padding);
    rect.setAttribute('width', bbox.width);
    rect.setAttribute('height', staffHeight + 2 * padding);
    rect.setAttribute('fill', options.fill);
    rect.setAttribute('stroke', 'none');
    target.prepend(rect);
    return true;
}

export function highlightAtCaret(preview, caret, options = {}) {
    const normalized = {
        mode: options.mode ?? 'background',
        activeClass: options.activeClass ?? DEFAULT_ACTIVE_CLASS,
        cursorClass: options.cursorClass ?? DEFAULT_CURSOR_CLASS,
        cursorBackgroundClass: options.cursorBackgroundClass ?? DEFAULT_CURSOR_BACKGROUND_CLASS,
        fill: options.fill ?? DEFAULT_CURSOR_FILL,
        verticalPadding: options.verticalPadding ?? DEFAULT_VERTICAL_PADDING,
    };

    clearHighlight(preview, normalized.activeClass, normalized.cursorClass);

    const target = findTargetAtCaret(preview, caret);
    if (!target) return null;

    if (normalized.mode === 'class' || normalized.mode === 'both') {
        target.classList.add(normalized.activeClass);
    }
    if (normalized.mode === 'background' || normalized.mode === 'both') {
        addCursorBackground(target, normalized);
    }

    return target;
}
