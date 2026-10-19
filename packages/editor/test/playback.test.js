import { describe, expect, it } from 'vitest';
import { attachPlaybackHighlight, clearPlaybackHighlight, PLAYBACK_HIGHLIGHT_STYLE } from '../src/playback.js';

class FakeElement {
    constructor(className, dataset = {}) {
        this.className = className;
        this.dataset = dataset;
        this.classes = new Set(className.split(/\s+/).filter(Boolean));
        this.classList = {
            add: c => this.classes.add(c),
            remove: c => this.classes.delete(c),
            contains: c => this.classes.has(c),
        };
        this.scrolled = 0;
    }
    scrollIntoView() { this.scrolled++; }
}

// A preview of three notes and two syllables; querySelectorAll understands
// the class + data-attribute selectors the helper uses.
function makePreview() {
    const els = [
        new FakeElement('aretino-note', { srcStart: '5', srcEnd: '6' }),
        new FakeElement('aretino-note', { srcStart: '7', srcEnd: '8' }),
        new FakeElement('aretino-note', { srcStart: '8', srcEnd: '9' }),
        new FakeElement('aretino-lyric aretino-syllable', { srcStart: '20', srcEnd: '22' }),
        new FakeElement('aretino-lyric aretino-syllable', { srcStart: '23', srcEnd: '25' }),
    ];
    return {
        els,
        querySelectorAll(selector) {
            const m = selector.match(/^\.([A-Za-z0-9_-]+)(\[data-src-start\])?$/);
            if (!m) throw new Error('unexpected selector ' + selector);
            return els.filter(el => el.classes.has(m[1]) && (!m[2] || el.dataset.srcStart !== undefined));
        },
    };
}

function emit(player, type, detail) {
    const ev = new Event(type);
    ev.detail = detail;
    player.dispatchEvent(ev);
}

describe('attachPlaybackHighlight', () => {
    it('marks the sounding note while it plays and scrolls it into view', () => {
        const player = new EventTarget();
        const preview = makePreview();
        attachPlaybackHighlight(player, preview);
        emit(player, 'noteon', { srcStart: 7, srcEnd: 8 });
        expect(preview.els.map(el => el.classes.has('aretino-playing'))).toEqual([false, true, false, false, false]);
        expect(preview.els[1].scrolled).toBe(1);
        emit(player, 'noteoff', { srcStart: 7, srcEnd: 8 });
        expect(preview.els.some(el => el.classes.has('aretino-playing'))).toBe(false);
    });

    it('marks every note a tied event spans', () => {
        const player = new EventTarget();
        const preview = makePreview();
        attachPlaybackHighlight(player, preview, { scrollIntoView: false });
        emit(player, 'noteon', { srcStart: 7, srcEnd: 9 });
        expect(preview.els.map(el => el.classes.has('aretino-playing'))).toEqual([false, true, true, false, false]);
        expect(preview.els[1].scrolled).toBe(0);
    });

    it('moves the syllable mark from one syllable to the next', () => {
        const player = new EventTarget();
        const preview = makePreview();
        attachPlaybackHighlight(player, preview);
        emit(player, 'syllable', { srcStart: 20, srcEnd: 22, text: 'Al' });
        expect(preview.els[3].classes.has('aretino-playing-syllable')).toBe(true);
        emit(player, 'syllable', { srcStart: 23, srcEnd: 25, text: 'le' });
        expect(preview.els[3].classes.has('aretino-playing-syllable')).toBe(false);
        expect(preview.els[4].classes.has('aretino-playing-syllable')).toBe(true);
    });

    it('can skip syllables and use custom classes', () => {
        const player = new EventTarget();
        const preview = makePreview();
        attachPlaybackHighlight(player, preview, { playingClass: 'now', syllableClass: null });
        emit(player, 'noteon', { srcStart: 5, srcEnd: 6 });
        emit(player, 'syllable', { srcStart: 20, srcEnd: 22 });
        expect(preview.els[0].classes.has('now')).toBe(true);
        expect(preview.els[3].classes.size).toBe(2);
    });

    it('clears everything when playback stops or pauses', () => {
        const player = new EventTarget();
        const preview = makePreview();
        attachPlaybackHighlight(player, preview);
        emit(player, 'noteon', { srcStart: 5, srcEnd: 6 });
        emit(player, 'syllable', { srcStart: 20, srcEnd: 22 });
        emit(player, 'statechange', { state: 'paused' });
        expect(preview.els.some(el => el.classes.has('aretino-playing') || el.classes.has('aretino-playing-syllable'))).toBe(false);
    });

    it('resolves the preview lazily and detaches cleanly', () => {
        const player = new EventTarget();
        let preview = makePreview();
        const detach = attachPlaybackHighlight(player, () => preview);
        emit(player, 'noteon', { srcStart: 5, srcEnd: 6 });
        expect(preview.els[0].classes.has('aretino-playing')).toBe(true);
        preview = makePreview(); // re-rendered
        emit(player, 'noteon', { srcStart: 7, srcEnd: 8 });
        expect(preview.els[1].classes.has('aretino-playing')).toBe(true);
        detach();
        expect(preview.els[1].classes.has('aretino-playing')).toBe(false);
        emit(player, 'noteon', { srcStart: 5, srcEnd: 6 });
        expect(preview.els[0].classes.has('aretino-playing')).toBe(false);
    });

    it('tolerates a missing preview', () => {
        const player = new EventTarget();
        attachPlaybackHighlight(player, () => null);
        expect(() => emit(player, 'noteon', { srcStart: 5, srcEnd: 6 })).not.toThrow();
        expect(() => clearPlaybackHighlight(null)).not.toThrow();
    });

    it('ships a stylesheet for the default classes', () => {
        expect(PLAYBACK_HIGHLIGHT_STYLE).toContain('.aretino-playing ');
        expect(PLAYBACK_HIGHLIGHT_STYLE).toContain('.aretino-playing-syllable');
    });
});
