import { describe, expect, it } from 'vitest';
import { highlightAtCaret, highlightAtSelection } from '../src/caret.js';

class FakeClassList {
    constructor(className = '') {
        this.classes = new Set(className.split(/\s+/).filter(Boolean));
    }

    add(className) {
        this.classes.add(className);
    }

    remove(className) {
        this.classes.delete(className);
    }

    contains(className) {
        return this.classes.has(className);
    }
}

const fakeDocument = {
    createElementNS(_ns, tagName) {
        return new FakeElement({ tagName, ownerDocument: fakeDocument });
    },
};

class FakeElement {
    constructor({ tagName = 'g', className = '', dataset = {}, bbox = null, ownerDocument = fakeDocument } = {}) {
        this.tagName = tagName;
        this.dataset = { ...dataset };
        this.bbox = bbox ?? { x: 0, y: 0, width: 1, height: 1 };
        this.ownerDocument = ownerDocument;
        this.children = [];
        this.parentNode = null;
        this.classList = new FakeClassList(className);
        this.attributes = {};
    }

    append(...children) {
        for (const child of children) {
            child.parentNode = this;
            this.children.push(child);
        }
    }

    prepend(child) {
        child.parentNode = this;
        this.children.unshift(child);
    }

    remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter(child => child !== this);
        this.parentNode = null;
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name === 'class') {
            this.classList = new FakeClassList(String(value));
        }
    }

    getBBox() {
        return this.bbox;
    }

    contains(element) {
        for (let current = element; current; current = current.parentNode) {
            if (current === this) return true;
        }
        return false;
    }

    closest(selector) {
        for (let current = this; current; current = current.parentNode) {
            if (current.matches(selector)) return current;
        }
        return null;
    }

    matches(selector) {
        if (selector === '[data-src-start]') {
            return this.dataset.srcStart !== undefined;
        }
        if (selector.startsWith('.')) {
            const className = selector.slice(1).replace(/\\(.)/g, '$1');
            return this.classList.contains(className);
        }
        return false;
    }

    querySelectorAll(selector) {
        const matches = [];
        const visit = (element) => {
            for (const child of element.children) {
                if (child.matches(selector)) matches.push(child);
                visit(child);
            }
        };
        visit(this);
        return matches;
    }
}

function previewWith(...children) {
    const preview = new FakeElement();
    preview.append(...children);
    return preview;
}

function sourceMapped(srcStart, srcEnd, options = {}) {
    return new FakeElement({
        ...options,
        dataset: {
            srcStart: String(srcStart),
            srcEnd: String(srcEnd),
            ...(options.dataset ?? {}),
        },
    });
}

function activeSpans(preview) {
    return preview.querySelectorAll('.aretino-active')
        .map(el => [Number(el.dataset.srcStart), Number(el.dataset.srcEnd)]);
}

