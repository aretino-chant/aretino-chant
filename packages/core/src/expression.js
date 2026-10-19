/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Expression: shading the mechanical pulse of a schedule the way a singer
// shapes chant. The ideas are the familiar ones of free chant rhythm —
// arsis and thesis, the lift and the repose — read off three things the
// score already gives:
//
//   the text     a word's accented syllable is lifted (a little louder, not
//                longer), its last syllable relaxes (a little softer, not
//                slower); punctuation changes nothing unless asked to, the
//                bar lines drive the pauses;
//   the neume    the first note of a neume touches down (the ictus), the
//                middle notes flow, the melodic peak is the lift, the last
//                note reposes; the written ictus `-` is honoured;
//   the phrase   the line crescendos as it rises and softens as it falls,
//                and ritards into every bar line by the bar's weight.
//
// A relaxation — a word's end, a neume's repose, the note before a bar — is
// not played as a lighter note but as an easing off: the note gets a
// `gainStart` and diminishes from it to its `gain` through its length.
//
// Then a seeded breath of randomness takes the clockwork out of it. Each
// factor is an option (see DEFAULT_EXPRESSION); every note records the
// tags that were applied in `expression`, for tests and for the curious.
//
// applyExpression(events, options) → events  (a new array; notes mutated)

export const DEFAULT_EXPRESSION = Object.freeze({
    // Text
    accentGain: 0.12,       // lift of a word's accented syllable (its first note)
    thesisStretch: 1,       // last note of a word-final syllable: it relaxes…
    thesisGain: -0.08,      // …by easing off, not by slowing down
    // Punctuation does not stop the line: the bar lines drive the pauses. A
    // host may give `,` or `. ; : ! ?` a hold and a breath here.
    comma: { stretch: 1, breath: 0 },
    stop: { stretch: 1, breath: 0 },
    // Neume
    ictusGain: 0.04,        // a written ictus `-`
    ictusStretch: 1.05,
    neumeFirstGain: 0.04,   // first note of a multi-note neume
    neumeMiddle: 0.96,      // flowing middle notes
    neumeLastStretch: 1.03, // repose on the last note of a neume: barely longer…
    neumeLastGain: -0.04,   // …and a shade softer
    peakGain: 0.05,         // melodic peak of a neume of three or more
    quilismaGain: -0.06,    // the quilisma is light
    // Phrase
    contourGain: 0.012,     // per semitone above the phrase's mean pitch (clipped ±0.08)
    // Factors for the last notes before a bar line, last note first. Every
    // division closes its phrase the same way; the last note before a full
    // bar is already stretched by rhythm.cadence, so its own factor is 1.
    ritardando: { '|': [1, 1.1, 1.04], ';': [1.25, 1.1, 1.04], ',': [1.25, 1.1, 1.04] },
    cadenceGain: -0.075,    // the last note before a bar line eases off
    // Recitation
    recitationFlow: 0.94,   // unaccented, non-final syllables of a recitation move on
    // Human
    humanize: 0.03,         // ± share of timing and gain jitter
    seed: 1,
});

const GAIN_MIN = 0.15;
const GAIN_MAX = 1;

function barClass(barline) {
    if (!barline) return null;
    if (/^\|{1,3}$|^\|0$|^\|\?$|^:?\|:?$/.test(barline)) return '|';
    if (barline === ';') return ';';
    if (barline === ',' || barline === ',2' || barline === "'" || barline === '~') return ',';
    return null;
}

