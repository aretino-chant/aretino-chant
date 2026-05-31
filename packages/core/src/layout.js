/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { METRICS } from './glyphs.js';
import { ss } from './units.js';
import {
    keySigAdvance,
    clearCourtesyAccidentals,
    annotateCourtesyAccidentals,
} from './accidentals.js';
import { clefAdvance } from './clef.js';
import { measureItem } from './measure.js';

// Run the greedy line-fit repeatedly until the set of courtesy accidentals
// stabilises. Courtesy accidentals depend on where rows break (an accidental
// is restated at a line start), and adding them changes item widths, which can
// shift the breaks — so we iterate to a fixed point (capped at 8 passes).
export function layoutRowsWithCourtesyAccidentals(items, ctx, initialClef, staffRightX, drawStartClef, initialKeySig, allowedClefRows = Infinity, firstRowIndentWidth = 0) {
    clearCourtesyAccidentals(items);
    let previousSignature = null;
    let rows = [];

    for (let pass = 0; pass < 8; pass++) {
        rows = layoutRows(items, ctx, initialClef, staffRightX, drawStartClef, initialKeySig, allowedClefRows, firstRowIndentWidth);
        const signature = annotateCourtesyAccidentals(items, rows);
        if (signature === previousSignature) {
            return rows;
        }
        previousSignature = signature;
    }

    rows = layoutRows(items, ctx, initialClef, staffRightX, drawStartClef, initialKeySig, allowedClefRows, firstRowIndentWidth);
    annotateCourtesyAccidentals(items, rows);
    return rows;
}

