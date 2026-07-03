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
import { measureItem, levelingNeed } from './measure.js';

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

// Split a multi-group ligature at a '/' separator for line wrapping. A '/'
// between neume groups is a neumatic cut with no connecting stroke, so breaking
// there is visually seamless. The head (first k groups) keeps the syllable,
// label and leading courtesy accidentals; the tail (remaining groups) becomes a
// syllable-less continuation that starts the next row.
function ligatureHead(lig, k) {
    return {
        ...lig,
        groups: lig.groups.slice(0, k),
        gaps: (lig.gaps ?? []).slice(0, k - 1),
        // The head is row-terminal: nothing follows it on this row, so it needs
        // no trailing reserve for a following syllable.
        syllableExtra: 0,
    };
}

function ligatureTail(lig, k) {
    const tail = {
        ...lig,
        groups: lig.groups.slice(k),
        gaps: (lig.gaps ?? []).slice(k),
        neumeContinuation: true,
        syllableExtra: 0,
    };
    // The syllable, label and leading courtesy accidentals stay with the head;
    // the continuation draws bare noteheads. (Row-start courtesy accidentals for
    // the continuation are re-derived after layout by annotateCourtesyAccidentals.)
    delete tail.label;
    delete tail.leadingCourtesyAccidentals;
    return tail;
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

    // Place a ligature, wrapping at its '/' separators when it does not fit.
    // As many leading groups as fit stay on the current row; the remainder is
    // carried to the next row as a continuation, which may itself wrap again.
    // A single-group neume (no '/') simply wraps as a whole, exactly as before.
    function placeLigatureWithWrapping(lig) {
        let remaining = lig;
        while (true) {
            const w = measureItem(ctx, remaining);
            const avail = rowItemsAvailable();
            if (curWidth + w + levelingNeed(ctx, [...cur, remaining]) <= avail) {
                cur.push(remaining);
                curWidth += w;
                return;
            }
            // Doesn't fit. Find the largest group-prefix that fits on this row
            // (0 if not even the first group fits at the current position).
            const groups = remaining.groups;
            let k = 0;
            for (let n = 1; n < groups.length; n++) {
                const head = ligatureHead(remaining, n);
                if (curWidth + measureItem(ctx, head) + levelingNeed(ctx, [...cur, head]) <= avail) {
                    k = n;
                } else {
                    break;
                }
            }
            if (k === 0) {
                if (cur.length > 0) {
                    // Nothing of this neume fits after what's already on the row:
                    // wrap the whole neume to a fresh row and retry there.
                    finalize(true);
                    continue;
                }
                // Row is empty and even the first group overflows a full row.
                // Nothing can be done for a single group; otherwise place one
                // group (unavoidable overflow) and carry the rest.
                if (groups.length === 1) {
                    cur.push(remaining);
                    curWidth += w;
                    return;
                }
                k = 1;
            }
            const head = ligatureHead(remaining, k);
            cur.push(head);
            curWidth += measureItem(ctx, head);
            finalize(true);
            remaining = ligatureTail(remaining, k);
        }
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
        // A plain neume can wrap at its '/' separators. Accidental-led neumes
        // are placed atomically with their accidental (handled below), and
        // glyphless recitation pieces have their own orphan/widow wrapping.
        if (item.kind === 'ligature'
            && !item.recitationGlyphless
            && !(ii > 0 && items[ii - 1].kind === 'accidental')) {
            placeLigatureWithWrapping(item);
            continue;
        }
        // Accidentals are glued to the following neume — measure them as a
        // single atomic unit for line-breaking purposes. `unit` collects the
        // atomically placed items so the overflow check can account for the
        // gap boundaries they introduce.
        let w = measureItem(ctx, item);
        let unit = [item];
        if (item.kind === 'accidental' && ii + 1 < items.length && items[ii + 1].kind === 'ligature') {
            w += measureItem(ctx, items[ii + 1]);
            unit = [item, items[ii + 1]];
        }
        // Parenthesised groups are atomic: measure open+contents+close together
        // so the opening bracket never gets stranded at the end of a line with
        // the content wrapping to the next.  Only apply when the group fits in a
        // single row; if it is wider than a full row we let items wrap normally.
        if (item.kind === 'paren-open') {
            let groupW = w;
            const group = [item];
            for (let j = ii + 1; j < items.length; j++) {
                groupW += measureItem(ctx, items[j]);
                group.push(items[j]);
                if (items[j].kind === 'paren-close') break;
            }
            if (groupW <= rowItemsAvailable()) {
                w = groupW;
                unit = group;
            }
        }
        // If the previous item was an accidental glued to this item, skip the
        // overflow check (it was already accounted for).
        const gluedToPrev = ii > 0 && items[ii - 1].kind === 'accidental' && item.kind === 'ligature';
        // Besides the items' own widths, reserve the space leveling needs to
        // raise every inter-neume gap on the row to the widest gap floor.
        // Without this reserve a nearly-full row leaves no slack for leveling
        // and its gaps collapse to their floors — very uneven spacing right
        // before a wrap. Wrapping earlier instead guarantees each finalized
        // row can afford its uniform gap. (The reserve is monotone: if the
        // row plus this unit can afford it, every prefix could too, so items
        // already placed never retroactively overflow.)
        if (!gluedToPrev && cur.length > 0
            && curWidth + w + levelingNeed(ctx, [...cur, ...unit]) > rowItemsAvailable()) {
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