// A small deterministic generator (mulberry32) so a schedule is stable for a
// given seed — the same piece plays the same way twice.
function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function applyExpression(events, options = {}) {
    const o = { ...DEFAULT_EXPRESSION, ...options };
    const random = rng(o.seed);

    // Phrases: runs of notes between rests, for the contour's mean pitch.
    const phraseMean = new Map();
    {
        let run = [];
        const flush = () => {
            if (!run.length) return;
            const mean = run.reduce((s, e) => s + e.midi, 0) / run.length;
            for (const e of run) phraseMean.set(e, mean);
            run = [];
        };
        for (const ev of events) {
            if (ev.type === 'note') run.push(ev); else flush();
        }
        flush();
    }

    // Neume groups, for peaks: consecutive notes sharing a group.
    const groupOf = new Map();
    {
        let group = [];
        for (const ev of events) {
            if (ev.type !== 'note' || ev.liquescent) continue;
            if (ev.neume?.pos === 1) group = [];
            group.push(ev);
            groupOf.set(ev, group);
        }
    }

    const factor = new Map();
    const gainDelta = new Map();
    const easeDelta = new Map();   // the part of the gain change reached only by the note's end
    const tags = new Map();
    const bump = (ev, f, g, tag) => {
        factor.set(ev, (factor.get(ev) ?? 1) * f);
        gainDelta.set(ev, (gainDelta.get(ev) ?? 0) + g);
        if (tag) tags.get(ev).push(tag);
    };
    // A relaxation is not a lighter touch but an easing off: the note starts
    // at the level it would have had and diminishes through its length.
    const ease = (ev, f, g, tag) => {
        bump(ev, f, 0, tag);
        easeDelta.set(ev, (easeDelta.get(ev) ?? 0) + g);
    };
    for (const ev of events) if (ev.type === 'note') tags.set(ev, []);

    const out = [];
    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        out.push(ev);
        if (ev.type !== 'note') continue;
        const next = events[i + 1];

        // --- the neume ------------------------------------------------------
        const n = ev.neume;
        if (n && n.len >= 2 && !ev.liquescent) {
            if (n.pos === 1) bump(ev, 1, o.neumeFirstGain, 'ictic');
            else if (n.pos === n.len) ease(ev, o.neumeLastStretch, o.neumeLastGain, 'repose');
            else bump(ev, o.neumeMiddle, 0, 'flow');
            const g = groupOf.get(ev);
            if (g && g.length >= 3) {
                const k = g.indexOf(ev);
                if (k > 0 && k < g.length - 1 && ev.midi > g[k - 1].midi && ev.midi > g[k + 1].midi) {
                    bump(ev, 1, o.peakGain, 'peak');
                }
            }
        }
        if (ev.modifiers?.includes('ictus')) bump(ev, o.ictusStretch, o.ictusGain, 'ictus');
        if (ev.shape === 'quilisma') bump(ev, 1, o.quilismaGain, 'light');

        // --- the phrase -----------------------------------------------------
        const mean = phraseMean.get(ev);
        if (mean !== undefined) {
            const c = Math.max(-0.08, Math.min(0.08, (ev.midi - mean) * o.contourGain));
            if (c) bump(ev, 1, c, null);
        }

        // --- the text -------------------------------------------------------
        const w = ev.word;
        const pos = ev.sylPos;
        if (w && pos) {
            const starts = pos === 'first' || pos === 'only';
            const ends = pos === 'last' || pos === 'only';
            if (w.accented && starts) bump(ev, 1, o.accentGain, 'accent');
            // Recited speech does not dwell on its unstressed inner syllables.
            if (ev.recitation && !w.accented && w.pos !== w.len) bump(ev, o.recitationFlow, 0, 'flow');
            if (ends && w.pos === w.len) {
                const punct = w.punct || '';
                const rule = /[.;:!?]/.test(punct) ? o.stop : (punct.includes(',') ? o.comma : null);
                if (rule) {
                    ease(ev, rule.stretch, o.thesisGain, 'punct');
                    if (!(next && next.type === 'rest') && rule.breath > 0) {
                        out.push({ type: 'rest', units: rule.breath, barline: null, breath: true });
                    }
                } else {
                    ease(ev, o.thesisStretch, o.thesisGain, 'thesis');
                }
            }
        }
    }

    // --- ritardando into each bar line ----------------------------------------
    for (let i = 0; i < out.length; i++) {
        const ev = out[i];
        if (ev.type !== 'rest' || !ev.barline) continue;
        const factors = o.ritardando?.[barClass(ev.barline)];
        if (!factors) continue;
        let k = 0;
        for (let j = i - 1; j >= 0 && k < factors.length; j--) {
            const e = out[j];
            if (e.type !== 'note') break;
            if (e.liquescent) continue;
            if (k === 0) ease(e, 1, o.cadenceGain, 'cadence');
            if (factors[k] !== 1) bump(e, factors[k], 0, 'rit');
            k++;
        }
    }

    // --- apply, with a breath of randomness -----------------------------------
    for (const ev of out) {
        if (ev.type !== 'note') continue;
        let f = factor.get(ev) ?? 1;
        let g = gainDelta.get(ev) ?? 0;
        if (o.humanize > 0) {
            f *= 1 + (random() - 0.5) * 2 * o.humanize;
            g += (random() - 0.5) * 2 * o.humanize;
        }
        ev.units *= f;
        const start = Math.max(GAIN_MIN, Math.min(GAIN_MAX, ev.gain + g));
        const eased = easeDelta.get(ev) ?? 0;
        ev.gain = Math.max(GAIN_MIN, Math.min(GAIN_MAX, start + eased));
        if (eased && ev.gain !== start) ev.gainStart = start;
        ev.expression = tags.get(ev) ?? [];
    }
    return out;
}