// Greedy line-fit. Walks items, accumulating widths, breaking before any
// item that would push the row past the right margin. Explicit (z)/(Z)
// directives appear as `break` items and force a row finalization.
export function layoutRows(items, ctx, initialClef, staffRightX, drawStartClef, initialKeySig, allowedClefRows = Infinity, firstRowIndentWidth = 0) {
    const rows = [];
    let cur = [];
    let curWidth = 0;
    let rowStartClef = initialClef;
    let rowStartClefSource = null;
    let runningClef = initialClef;
    let rowStartKeySig = initialKeySig ?? [];
    let rowStartKeySigSource = null;
    let runningKeySig = initialKeySig ?? [];
    let clefRowsDrawn = 0;
    let isFirstRow = true;

    function currentRowDrawsClef() {
        return drawStartClef && clefRowsDrawn < allowedClefRows;
    }

    function rowItemsAvailable() {
        const showClef = currentRowDrawsClef();
        let reserved = isFirstRow ? firstRowIndentWidth : 0;
        const hasKeySig = rowStartKeySig.length > 0;
        if (showClef) {
            const clefSlot = hasKeySig
                ? clefAdvance(ctx, rowStartClef) - ss(ctx, METRICS.clefPostGap) + ss(ctx, METRICS.clefInlinePostGap)
                : clefAdvance(ctx, rowStartClef) + ss(ctx, METRICS.clefInlinePostGap);
            reserved += clefSlot;
        }
        if (hasKeySig) {
            reserved += keySigAdvance(ctx, rowStartKeySig);
            if (!showClef) {
                reserved += ss(ctx, METRICS.clefPostGap);
            } else {
                reserved += ss(ctx, 1);
            }
        }
        if (!showClef && !hasKeySig) {
            reserved += ctx.staffSpace;
        }
        return staffRightX - ctx.leftMargin - reserved;
    }

    function finalize(justify) {
        if (cur.length === 0 && rowStartClefSource === null && rowStartKeySigSource === null) {
            return;
        }
        const showClef = currentRowDrawsClef();
        const rowIsFirst = isFirstRow;
        isFirstRow = false;
        rows.push({
            items: cur,
            itemsWidth: curWidth,
            justify,
            startClef: rowStartClef,
            startClefSource: rowStartClefSource,
            startKeySig: rowStartKeySig,
            drawStartClef: showClef,
            indentWidth: rowIsFirst ? firstRowIndentWidth : 0,
        });
        if (showClef) {
            clefRowsDrawn++;
        }
        cur = [];
        curWidth = 0;
        rowStartClef = runningClef;
        rowStartClefSource = null;
        rowStartKeySig = runningKeySig;
        rowStartKeySigSource = null;
    }

    for (let ii = 0; ii < items.length; ii++) {
        const item = items[ii];
        if (item.kind === 'break') {
            finalize(item.justify);
            continue;
        }
        if (item.kind === 'clef') {
            runningClef = item.clef;
            if (cur.length === 0) {
                rowStartClef = item.clef;
                rowStartClefSource = item;
                continue;
            }
        }
        if (item.kind === 'keysig') {
            runningKeySig = item.accidentals;
            if (cur.length === 0) {
                rowStartKeySig = item.accidentals;
                rowStartKeySigSource = item;
                continue;
            }
        }
        // Accidentals are glued to the following neume — measure them as a
        // single atomic unit for line-breaking purposes.
        let w = measureItem(ctx, item);
        if (item.kind === 'accidental' && ii + 1 < items.length && items[ii + 1].kind === 'ligature') {
            w += measureItem(ctx, items[ii + 1]);
        }
        // Parenthesised groups are atomic: measure open+contents+close together
        // so the opening bracket never gets stranded at the end of a line with
        // the content wrapping to the next.  Only apply when the group fits in a
        // single row; if it is wider than a full row we let items wrap normally.
        if (item.kind === 'paren-open') {
            let groupW = w;
            for (let j = ii + 1; j < items.length; j++) {
                groupW += measureItem(ctx, items[j]);
                if (items[j].kind === 'paren-close') break;
            }
            if (groupW <= rowItemsAvailable()) {
                w = groupW;
            }
        }
        // If the previous item was an accidental glued to this item, skip the
        // overflow check (it was already accounted for).
        const gluedToPrev = ii > 0 && items[ii - 1].kind === 'accidental' && item.kind === 'ligature';
        if (!gluedToPrev && cur.length > 0 && curWidth + w > rowItemsAvailable()) {
            if (item.kind === 'barline') {
                // Barlines must not start a row — carry the preceding note/neume
                // unit (optionally with its leading accidental) to the new row.
                let splitIdx = -1;
                for (let k = cur.length - 1; k >= 0; k--) {
                    if (cur[k].kind === 'ligature') {
                        splitIdx = (k > 0 && cur[k - 1].kind === 'accidental') ? k - 1 : k;
                        break;
                    }
                }
                if (splitIdx >= 0) {
                    const carried = cur.splice(splitIdx);
                    curWidth -= carried.reduce((sum, it) => sum + measureItem(ctx, it), 0);
                    finalize(true);
                    for (const it of carried) {
                        cur.push(it);
                        curWidth += measureItem(ctx, it);
                    }
                } else {
                    finalize(true);
                }
            } else if (item.kind === 'ligature' && item.recitationGlyphless) {
                // A wrapping tenor recitation must not strand a single word at a
                // line edge: no orphan (a lone first word left on this row) and
                // no widow (a lone last word pushed to the next). Breaking before
                // chain piece p is allowed only when p === 0 (the whole phrase
                // wraps) or 2 ≤ p ≤ N-2. If p is a forbidden break, carry the
                // already-placed trailing words of the phrase to the next row
                // until the break lands on an allowed position.
                const N = item.recitationChainLen;
                const carried = [];
                let p = item.recitationChainIndex;
                const breakAllowed = q => q === 0 || (q >= 2 && q <= N - 2);
                while (!breakAllowed(p) && cur.length > 0) {
                    const top = cur[cur.length - 1];
                    if (!(top.kind === 'ligature' && top.recitationGlyphless
                        && top.recitationChainId === item.recitationChainId)) break;
                    cur.pop();
                    curWidth -= measureItem(ctx, top);
                    carried.unshift(top);
                    p = top.recitationChainIndex;
                }
                finalize(true);
                for (const c of carried) {
                    cur.push(c);
                    curWidth += measureItem(ctx, c);
                }
            } else {
                finalize(true);
                if (item.kind === 'clef') {
                    rowStartClef = item.clef;
                    rowStartClefSource = item;
                    continue;
                }
                if (item.kind === 'keysig') {
                    rowStartKeySig = item.accidentals;
                    continue;
                }
            }
        }
        cur.push(item);
        curWidth += measureItem(ctx, item);
    }
    finalize(false);
    return rows;
}
