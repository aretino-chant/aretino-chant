/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { METRICS, pitchToPos } from './glyphs.js';

function ss(ctx, n) {
    return n * ctx.staffSpace;
}

// --- Advances ---------------------------------------------------------------

export function accidentalSymbolAdvance(ctx, symbol) {
    if (symbol === 'y') return ss(ctx, METRICS.accidentalAdvanceNatural);
    if (symbol === '#') return ss(ctx, METRICS.accidentalAdvanceSharp);
    return ss(ctx, METRICS.accidentalAdvanceFlat);
}

export function accidentalAdvance(ctx, acc) {
    return accidentalSymbolAdvance(ctx, acc.symbol);
}

export function accidentalListAdvance(ctx, accidentals) {
    if (!accidentals?.length) {
        return 0;
    }
    return accidentals.reduce((sum, acc) => sum + accidentalAdvance(ctx, acc), 0);
}

export function keySigAdvance(ctx, accidentals) {
    if (!accidentals?.length) return 0;
    return accidentals.reduce((sum, acc) => sum + accidentalSymbolAdvance(ctx, acc.symbol), 0);
}

// --- Courtesy accidentals ---------------------------------------------------

function accidentalKey(acc) {
    return `${pitchToPos(acc)}`;
}

function noteAccidentalKey(note) {
    return `${pitchToPos(note)}`;
}

function copyAccidental(acc) {
    return { pitch: acc.pitch, symbol: acc.symbol };
}

function setActiveAccidental(active, acc) {
    active.set(accidentalKey(acc), copyAccidental(acc));
}

export function clearCourtesyAccidentals(items) {
    for (const item of items) {
        if (item.kind === 'ligature') {
            delete item.leadingCourtesyAccidentals;
        }
    }
}

function courtesySignature(items) {
    return items
        .map((item, idx) => {
            if (item.kind !== 'ligature' || !item.leadingCourtesyAccidentals?.length) {
                return '';
            }
            const keys = item.leadingCourtesyAccidentals
                .map(acc => `${accidentalKey(acc)}=${acc.symbol}`)
                .join(',');
            return `${idx}:${keys}`;
        })
        .filter(Boolean)
        .join('|');
}

function updateActiveAccidentalsFromLigature(ligature, active, pendingCourtesy = null) {
    const courtesyByKey = new Map();
    for (const group of ligature.groups) {
        for (const note of group) {
            if (note.accidental) {
                const key = accidentalKey(note.accidental);
                pendingCourtesy?.delete(key);
                setActiveAccidental(active, note.accidental);
            }

            const noteKey = noteAccidentalKey(note);
            if (pendingCourtesy?.has(noteKey) && !courtesyByKey.has(noteKey)) {
                courtesyByKey.set(noteKey, copyAccidental(pendingCourtesy.get(noteKey)));
                pendingCourtesy.delete(noteKey);
            }
        }
    }
    return Array.from(courtesyByKey.values());
}

export function annotateCourtesyAccidentals(items, rows) {
    clearCourtesyAccidentals(items);
    const active = new Map();

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        const pendingCourtesy = rowIdx === 0 ? new Map() : new Map(active);

        for (const item of row.items) {
            if (item.kind === 'barline') {
                active.clear();
                pendingCourtesy.clear();
                continue;
            }

            if (item.kind === 'accidental') {
                pendingCourtesy.delete(accidentalKey(item));
                setActiveAccidental(active, item);
                continue;
            }

            if (item.kind === 'ligature') {
                const courtesy = updateActiveAccidentalsFromLigature(item, active, pendingCourtesy);
                if (courtesy.length > 0) {
                    item.leadingCourtesyAccidentals = courtesy;
                }
            }
        }
    }

    return courtesySignature(items);
}
