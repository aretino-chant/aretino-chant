/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Aretino source → a timed playback schedule.
//
// This module has no audio or DOM dependency: it turns the parsed score into a
// flat list of sounding notes and pauses with absolute times, which a Web
// Audio player (see player.js), a MIDI exporter or an editor's note
// highlighter can consume.
//
// Two layers make the rhythm. The first is the steady pulse of practical
// chant singing: every ordinary note is one pulse, and the few marks that
// change that — mora, episema, quilisma, tenor (recitation) notes, liquescent
// plicas, bar lines — scale the pulse by a fixed, tunable factor. The second
// (expression.js) shades that pulse the way a singer does: word accents lift,
// word ends settle, punctuation breathes, a neume's first note touches down
// and its last reposes, phrases ritard into their bar lines. It can be
// switched off for a strictly mechanical rendering.
//
// buildPlayback(sourceOrAst, options) → {
//     tempo,            — pulses per minute actually used
//     unit,             — seconds per pulse
//     duration,         — total length in seconds, pauses included
//     language,         — 'hu' | 'la' as detected or set
//     events: Array<
//         | { type: 'note', time, duration, units, midi, frequency,
//             pitch, octaveShift, shape, modifiers, srcStart, srcEnd,
//             ligStart, ligEnd, legato, gain, syllable, word, neume, sylPos,
//             expression }
//         | { type: 'rest', time, duration, units, srcStart, srcEnd, barline }
//     >,
//     syllables: Array<{ time, duration, text, srcStart, srcEnd }>,
// }
//
// `legato` on a note is true when the next note belongs to the same neume
// group, i.e. it is sung on the same breath of a syllable and should not be
// re-attacked. `syllable` is the lyric syllable the note is sung on (from the
// chosen stanza), or null for a note without text under it; `word` says where
// that syllable stands in its word; `neume` where the note stands in its
// neume group; `sylPos` where it stands among the notes of its syllable.

import { parseAretino } from './parser.js';
import { groupSections, flattenItems } from './items.js';
import { splitGroupsAtInternalMora } from './measure.js';
import { pitchToPos, PITCH_BASE } from './glyphs.js';
import { parseSyllables, expandSyllablesForLigatures, hasRealLyricText, lyricWords } from './lyrics.js';
import { detectLanguage, splitSyllables, syllabifyWord, accentIndex, countSyllables } from './prosody.js';
import { applyExpression, DEFAULT_EXPRESSION } from './expression.js';

export { countSyllables, DEFAULT_EXPRESSION, detectLanguage, splitSyllables, syllabifyWord, accentIndex };

// Semitone of each natural in C-major order C D E F G A B.
const NATURAL_SEMITONE = [0, 2, 4, 5, 7, 9, 11];

// Which C-major degree the clef letter names, and the MIDI note of the pitch a
// clef puts on its line: G4, C4 (middle C) and F3 — the standard clefs.
const CLEF_DEGREE = { g: 4, c: 0, f: 3 };
const CLEF_MIDI = { g: 67, c: 60, f: 53 };

// Default pulse multipliers. Each ordinary note (punctum, virga) lasts one
// pulse; these scale that for the marks that alter the rhythm.
export const DEFAULT_RHYTHM = Object.freeze({
    mora: 2,            // a dotted note is doubled
    episema: 1.5,       // a horizontal episema broadens the note
    quilisma: 0.75,     // the quilisma itself is light and quick…
    beforeQuilisma: 1.5, // …and the note before it is lengthened
    tenor: 2,           // a reciting note with no text under it
    plica: 1,           // total length of a plica note (main + liquescent part)
    plicaShare: 0.3,    // share of that taken by the soft liquescent step
    cadence: 1.25,      // last note before a full/double/triple bar, if undotted
    small: 1,           // cue-sized notes keep their length
});

// Pauses after bar lines, in pulses. A quarter bar and a breath mark only take
// a short breath; the pause grows with the weight of the division.
export const DEFAULT_PAUSES = Object.freeze({
    ',': 0.5,
    ',2': 0.5,
    "'": 0.5,
    ';': 1,
    '|': 2,
    '|0': 2,
    '|?': 2,
    '|:': 2,
    ':|': 2,
    ':|:': 2,
    '||': 3,
    '|||': 3,
    '~': 0.5,           // a standalone ~ divides like a quarter bar
    section: 3,         // between sections not already separated by a bar line
});

export const DEFAULT_TEMPO = 180;

const FULL_BAR = /^\|{1,3}$|^\|0$|^\|\?$|^:?\|:?$/;

