/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Notehead designs worth comparing against each other, in the shape
// NOTEHEAD_DESIGN (src/glyphs.js) takes. Picking one in the playground just
// hands it to applyNoteheadDesign(), so switching is a re-render, not a
// reload. Dev-only: nothing here ships.

export const NOTEHEAD_PRESETS = [
    {
        name: 'v1',
        label: 'V1 (the original head)',
        note: 'Where this started: the plain ellipse of radii 0.61 × 0.47271 at 25°, '
            + 'and the advance 1.9 it was given by hand.',
        design: {
            rotationDeg: -25,
            // The exact box of radii 0.61 × 0.47271 at -25°; the committed
            // METRICS rounded it to 1.1749 for layout, 0.07% narrower.
            baseBoxWidth: 1.175671784837252,
            boxHeight: 1,
            stemStroke: 0.14,
            widen: 0,
            // The committed singleNoteAdvance 1.9 over that box width.
            advanceRatio: 1.616097302414225,
            ledgerHalfExtent: 0.81,
            moraOffsetX: 0.9,
            episemaWidth: 0.65,
            plicaAnchorX: 0.2,
        },
    },
    {
        name: 'bravura',
        label: 'Bravura (SMuFL black)',
        note: 'Bravura\'s noteheadBlack as our own head: its 1.18 × 1.0 box at the tilt '
            + 'that sits closest to its outline. A standard head is steeper and more '
            + 'lens-shaped than ours — it strays at most 0.013 SS from this ellipse.',
        design: {
            // Bravura's noteheadBlack (U+E0A4) is very nearly a true ellipse:
            // a free conic fit of its outline gives rx 0.639, ry 0.439 at
            // -31.31°, which its own outline never leaves by more than 0.007
            // SS. Held to the glyph's bounding box instead, -31.3° is the
            // tilt whose ellipse follows the outline closest (mean 0.004 SS,
            // worst 0.013 SS). See dev/fit-smufl-head.mjs.
            rotationDeg: -31.3,
            baseBoxWidth: 1.18,        // the glyph's own advance-free box
            boxHeight: 1,
            stemStroke: 0.14,
            widen: 0,                  // the reference head is not widened
            // SMuFL says nothing about the space after a note, so this stays
            // the golden ratio, as elsewhere.
            advanceRatio: 1.618034,
            ledgerHalfExtent: 0.81,
            moraOffsetX: 0.9,
            episemaWidth: 0.65,
            plicaAnchorX: 0.2,
        },
    },
    {
        name: 'v2',
        label: 'V2',
        note: 'A narrower base at a slightly steeper pen angle, widened only a little.',
        design: {
            rotationDeg: -27,
            baseBoxWidth: 1.115,
            boxHeight: 1,
            stemStroke: 0.14,
            widen: 0.09,
            advanceRatio: 1.618034,
            ledgerHalfExtent: 0.81,
            moraOffsetX: 0.9,
            episemaWidth: 0.65,
            plicaAnchorX: 0.2,
        },
    },
    {
        name: 'v3',
        label: 'V3 (working tree)',
        note: 'The SMuFL head\'s box on a gentler pen angle: as wide as a standard '
            + 'notehead, but fuller across the pen than one.',
        design: {
            // The Bravura box, kept whole, at 2.8° less tilt: the ellipse then
            // strays up to 0.03 SS from Bravura's outline (against 0.013 at
            // its own -31.3°), the difference being the fuller ends.
            rotationDeg: -28.5,
            baseBoxWidth: 1.18,
            boxHeight: 1,
            stemStroke: 0.14,
            widen: 0,
            advanceRatio: 1.618034,
            ledgerHalfExtent: 0.81,
            moraOffsetX: 0.9,
            episemaWidth: 0.65,
            plicaAnchorX: 0.2,
        },
    },
];

export function findPreset(design) {
    return NOTEHEAD_PRESETS.find((p) => Object.keys(p.design)
        .every((k) => Math.abs(p.design[k] - design[k]) < 1e-9));
}
