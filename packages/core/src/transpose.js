/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Render-time chromatic transposition. Driven by the `%transpose: N` header
// (signed integer = semitones). Operates on the flat render-item stream produced
// by flattenItems, per section, mutating it in place: note staff positions are
// shifted by the matching diatonic interval, key signatures are transposed, and
// inline accidentals are added for the chromatic residue (once per bar) or
// dropped when the new key signature already covers them.
//
// The source text is never touched — only the items handed to layout/draw.

import { PITCH_BASE } from './glyphs.js';

// Reverse of PITCH_BASE: staff position (-4..9) → aretino pitch letter.
const POS_TO_LETTER = {};
for (const [letter, pos] of Object.entries(PITCH_BASE)) {
    POS_TO_LETTER[pos] = letter;
}
const MIN_POS = Math.min(...Object.values(PITCH_BASE));
const MAX_POS = Math.max(...Object.values(PITCH_BASE));

// Semitone of each natural in C-major order C D E F G A B.
const NATURAL_SEMITONE = [0, 2, 4, 5, 7, 9, 11];

// Order accidentals appear in standard key signatures (aretino pitch letters).
// Mirrors items.js so the transposed signature draws at the same staff heights.
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'a', 'E', 'b'];
const FLAT_ORDER = ['b', 'E', 'a', 'D', 'g', 'C', 'F'];

function mod(n, m) {
    return ((n % m) + m) % m;
}

// C-major scale index (0=C .. 6=B) of a staff position.
function positionToCIndex(pos) {
    return mod(pos + 2, 7);
}

// Absolute semitone of the natural note at a staff position ('e' = 4, 'c' = 0).
function naturalAbs(pos) {
    return 12 * Math.floor((pos + 2) / 7) + NATURAL_SEMITONE[positionToCIndex(pos)];
}

// Staff position → aretino letter, clamped to the representable A–G–G ladder.
function positionToLetter(pos) {
    const clamped = Math.max(MIN_POS, Math.min(MAX_POS, pos));
    return POS_TO_LETTER[clamped];
}

function symbolToAlteration(symbol) {
    if (symbol === 'x') return -1; // flat
    if (symbol === '#') return 1;  // sharp
    return 0;                      // 'y' natural (or none)
}

function alterationToSymbol(alt) {
    if (alt < 0) return 'x';
    if (alt > 0) return '#';
    return 'y';
}

// Clamp a required alteration to the representable single-accidental range.
function clampAlt(alt) {
    return Math.max(-1, Math.min(1, alt));
}

// Line-of-fifths position of a key signature: +1 per sharp, −1 per flat.
function keySigToFifths(accidentals) {
    let f = 0;
    for (const acc of accidentals ?? []) {
        f += symbolToAlteration(acc.symbol);
    }
    return f;
}

// Line-of-fifths position → standard key-signature accidental list.
function fifthsToKeySig(f) {
    const out = [];
    if (f > 0) {
        for (let i = 0; i < Math.min(f, SHARP_ORDER.length); i++) {
            out.push({ pitch: SHARP_ORDER[i], symbol: '#' });
        }
    } else if (f < 0) {
        for (let i = 0; i < Math.min(-f, FLAT_ORDER.length); i++) {
            out.push({ pitch: FLAT_ORDER[i], symbol: 'x' });
        }
    }
    return out;
}

// Map of C-scale index → alteration implied by a key-signature accidental list.
function keySigToAltMap(accidentals) {
    const map = new Map();
    for (const acc of accidentals ?? []) {
        const pos = PITCH_BASE[acc.pitch];
        if (pos === undefined) continue;
        map.set(positionToCIndex(pos), symbolToAlteration(acc.symbol));
    }
    return map;
}

// Pick the enharmonic target key minimising accidental count; tie → flats.
// Returns the line-of-fifths target f1 and the diatonic step shift d.
function transposeTarget(f0, semitones) {
    const r = mod(f0 + 7 * semitones, 12); // 0..11
    const f1 = r <= 5 ? r : r - 12;         // window [-6, 5]: ≤6 flats / ≤5 sharps
    const d = Math.round((7 * semitones - (f1 - f0)) / 12);
    return { f1, d };
}

export function createTransposeState(amount) {
    return {
        amount,
        srcFifths: 0,            // running source key signature (line of fifths)
        srcKeyAlt: new Map(),    // running source key alterations by C-index
        emittedSig: false,       // whether a (transposed) key signature has been shown
    };
}