// Pitch of a note at a staff position under a clef, in MIDI numbers, before
// any accidental. Positions count from the bottom staff line (0) in steps of
// a space/line, the same ladder pitchToPos uses.
function naturalMidi(pos, clef) {
    const letter = (clef?.letter || 'g').toLowerCase();
    const degree = CLEF_DEGREE[letter] ?? CLEF_DEGREE.g;
    const clefPos = 2 * ((clef?.line || 2) - 1);
    const k = pos - clefPos + degree;
    const octave = Math.floor(k / 7);
    const step = k - octave * 7;
    const base = (CLEF_MIDI[letter] ?? CLEF_MIDI.g) - NATURAL_SEMITONE[degree];
    return base + 12 * octave + NATURAL_SEMITONE[step];
}

function alteration(symbol) {
    if (symbol === 'x') return -1;
    if (symbol === '#') return 1;
    return 0;
}

function mod(n, m) {
    return ((n % m) + m) % m;
}

export function midiToFrequency(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

function noteDurationUnits(note, rhythm, recited) {
    let units = 1;
    const mods = note.modifiers || [];
    if (note.shape === 'tenor') {
        units = recited > 0 ? recited : rhythm.tenor;
    } else if (note.shape === 'quilisma') {
        units = rhythm.quilisma;
    }
    if (mods.includes('plica') && note.shape !== 'tenor') {
        units = rhythm.plica;
    }
    if (mods.includes('episema')) units *= rhythm.episema;
    if (mods.includes('mora')) units *= rhythm.mora;
    if (mods.includes('small')) units *= rhythm.small;
    return units;
}

function headerNumber(ast, key) {
    const raw = ast?.header?.[key];
    if (raw == null) return null;
    const n = parseFloat(String(raw));
    return Number.isFinite(n) ? n : null;
}

// The chosen stanza's syllables, one slot per ligature (melisma and extender
// placeholders included), exactly as the renderer aligns them, each with its
// place in its word and whether it carries the word accent.
function analyseLyrics(lyricLine, lang, accent) {
    if (!lyricLine) return [];
    const slots = expandSyllablesForLigatures(parseSyllables(lyricLine).filter(s => s.kind === 'note'));
    const words = lyricWords(slots);
    // Syllable texts per word, to find the accent.
    const texts = new Map();
    slots.forEach((syl, i) => {
        const w = words[i];
        if (!w || syl.continuation) return;
        if (!texts.has(w.word)) texts.set(w.word, []);
        texts.get(w.word)[w.pos - 1] = (syl.alignText ?? syl.text ?? '').trim();
    });
    const accents = new Map();
    for (const [id, list] of texts) {
        // A recited phrase (several words on one tenor) counts as one syllable
        // here; its own words are accented inside the recitation.
        const syls = list.map(t => (t ?? '').split(/\s+/)[0]);
        accents.set(id, accent(syls, lang));
    }
    return slots.map((syl, i) => {
        const w = words[i];
        const text = (syl.alignText ?? syl.text ?? '').trim();
        return {
            syl,
            text,
            real: !syl.continuation && hasRealLyricText(syl),
            word: w ? {
                pos: w.pos,
                len: w.len,
                accented: accents.get(w.word) === w.pos - 1,
                punct: (text.match(/[.,;:!?]+$/) || [''])[0],
            } : null,
        };
    });
}

export function buildPlayback(source, options = {}) {
    const ast = typeof source === 'string' ? parseAretino(source) : source;
    const rhythm = { ...DEFAULT_RHYTHM, ...(options.rhythm || {}) };
    const pauses = { ...DEFAULT_PAUSES, ...(options.pauses || {}) };
    const tieRepeats = options.tieRepeats !== false;
    const stanza = Number.isInteger(options.stanza) ? Math.max(0, options.stanza) : 0;
    const tempo = Math.max(1, options.tempo ?? headerNumber(ast, 'tempo') ?? DEFAULT_TEMPO);
    const unit = 60 / tempo;
    const transpose = (headerNumber(ast, 'transpose') ?? 0) + (options.transpose ?? 0);
    const plicaStep = Number.isInteger(options.plicaStep) ? options.plicaStep : -1;
    const accent = typeof options.accent === 'function' ? options.accent : accentIndex;
    const countFn = typeof options.countSyllables === 'function' ? options.countSyllables : null;

    const sections = groupSections(ast.lines);
    const allLyricText = sections.flatMap(sec => sec.lyrics.map(l => l.text || '')).join(' ');
    const language = options.language || ast.header?.language || detectLanguage(allLyricText);

    // Everything is first laid out in pulses (units); seconds come last so a
    // tempo change is a single multiplication.
    const events = [];
    const syllableRefs = [];
    let clef = { letter: 'g', line: 2 };
    let keySig = new Map();   // C-degree (pos mod 7) → alteration, from (K: …)
    let barActive = new Map(); // exact staff position → alteration, until the next bar

    const soundingMidi = (note) => {
        // An accidental written before a note names its own staff letter:
        // `(bb)f` puts a flat on b (for the rest of the bar) and leaves the f
        // alone, exactly as the renderer draws it. Only when the letter is the
        // note's own does the note itself change.
        if (note.accidental) {
            const accPos = PITCH_BASE[note.accidental.pitch];
            if (accPos !== undefined) barActive.set(accPos, alteration(note.accidental.symbol));
        }
        const pos = pitchToPos(note);
        const alt = barActive.has(pos) ? barActive.get(pos) : (keySig.get(mod(pos, 7)) ?? 0);
        return naturalMidi(pos, clef) + alt + transpose;
    };

    const pushRest = (units, src, barline) => {
        if (units <= 0) return;
        events.push({ type: 'rest', units, srcStart: src?.srcStart, srcEnd: src?.srcEnd, barline });
    };

    for (let si = 0; si < sections.length; si++) {
        const sec = sections[si];
        const items = flattenItems(sec.tokens);
        if (si > 0 && events.length && events[events.length - 1].type !== 'rest') {
            pushRest(pauses.section, null, null);
        }

        const lyricLine = sec.lyrics[Math.min(stanza, sec.lyrics.length - 1)];
        const slots = analyseLyrics(lyricLine, language, accent);
        let slot = 0;
        let openSyllable = null;   // index into syllableRefs
        let openWord = null;

        for (const it of items) {
            if (it.kind === 'clef') {
                clef = it.clef;
                continue;
            }
            if (it.kind === 'keysig') {
                keySig = new Map();
                for (const acc of it.accidentals || []) {
                    const pos = PITCH_BASE[acc.pitch];
                    if (pos !== undefined) keySig.set(mod(pos, 7), alteration(acc.symbol));
                }
                barActive = new Map();
                continue;
            }
            if (it.kind === 'accidental') {
                const pos = PITCH_BASE[it.pitch];
                if (pos !== undefined) barActive.set(pos, alteration(it.symbol));
                continue;
            }
            if (it.kind === 'barline') {
                barActive = new Map();
                const prev = lastNote(events);
                if (prev && FULL_BAR.test(it.value) && !prev.modifiers.includes('mora') && prev.shape !== 'tenor') {
                    prev.units *= rhythm.cadence;
                }
                pushRest(pauses[it.value] ?? 0, it, it.value);
                continue;
            }
            if (it.kind !== 'ligature') continue;

            const info = slots[slot] ?? null;
            slot++;
            if (info && info.real) {
                openSyllable = syllableRefs.length;
                syllableRefs.push({ text: info.syl.text, srcStart: info.syl.srcStart, srcEnd: info.syl.srcEnd });
                openWord = info.word;
            }
            const sylText = info && info.real ? info.text : '';
            const syllableRef = openSyllable !== null ? { ...syllableRefs[openSyllable] } : null;

            // A mora inside a neume closes a sub-neume, as the engraving
            // shows by the gap after the dot: `ef.(bb)f` is two units of
            // arsis and thesis, so the shaping reads the groups that way.
            const groups = splitGroupsAtInternalMora(it.groups, it.gaps ?? []).groups;
            for (let gi = 0; gi < groups.length; gi++) {
                const group = groups[gi];
                const groupEvents = [];
                for (let ni = 0; ni < group.length; ni++) {
                    const note = group[ni];
                    const midi = soundingMidi(note);
                    const isTenor = note.shape === 'tenor';
                    const recites = isTenor && sylText && ni === 0 && gi === 0;
                    const recitedSyls = recites && !countFn ? splitSyllables(sylText, { language, accent }) : null;
                    const recited = recites ? Math.max(1, countFn ? countFn(sylText) : recitedSyls.length) : 0;
                    let units = noteDurationUnits(note, rhythm, recited);
                    const mods = note.modifiers || [];
                    const prev = lastNote(events);

                    // The note before a quilisma is lengthened (the quilisma
                    // leans on it), unless it is already a long note.
                    if (note.shape === 'quilisma' && prev && prev.units < rhythm.beforeQuilisma) {
                        prev.units = rhythm.beforeQuilisma;
                    }

                    // A repeated pitch inside one neume group (bistropha,
                    // pressus) is held as a single longer sound — unless the
                    // first one carries a mora, which closes it: `f.f` is two
                    // notes, the second re-articulated.
                    if (tieRepeats && ni > 0 && prev && prev.midi === midi && prev.legato
                        && !prev.modifiers.includes('mora')
                        && !mods.includes('plica') && !isTenor) {
                        prev.units += units;
                        prev.srcEnd = note.srcEnd;
                        prev.tied = (prev.tied || 1) + 1;
                        prev.legato = ni < group.length - 1;
                        continue;
                    }

                    const base = {
                        type: 'note',
                        midi,
                        frequency: midiToFrequency(midi),
                        pitch: note.pitch,
                        octaveShift: note.octaveShift || 0,
                        shape: note.shape,
                        modifiers: mods.slice(),
                        srcStart: note.srcStart,
                        srcEnd: note.srcEnd,
                        ligStart: it.srcStart,
                        ligEnd: it.srcEnd,
                        gain: mods.includes('small') ? 0.7 : 0.9,
                        syllable: syllableRef,
                        syllableIndex: openSyllable,
                        word: openWord,
                    };

                    if (recited > 1) {
                        // A recitation: one re-articulated pulse per syllable
                        // of the text under the tenor note, so the steady
                        // recitation is audible, not one long drone. Each pulse
                        // knows its own word, for the accents of the text.
                        // The pulses stay on one breath (legato) and are
                        // softly re-articulated rather than attacked anew.
                        const per = units / recited;
                        for (let r = 0; r < recited; r++) {
                            const rs = recitedSyls?.[r];
                            const ev = {
                                ...base, units: per, legato: r < recited - 1, rearticulate: r > 0,
                                recitation: r + 1, recitationCount: recited,
                                word: rs ? { pos: rs.pos, len: rs.len, accented: rs.accented, punct: rs.punct } : openWord,
                                sylPos: 'only',
                            };
                            events.push(ev);
                            groupEvents.push(ev);
                        }
                        continue;
                    }

                    if (mods.includes('plica') && rhythm.plicaShare > 0) {
                        // A plica is a liquescent: the main pitch, then a soft
                        // short step onto the neighbouring degree as the
                        // syllable closes.
                        const mainUnits = units * (1 - rhythm.plicaShare);
                        const tailUnits = units - mainUnits;
                        const main = { ...base, units: mainUnits, legato: true };
                        const tailPos = pitchToPos(note) + plicaStep;
                        const tailMidi = naturalMidi(tailPos, clef)
                            + (barActive.get(tailPos) ?? keySig.get(mod(tailPos, 7)) ?? 0) + transpose;
                        const tail = {
                            ...base, units: tailUnits, midi: tailMidi,
                            frequency: midiToFrequency(tailMidi), legato: false,
                            gain: base.gain * 0.6, liquescent: true,
                        };
                        events.push(main, tail);
                        groupEvents.push(main, tail);
                        continue;
                    }

                    const ev = { ...base, units, legato: ni < group.length - 1 };
                    events.push(ev);
                    groupEvents.push(ev);
                }
                // Where each sounding note stands in its neume group (a tied
                // pair is one note, a plica's tail belongs to its note).
                const sounding = groupEvents.filter(e => !e.liquescent && !e.recitation);
                sounding.forEach((e, k) => { e.neume = { pos: k + 1, len: sounding.length }; });
                for (const e of groupEvents) if (!e.neume) e.neume = e.recitation ? { pos: 1, len: 1 } : { pos: sounding.length, len: sounding.length };
            }
        }
    }

    markSyllablePositions(events);

    const expression = options.expression === false
        ? null
        : { ...DEFAULT_EXPRESSION, ...(options.expression && typeof options.expression === 'object' ? options.expression : {}) };
    const shaped = expression ? applyExpression(events, expression) : events;

    let cursor = 0;
    for (const ev of shaped) {
        ev.time = cursor * unit;
        ev.duration = ev.units * unit;
        cursor += ev.units;
    }
    const duration = cursor * unit;

    const syllables = syllableRefs.map((ref, idx) => {
        const first = shaped.find(e => e.type === 'note' && e.syllableIndex === idx);
        const next = shaped.find(e => e.type === 'note' && e.syllableIndex != null && e.syllableIndex > idx);
        const time = first ? first.time : 0;
        const end = next ? next.time : duration;
        return { time, duration: end - time, text: ref.text, srcStart: ref.srcStart, srcEnd: ref.srcEnd };
    });

    return { tempo, unit, duration, language, events: shaped, syllables };
}

// Marks each note 'first' | 'mid' | 'last' | 'only' among the notes of its
// syllable (a melisma runs over several neumes). Recitation pulses already
// stand alone; notes with no syllable get null.
function markSyllablePositions(events) {
    const notes = events.filter(e => e.type === 'note' && !e.recitation);
    let i = 0;
    while (i < notes.length) {
        const idx = notes[i].syllableIndex;
        let j = i;
        while (j < notes.length && notes[j].syllableIndex === idx) j++;
        for (let k = i; k < j; k++) {
            if (idx == null) { notes[k].sylPos = null; continue; }
            notes[k].sylPos = j - i === 1 ? 'only' : (k === i ? 'first' : (k === j - 1 ? 'last' : 'mid'));
        }
        i = j;
    }
}

function lastNote(events) {
    for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === 'note') return events[i];
        if (events[i].type === 'rest') return null;
    }
    return null;
}
