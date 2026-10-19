/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Follows an AretinoPlayer in a rendered preview: the sounding notes (and,
// optionally, the sung syllable) get a class while they play, and the row
// they are on is scrolled into view. Works on any element holding the SVG
// renderAretino() produced, so a host with its own preview can reuse it.

const DEFAULT_PLAYING_CLASS = 'aretino-playing';
const DEFAULT_SYLLABLE_CLASS = 'aretino-playing-syllable';

function selectorFor(className) {
    const css = globalThis.CSS;
    if (css?.escape) return `.${css.escape(className)}`;
    return `.${className.replace(/[^a-zA-Z0-9_-]/g, '\\$&')}`;
}

function elementsForSpan(preview, srcStart, srcEnd, selector) {
    if (!preview || typeof preview.querySelectorAll !== 'function') return [];
    const out = [];
    for (const el of preview.querySelectorAll(`${selector}[data-src-start]`)) {
        const s = Number(el.dataset?.srcStart);
        const e = Number(el.dataset?.srcEnd);
        if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
        // A rendered note overlapping the event's span: equality in the usual
        // case, overlap when the event covers a tied pair of notes.
        if (s < srcEnd && e > srcStart) out.push(el);
    }
    return out;
}

export function clearPlaybackHighlight(preview, options = {}) {
    const playingClass = options.playingClass ?? DEFAULT_PLAYING_CLASS;
    const syllableClass = options.syllableClass ?? DEFAULT_SYLLABLE_CLASS;
    if (!preview || typeof preview.querySelectorAll !== 'function') return;
    for (const cls of [playingClass, syllableClass]) {
        for (const el of preview.querySelectorAll(selectorFor(cls))) {
            el.classList.remove(cls);
        }
    }
}

// Wires `player` to `preview` and returns a function that unwires it. The
// preview may be re-rendered at any time: elements are looked up per event.
//
// Options:
//   playingClass   class put on a note while it sounds ('aretino-playing')
//   syllableClass  class put on the lyric syllable being sung
//                  ('aretino-playing-syllable'); set to null to skip
//   scrollIntoView keep the sounding note visible (true)
export function attachPlaybackHighlight(player, preview, options = {}) {
    const playingClass = options.playingClass ?? DEFAULT_PLAYING_CLASS;
    const syllableClass = options.syllableClass === null ? null : (options.syllableClass ?? DEFAULT_SYLLABLE_CLASS);
    const scroll = options.scrollIntoView !== false;
    const getPreview = typeof preview === 'function' ? preview : () => preview;

    const onNoteOn = (e) => {
        const ev = e.detail;
        const root = getPreview();
        const notes = elementsForSpan(root, ev.srcStart, ev.srcEnd, '.aretino-note');
        for (const el of notes) el.classList.add(playingClass);
        if (scroll && notes[0] && typeof notes[0].scrollIntoView === 'function') {
            notes[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    };
    const onNoteOff = (e) => {
        const ev = e.detail;
        for (const el of elementsForSpan(getPreview(), ev.srcStart, ev.srcEnd, '.aretino-note')) {
            el.classList.remove(playingClass);
        }
    };
    const onSyllable = (e) => {
        if (!syllableClass) return;
        const root = getPreview();
        if (!root) return;
        for (const el of root.querySelectorAll(selectorFor(syllableClass))) el.classList.remove(syllableClass);
        const ev = e.detail;
        if (!Number.isFinite(ev.srcStart)) return;
        for (const el of elementsForSpan(root, ev.srcStart, ev.srcEnd, '.aretino-syllable')) {
            el.classList.add(syllableClass);
        }
    };
    const onState = (e) => {
        if (e.detail.state !== 'playing') {
            clearPlaybackHighlight(getPreview(), { playingClass, syllableClass: syllableClass ?? DEFAULT_SYLLABLE_CLASS });
        }
    };

    player.addEventListener('noteon', onNoteOn);
    player.addEventListener('noteoff', onNoteOff);
    player.addEventListener('syllable', onSyllable);
    player.addEventListener('statechange', onState);
    return () => {
        player.removeEventListener('noteon', onNoteOn);
        player.removeEventListener('noteoff', onNoteOff);
        player.removeEventListener('syllable', onSyllable);
        player.removeEventListener('statechange', onState);
        clearPlaybackHighlight(getPreview(), { playingClass, syllableClass: syllableClass ?? DEFAULT_SYLLABLE_CLASS });
    };
}

// CSS a host can drop in (the editor's shadow root includes it) so the
// classes above show: sounding notes in blue, the sung syllable bold.
export const PLAYBACK_HIGHLIGHT_STYLE = `
.${DEFAULT_PLAYING_CLASS} [fill]:not([fill="none"]) { fill: #2563eb; }
.${DEFAULT_PLAYING_CLASS} [stroke]:not([stroke="none"]) { stroke: #2563eb; }
.${DEFAULT_SYLLABLE_CLASS} text { fill: #2563eb; }
`;
