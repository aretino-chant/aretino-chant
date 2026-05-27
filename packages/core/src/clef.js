/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { METRICS } from './glyphs.js';
import { ss } from './units.js';

// Mirrors the advance returned by drawClef in glyphs.js. We need it during
// the line-fit pass before any drawing happens.
export function clefAdvance(ctx, clef) {
    const letter = (clef.letter || 'g').toLowerCase();
    const k = ctx.staffSpace / 591;
    if (letter === 'g') {
        return (2621 - 1186) * k + ss(ctx, METRICS.clefPostGap);
    }
    if (letter === 'f') {
        return (2889 - 1239) * k + ss(ctx, METRICS.clefPostGap);
    }
    if (letter === 'c') {
        return ss(ctx, METRICS.clefCWidth) + ss(ctx, METRICS.clefCRightPadding);
    }
    return 0;
}

// The clef in effect after a run of items — used to seed the next section's
// running clef. Falls back to the prior value when the section has no clef.
export function trailingClef(items, fallback) {
    for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].kind === 'clef') {
            return items[i].clef;
        }
    }
    return fallback;
}

// The key signature in effect after a run of items, paired with trailingClef.
export function trailingKeySig(items, fallback) {
    for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].kind === 'keysig') {
            return items[i].accidentals;
        }
    }
    return fallback;
}