// Transpose one section's flat item list in place. `state` carries the running
// key-signature context across sections (created via createTransposeState).
export function applyTranspose(items, state) {
    if (!state || !state.amount) return;
    const N = state.amount;

    const out = [];
    const srcBarActive = new Map();  // source-side active accidentals by old position
    const barActive = new Map();     // displayed active accidentals by new position

    const clearBars = () => { srcBarActive.clear(); barActive.clear(); };

    for (const it of items) {
        // Inject the transposed key signature before the first note when the
        // source declared none (e.g. C major → 5 flats for +1 semitone).
        if (!state.emittedSig && it.kind === 'ligature') {
            const { f1 } = transposeTarget(state.srcFifths, N);
            if (f1 !== 0) {
                out.push({ kind: 'keysig', accidentals: fifthsToKeySig(f1) });
            }
            state.emittedSig = true;
        }

        if (it.kind === 'keysig') {
            state.srcFifths = keySigToFifths(it.accidentals);
            state.srcKeyAlt = keySigToAltMap(it.accidentals);
            const { f1 } = transposeTarget(state.srcFifths, N);
            it.accidentals = fifthsToKeySig(f1);
            state.emittedSig = true;
            clearBars();
            out.push(it);
            continue;
        }

        if (it.kind === 'barline') {
            clearBars();
            out.push(it);
            continue;
        }

        const { f1, d } = transposeTarget(state.srcFifths, N);

        const newKeyAlt = keySigToAltMap(fifthsToKeySig(f1));

        if (it.kind === 'accidental') {
            // Standalone accidental directive (applies to following notes at this
            // position until the barline). Transpose it, then drop it if the new
            // key signature / a bar-active accidental already provides the result.
            const oldPos = PITCH_BASE[it.pitch] ?? 4;
            const srcAlt = symbolToAlteration(it.symbol);
            srcBarActive.set(oldPos, srcAlt);
            const targetAbs = naturalAbs(oldPos) + srcAlt + N;
            const newPos = oldPos + d;
            const reqAlt = Math.max(-1, Math.min(1, targetAbs - naturalAbs(newPos)));
            const sounding = barActive.has(newPos)
                ? barActive.get(newPos)
                : (newKeyAlt.get(positionToCIndex(newPos)) ?? 0);
            if (reqAlt === sounding) {
                // Redundant: following notes are covered, so emit nothing.
                continue;
            }
            it.pitch = positionToLetter(newPos);
            it.symbol = alterationToSymbol(reqAlt);
            barActive.set(newPos, reqAlt);
            out.push(it);
            continue;
        }

        if (it.kind === 'ligature') {
            for (const group of it.groups) {
                for (const note of group) {
                    const oldPos = PITCH_BASE[note.pitch] ?? 0;
                    const accPos = note.accidental
                        ? (PITCH_BASE[note.accidental.pitch] ?? oldPos)
                        : oldPos;

                    if (note.accidental && accPos !== oldPos) {
                        // Cross-pitch accidental: a directive like `(bb)` drawn in
                        // front of a note of a *different* pitch (it alters that other
                        // pitch class for the rest of the bar, not this note). Transpose
                        // it at its OWN position and keep it in place; the note's own
                        // pitch is shifted independently below.
                        const accSrcAlt = symbolToAlteration(note.accidental.symbol);
                        srcBarActive.set(accPos, accSrcAlt);
                        const accTargetAbs = naturalAbs(accPos) + accSrcAlt + N;
                        const newAccPos = accPos + d;
                        const reqAccAlt = clampAlt(accTargetAbs - naturalAbs(newAccPos));
                        const accSounding = barActive.has(newAccPos)
                            ? barActive.get(newAccPos)
                            : (newKeyAlt.get(positionToCIndex(newAccPos)) ?? 0);
                        if (reqAccAlt === accSounding) {
                            delete note.accidental;
                        } else {
                            note.accidental = {
                                pitch: positionToLetter(newAccPos),
                                symbol: alterationToSymbol(reqAccAlt),
                                ...(note.accidental.srcStart !== undefined
                                    ? { srcStart: note.accidental.srcStart, srcEnd: note.accidental.srcEnd }
                                    : {}),
                            };
                            barActive.set(newAccPos, reqAccAlt);
                        }
                        // The note itself carries no own alteration here; just shift it.
                        note.pitch = positionToLetter(oldPos + d);
                        continue;
                    }

                    const oldCIndex = positionToCIndex(oldPos);

                    // Effective source alteration: inline accidental, else a bar-active
                    // accidental on this position, else the source key signature.
                    let srcAlt;
                    if (note.accidental) {
                        srcAlt = symbolToAlteration(note.accidental.symbol);
                        srcBarActive.set(oldPos, srcAlt);
                    } else if (srcBarActive.has(oldPos)) {
                        srcAlt = srcBarActive.get(oldPos);
                    } else {
                        srcAlt = state.srcKeyAlt.get(oldCIndex) ?? 0;
                    }

                    const targetAbs = naturalAbs(oldPos) + srcAlt + N;
                    const newPos = oldPos + d;
                    const reqAlt = clampAlt(targetAbs - naturalAbs(newPos));
                    note.pitch = positionToLetter(newPos);

                    // What is already sounding at this position: a bar-active
                    // accidental wins, otherwise the new key signature.
                    const sounding = barActive.has(newPos)
                        ? barActive.get(newPos)
                        : (newKeyAlt.get(positionToCIndex(newPos)) ?? 0);

                    if (reqAlt === sounding) {
                        delete note.accidental;
                    } else {
                        note.accidental = {
                            pitch: positionToLetter(newPos),
                            symbol: alterationToSymbol(reqAlt),
                            ...(note.srcStart !== undefined
                                ? { srcStart: note.srcStart, srcEnd: note.srcEnd }
                                : {}),
                        };
                        barActive.set(newPos, reqAlt);
                    }
                }
            }
            out.push(it);
            continue;
        }

        out.push(it);
    }

    items.length = 0;
    items.push(...out);
}