describe('caret preview highlighting', () => {
    it('highlights every source-mapped element that overlaps a non-empty selection', () => {
        const first = sourceMapped(0, 1);
        const second = sourceMapped(2, 3);
        const outside = sourceMapped(4, 5);
        const preview = previewWith(first, second, outside);

        const highlighted = highlightAtSelection(preview, { from: 0, to: 3 }, { mode: 'class' });

        expect(highlighted).toEqual([first, second]);
        expect(activeSpans(preview)).toEqual([[0, 1], [2, 3]]);

        highlightAtSelection(preview, { from: 4, to: 5 }, { mode: 'class' });

        expect(activeSpans(preview)).toEqual([[4, 5]]);
    });

    it('keeps collapsed selections using the same best caret target as highlightAtCaret', () => {
        const outer = sourceMapped(0, 3);
        const inner = sourceMapped(1, 2);
        outer.append(inner);
        const preview = previewWith(outer);

        expect(highlightAtCaret(preview, 2, { mode: 'class' })).toBe(inner);

        const highlighted = highlightAtSelection(preview, { from: 2, to: 2 }, { mode: 'class' });

        expect(highlighted).toEqual([inner]);
    });

    it('uses nested child mappings instead of painting a wider mapped ancestor', () => {
        const outer = sourceMapped(0, 3);
        const inner = sourceMapped(1, 2);
        outer.append(inner);
        const preview = previewWith(outer);

        const highlighted = highlightAtSelection(preview, { from: 1, to: 2 }, { mode: 'class' });

        expect(highlighted).toEqual([inner]);
        expect(activeSpans(preview)).toEqual([[1, 2]]);
    });

    it('draws and clears background rectangles for all selected mapped elements', () => {
        const first = sourceMapped(0, 1);
        const second = sourceMapped(2, 3);
        const preview = previewWith(first, second);

        highlightAtSelection(preview, { from: 0, to: 3 });

        expect(preview.querySelectorAll('.aretino-cursor-rect')).toHaveLength(2);

        highlightAtSelection(preview, { from: 2, to: 3 });

        expect(preview.querySelectorAll('.aretino-cursor-rect')).toHaveLength(1);
    });

    it('frames a modifier glyph in a square box (not a band) when the caret follows it', () => {
        const note = sourceMapped(0, 3, { className: 'aretino-note' });
        const mora = sourceMapped(2, 3, { className: 'aretino-modifier aretino-mod-mora' });
        note.append(mora);
        const preview = previewWith(note);

        // Default mode is background, but a modifier target gets recolored + boxed.
        const target = highlightAtCaret(preview, 3);

        expect(target).toBe(mora);
        expect(mora.classList.contains('aretino-active')).toBe(true);
        const boxes = preview.querySelectorAll('.aretino-cursor-modbox');
        expect(boxes).toHaveLength(1);
        expect(boxes[0].attributes.fill).toBe('none');
        expect(boxes[0].attributes.stroke).not.toBe('none');
        // The box is the only cursor rect; no translucent band is drawn.
        expect(preview.querySelectorAll('.aretino-cursor-bg')).toHaveLength(0);
    });

    it('draws a thin line at the next token when the caret abuts it (AB |C)', () => {
        // "AB |C": ligature AB at [0,2], note C at [3,4]; caret = 3 (just before C).
        const ab = sourceMapped(0, 2, { className: 'aretino-token aretino-ligature', dataset: { staffBottom: '40', staffHeight: '20', bboxX: '0', bboxWidth: '10' } });
        const c = sourceMapped(3, 4, { className: 'aretino-token aretino-ligature', dataset: { staffBottom: '40', staffHeight: '20', bboxX: '30', bboxWidth: '10' } });
        const preview = previewWith(ab, c);

        const target = highlightAtCaret(preview, 3);

        expect(target).toBeNull();
        const lines = preview.querySelectorAll('.aretino-cursor-line');
        expect(lines).toHaveLength(1);
        // Line hugs C's left edge (x=30), centered on it.
        const width = Number(lines[0].attributes.width);
        expect(Number(lines[0].attributes.x)).toBeCloseTo(30 - width / 2);
    });

    it('draws a midway line when the caret sits in whitespace before a token (AB | C)', () => {
        // "AB  C": ligature AB at [0,2], note C at [4,5]; caret = 3 (between two spaces).
        const ab = sourceMapped(0, 2, { className: 'aretino-token aretino-ligature', dataset: { staffBottom: '40', staffHeight: '20', bboxX: '0', bboxWidth: '10' } });
        const c = sourceMapped(4, 5, { className: 'aretino-token aretino-ligature', dataset: { staffBottom: '40', staffHeight: '20', bboxX: '30', bboxWidth: '10' } });
        const preview = previewWith(ab, c);

        highlightAtCaret(preview, 3);

        const lines = preview.querySelectorAll('.aretino-cursor-line');
        expect(lines).toHaveLength(1);
        // Midway between AB right edge (10) and C left edge (30) → 20.
        const width = Number(lines[0].attributes.width);
        expect(Number(lines[0].attributes.x)).toBeCloseTo(20 - width / 2);
    });

    it('targets the barline (not the later note) when the caret abuts a barline (AB |, C)', () => {
        // "AB , C": ligature AB [0,2], barline [3,4] (no bbox → getBBox), note C [5,6]; caret = 3.
        const ab = sourceMapped(0, 2, { className: 'aretino-token aretino-ligature', dataset: { staffBottom: '40', staffHeight: '20', bboxX: '0', bboxWidth: '10' } });
        const bar = sourceMapped(3, 4, { className: 'aretino-token aretino-barline', dataset: { staffBottom: '40', staffHeight: '20' }, bbox: { x: 25, y: 20, width: 2, height: 20 } });
        const c = sourceMapped(5, 6, { className: 'aretino-token aretino-ligature', dataset: { staffBottom: '40', staffHeight: '20', bboxX: '30', bboxWidth: '10' } });
        const preview = previewWith(ab, bar, c);

        highlightAtCaret(preview, 3);

        const lines = preview.querySelectorAll('.aretino-cursor-line');
        expect(lines).toHaveLength(1);
        // Hugs the barline's left edge (getBBox x = 25).
        const width = Number(lines[0].attributes.width);
        expect(Number(lines[0].attributes.x)).toBeCloseTo(25 - width / 2);
        // The line is parented to the barline, so Delete-target is unambiguous.
        expect(lines[0].parentNode).toBe(bar);
    });

    it('excludes modifier glyphs from non-empty selection highlighting', () => {
        const note = sourceMapped(0, 3, { className: 'aretino-note' });
        const mora = sourceMapped(2, 3, { className: 'aretino-modifier aretino-mod-mora' });
        note.append(mora);
        const preview = previewWith(note);

        const highlighted = highlightAtSelection(preview, { from: 0, to: 3 }, { mode: 'class' });

        expect(highlighted).toEqual([note]);
        expect(activeSpans(preview)).toEqual([[0, 3]]);
    });

    it('scrolls the caret target into view when requested', () => {
        const target = sourceMapped(0, 1);
        const preview = previewWith(target);
        const calls = [];
        target.scrollIntoView = options => calls.push(options);

        highlightAtCaret(preview, 1, { mode: 'class', scrollIntoView: true });

        expect(calls).toEqual([{ block: 'nearest', inline: 'nearest' }]);
    });

    it('scrolls the selected target nearest the active selection head', () => {
        const first = sourceMapped(0, 1);
        const second = sourceMapped(2, 3);
        const preview = previewWith(first, second);
        const calls = [];
        first.scrollIntoView = () => calls.push('first');
        second.scrollIntoView = () => calls.push('second');

        highlightAtSelection(preview, { from: 0, to: 3, head: 3 }, { mode: 'class', scrollIntoView: true });

        expect(calls).toEqual(['second']);
    });
});
