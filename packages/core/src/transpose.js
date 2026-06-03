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
import { parseAretino } from './parser.js';
import { groupSections, flattenItems } from './items.js';

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

// Write a (possibly out-of-range) staff position back onto a note, decomposing
// positions past G / below A into a base letter plus an octaveShift (the `^`/`v`
// markers) rather than clamping to the staff edge.
function setNotePosition(note, pos) {
    let p = pos;
    let shift = 0;
    while (p > MAX_POS) { p -= 7; shift += 1; }
    while (p < MIN_POS) { p += 7; shift -= 1; }
    note.pitch = POS_TO_LETTER[p];
    if (shift) {
        note.octaveShift = shift;
    } else {
        delete note.octaveShift;
    }
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

// Core per-note decision shared by the render-time and source-rewrite paths.
// Given a note's old staff position and effective source alteration, returns
// the new position, the inline alteration it now requires (clamped to a single
// accidental), and what is already sounding there (bar-active accidental, else
// the new key signature).
function transposeNote(oldPos, srcAlt, N, d, newKeyAlt, barActive) {
    const newPos = oldPos + d;
    const targetAbs = naturalAbs(oldPos) + srcAlt + N;
    const reqAlt = clampAlt(targetAbs - naturalAbs(newPos));
    const sounding = barActive.has(newPos)
        ? barActive.get(newPos)
        : (newKeyAlt.get(positionToCIndex(newPos)) ?? 0);
    return { newPos, reqAlt, sounding };
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
            const { newPos, reqAlt, sounding } = transposeNote(oldPos, srcAlt, N, d, newKeyAlt, barActive);
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
                    const oldPos = (PITCH_BASE[note.pitch] ?? 0) + 7 * (note.octaveShift || 0);
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
                        const { newPos: newAccPos, reqAlt: reqAccAlt, sounding: accSounding } =
                            transposeNote(accPos, accSrcAlt, N, d, newKeyAlt, barActive);
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
                        setNotePosition(note, oldPos + d);
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

                    const { newPos, reqAlt, sounding } = transposeNote(oldPos, srcAlt, N, d, newKeyAlt, barActive);
                    setNotePosition(note, newPos);

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

// ---------------------------------------------------------------------------
// Source-rewrite transposition (API for editors).
//
// transposeSource(source, semitones) returns a NEW aretino source string with
// the transposition baked in: note pitches are shifted, the key signature is
// retuned (or one is introduced), and inline/standalone accidentals are added,
// rewritten, or dropped to match. Unlike the render-time `%transpose` header
// path (applyTranspose), this rewrites the text itself so the editor can offer
// a permanent "transpose this chant" command.
//
// Only the music body is touched — headers (including any `%transpose:` line)
// are left exactly as-is, so callers should not combine this with the header
// directive on the same piece.

// Internal symbol → source accidental token (b flat, n natural, # sharp).
function symbolToSource(symbol) {
    if (symbol === 'x') return 'b';
    if (symbol === '#') return '#';
    return 'n';
}

function altToSource(alt) {
    if (alt < 0) return 'b';
    if (alt > 0) return '#';
    return 'n';
}

// Source text for an accidental directive at a given letter, e.g. `(c#)`.
function accidentalSource(letter, alt) {
    return `(${letter}${altToSource(alt)})`;
}

// Source text for a key signature directive in the short form: `(K)` (none),
// `(Kbb)` (2 flats), `(K###)` (3 sharps).
function keySigSource(fifths) {
    if (fifths > 0) return `(K${'#'.repeat(Math.min(fifths, SHARP_ORDER.length))})`;
    if (fifths < 0) return `(K${'b'.repeat(Math.min(-fifths, FLAT_ORDER.length))})`;
    return '(K)';
}

// Staff position → { letter, shift }: the in-range aretino letter plus the
// octave-shift count (`^`/`v` markers) for positions past G / below A. Mirrors
// setNotePosition without mutating a note.
function decomposePosition(pos) {
    let p = pos;
    let shift = 0;
    while (p > MAX_POS) { p -= 7; shift += 1; }
    while (p < MIN_POS) { p += 7; shift -= 1; }
    return { letter: POS_TO_LETTER[p], shift };
}

// Build the replacement edit for a note's pitch text. The note's source span
// covers leading octave markers + the pitch letter + trailing modifiers; only
// the markers and letter change, modifiers are preserved verbatim.
function pitchEdit(note, newPos, source, edits) {
    const { letter, shift } = decomposePosition(newPos);
    const oldText = source.slice(note.srcStart, note.srcEnd);
    let k = 0;
    while (k < oldText.length && (oldText[k] === '^' || oldText[k] === 'v')) k++;
    const modifiers = oldText.slice(k + 1);
    const prefix = shift > 0 ? '^'.repeat(shift) : shift < 0 ? 'v'.repeat(-shift) : '';
    const newText = prefix + letter + modifiers;
    if (newText !== oldText) {
        edits.push({ start: note.srcStart, end: note.srcEnd, text: newText });
    }
}

// Replace the source span [start,end) with `text`, unless it already matches.
function replaceEdit(start, end, text, source, edits) {
    if (source.slice(start, end) !== text) {
        edits.push({ start, end, text });
    }
}

// Collect the edits for one section's flattened item stream. `state` threads the
// running key-signature context across sections (as in applyTranspose).
function collectSectionEdits(items, state, source, edits) {
    const N = state.amount;
    const srcBarActive = new Map();
    const barActive = new Map();
    const clearBars = () => { srcBarActive.clear(); barActive.clear(); };

    for (const it of items) {
        // Introduce a transposed signature before the first note when the source
        // declared none (e.g. C major → 5 flats for +1 semitone).
        if (!state.emittedSig && it.kind === 'ligature') {
            const { f1 } = transposeTarget(state.srcFifths, N);
            if (f1 !== 0) {
                edits.push({ start: it.srcStart, end: it.srcStart, text: `${keySigSource(f1)} ` });
            }
            state.emittedSig = true;
        }

        if (it.kind === 'keysig') {
            state.srcFifths = keySigToFifths(it.accidentals);
            state.srcKeyAlt = keySigToAltMap(it.accidentals);
            const { f1 } = transposeTarget(state.srcFifths, N);
            replaceEdit(it.srcStart, it.srcEnd, keySigSource(f1), source, edits);
            state.emittedSig = true;
            clearBars();
            continue;
        }

        if (it.kind === 'barline') {
            clearBars();
            continue;
        }

        const { f1, d } = transposeTarget(state.srcFifths, N);
        const newKeyAlt = keySigToAltMap(fifthsToKeySig(f1));

        if (it.kind === 'accidental') {
            const oldPos = PITCH_BASE[it.pitch] ?? 4;
            const srcAlt = symbolToAlteration(it.symbol);
            srcBarActive.set(oldPos, srcAlt);
            const { newPos, reqAlt, sounding } = transposeNote(oldPos, srcAlt, N, d, newKeyAlt, barActive);
            if (reqAlt === sounding) {
                edits.push({ start: it.srcStart, end: it.srcEnd, text: '' });
            } else {
                replaceEdit(it.srcStart, it.srcEnd, accidentalSource(positionToLetter(newPos), reqAlt), source, edits);
                barActive.set(newPos, reqAlt);
            }
            continue;
        }

        if (it.kind === 'ligature') {
            for (const group of it.groups) {
                for (const note of group) {
                    const oldPos = (PITCH_BASE[note.pitch] ?? 0) + 7 * (note.octaveShift || 0);
                    const accPos = note.accidental
                        ? (PITCH_BASE[note.accidental.pitch] ?? oldPos)
                        : oldPos;

                    if (note.accidental && accPos !== oldPos) {
                        // Cross-pitch directive (e.g. `(bb)` before a note of a
                        // different pitch): transpose it at its own position and
                        // shift the note independently.
                        const accSrcAlt = symbolToAlteration(note.accidental.symbol);
                        srcBarActive.set(accPos, accSrcAlt);
                        const { newPos: newAccPos, reqAlt: reqAccAlt, sounding: accSounding } =
                            transposeNote(accPos, accSrcAlt, N, d, newKeyAlt, barActive);
                        if (reqAccAlt === accSounding) {
                            edits.push({ start: note.accidental.srcStart, end: note.accidental.srcEnd, text: '' });
                        } else {
                            replaceEdit(note.accidental.srcStart, note.accidental.srcEnd,
                                accidentalSource(positionToLetter(newAccPos), reqAccAlt), source, edits);
                            barActive.set(newAccPos, reqAccAlt);
                        }
                        pitchEdit(note, oldPos + d, source, edits);
                        continue;
                    }

                    const oldCIndex = positionToCIndex(oldPos);
                    let srcAlt;
                    if (note.accidental) {
                        srcAlt = symbolToAlteration(note.accidental.symbol);
                        srcBarActive.set(oldPos, srcAlt);
                    } else if (srcBarActive.has(oldPos)) {
                        srcAlt = srcBarActive.get(oldPos);
                    } else {
                        srcAlt = state.srcKeyAlt.get(oldCIndex) ?? 0;
                    }

                    const { newPos, reqAlt, sounding } = transposeNote(oldPos, srcAlt, N, d, newKeyAlt, barActive);
                    pitchEdit(note, newPos, source, edits);

                    if (note.accidental) {
                        if (reqAlt === sounding) {
                            edits.push({ start: note.accidental.srcStart, end: note.accidental.srcEnd, text: '' });
                        } else {
                            replaceEdit(note.accidental.srcStart, note.accidental.srcEnd,
                                accidentalSource(positionToLetter(newPos), reqAlt), source, edits);
                            barActive.set(newPos, reqAlt);
                        }
                    } else if (reqAlt !== sounding) {
                        // The shifted note now needs an accidental the source did
                        // not carry — insert one directly before the note.
                        edits.push({ start: note.srcStart, end: note.srcStart,
                            text: accidentalSource(positionToLetter(newPos), reqAlt) });
                        barActive.set(newPos, reqAlt);
                    }
                }
            }
            continue;
        }
    }
}

// Apply non-overlapping span edits to `source`. Edits are ordered by start, with
// zero-width insertions emitted before a replacement that begins at the same
// offset (so an inserted accidental/key signature precedes the note it fronts).
function applyEdits(source, edits) {
    edits.sort((a, b) => a.start - b.start || a.end - b.end);
    let out = '';
    let cursor = 0;
    for (const e of edits) {
        if (e.start < cursor) continue; // defensive: skip any overlap
        out += source.slice(cursor, e.start) + e.text;
        cursor = e.end;
    }
    return out + source.slice(cursor);
}

// Public API: transpose an aretino source string by `semitones` (signed).
export function transposeSource(source, semitones) {
    const N = Number(semitones) | 0;
    if (!N || !source) return source ?? '';
    const ast = parseAretino(source);
    const sections = groupSections(ast.lines);
    const state = createTransposeState(N);
    const edits = [];
    for (const sec of sections) {
        collectSectionEdits(flattenItems(sec.tokens), state, source, edits);
    }
    return applyEdits(source, edits);
}
