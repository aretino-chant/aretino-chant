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
import { clefAdvance, clefInkRightOffset } from './clef.js';
import {
    measureItem,
    levelingNeed,
    levelingTargetFloors,
    isLeveledGap,
    breakViolations,
    condenseGaps,
    naturalNeumeWhite,
} from './measure.js';

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
//
// Rows are filled one at a time by fillRow, which starts from a snapshot of
// the running state and can be restarted from it. With `avoidLoneSyllables`
// on, an automatic break that leaves one syllable of a word alone is replaced
// by the cheapest nearby break (see chooseBreak).
export function layoutRows(items, ctx, initialClef, staffRightX, drawStartClef, initialKeySig, allowedClefRows = Infinity, firstRowIndentWidth = 0) {
    const layout = { items, ctx, staffRightX, drawStartClef, allowedClefRows, firstRowIndentWidth };
    const rows = [];
    let state = {
        ii: 0,
        tail: null,
        carry: [],
        rowStartClef: initialClef,
        rowStartClefSource: null,
        runningClef: initialClef,
        rowStartKeySig: initialKeySig ?? [],
        rowStartKeySigSource: null,
        runningKeySig: initialKeySig ?? [],
        clefRowsDrawn: 0,
        isFirstRow: true,
        done: false,
    };
    while (!state.done) {
        let filled = fillRow(layout, state);
        if (!filled) {
            break;
        }
        if (filled.reason === 'auto' && ctx.avoidLoneSyllables) {
            filled = chooseBreak(layout, state, filled);
        }
        rows.push(filled.row);
        state = filled.state;
    }
    return rows;
}

// Fill one row from `start`, a snapshot of everything the fill carries across a
// row start: the next item index, a neume tail wrapped from the previous row,
// items carried to the row start (a barline with the neume before it, the words
// of a recitation), the running and row-start clef and key signature, and the
// clef-row budget. Returns `{ row, reason, available, state }`, where `reason`
// is 'auto' (the width ran out), 'manual' (a (z)/(Z) break) or 'end', and
// `state` is the snapshot the next row starts from; or null when nothing is
// left to lay out.
//
// `bound` restricts the fill for the line breaker's candidates:
//  - `{ stopBefore: p }` breaks before item p, which must be reached by fitting;
//  - `{ forceBefore: p }` counts every item before p as fitting, then breaks;
// A manual break at p ends the row there as usual.
function fillRow(layout, start, bound = null) {
    const { items, ctx, staffRightX, drawStartClef, allowedClefRows, firstRowIndentWidth } = layout;
    let rowStartClef = start.rowStartClef;
    let rowStartClefSource = start.rowStartClefSource;
    let runningClef = start.runningClef;
    let rowStartKeySig = start.rowStartKeySig;
    let rowStartKeySigSource = start.rowStartKeySigSource;
    let runningKeySig = start.runningKeySig;
    let clefRowsDrawn = start.clefRowsDrawn;
    let isFirstRow = start.isFirstRow;
    let cur = [];
    let curWidth = 0;
    for (const it of start.carry) {
        cur.push(it);
        curWidth += measureItem(ctx, it);
    }
    const stopAt = bound?.stopBefore ?? bound?.forceBefore ?? -1;
    const forceBefore = bound?.forceBefore ?? -1;
    let finalized = null;

    function currentRowDrawsClef() {
        return drawStartClef && clefRowsDrawn < allowedClefRows;
    }

    // The neume that will start this row, or null when the row opens with the
    // continuation of a '/'-split neume, which carries no syllable of its own.
    // `pending` is the unit about to be placed, so the row's first neume is known
    // already on the call that decides whether it fits.
    function rowStartLigature(pending) {
        for (const list of pending ? [cur, pending] : [cur]) {
            for (const it of list) {
                if (it.kind === 'ligature') {
                    return it.neumeContinuation ? null : it;
                }
            }
        }
        return null;
    }

    // The last neume of the candidate row, whose trailing syllable reserve is
    // free width: the syllable it was reserved for has wrapped to the next row.
    function rowEndLigature(pending) {
        for (const list of pending ? [pending, cur] : [cur]) {
            for (let i = list.length - 1; i >= 0; i--) {
                if (list[i].kind === 'ligature') {
                    return list[i];
                }
            }
        }
        return null;
    }

    function rowItemsAvailable(pending = null) {
        const showClef = currentRowDrawsClef();
        const indent = isFirstRow ? firstRowIndentWidth : 0;
        // Room taken between the staff's left edge and the row's first item.
        let inset = 0;
        const hasKeySig = rowStartKeySig.length > 0;
        if (showClef) {
            const clefSlot = hasKeySig
                ? clefAdvance(ctx, rowStartClef) - ss(ctx, METRICS.clefPostGap) + ss(ctx, METRICS.clefInlinePostGap)
                : clefAdvance(ctx, rowStartClef) + ss(ctx, METRICS.clefInlinePostGap);
            inset += clefSlot;
        }
        if (hasKeySig) {
            inset += keySigAdvance(ctx, rowStartKeySig);
            if (!showClef) {
                // Keep a clefless key signature off the staff's left edge, then
                // retain the normal post-signature gap before the first note.
                inset += ctx.staffSpace / 2 + ss(ctx, METRICS.clefPostGap);
            } else {
                inset += ss(ctx, 1);
            }
        }
        if (!showClef && !hasKeySig) {
            inset += ctx.staffSpace;
        }
        // A row's first syllable must not hang past the staff's left edge, nor into
        // the column a start clef owns, so the renderer
        // opens a gap before the first neume for whatever of its leftward reach
        // the inset cannot absorb. Reserve that gap here — a row packed to the
        // full width has nowhere to take it from afterwards, and its last neume
        // ends up past the right margin. The row's own trailing reserve (room for
        // the syllable that wrapped away) pays for it first.
        const startLig = rowStartLigature(pending);
        const endLig = rowEndLigature(pending);
        const preGap = Math.max(0,
            rowStartLyricLimit(startLig) + (startLig?.rowStartOverhang ?? 0)
            - inset - (endLig?.rowEndSlack ?? 0));
        return staffRightX - ctx.leftMargin - indent - inset - preGap;
    }

    // Leftmost x the row's first syllable may reach, as an offset from the staff's
    // left edge: 0 normally, or the ink edge of a start clef, which owns its whole
    // column. Mirrors the renderer's row-start left-limit block.
    function rowStartLyricLimit(startLig) {
        if (!startLig || !startLig.rowStartHasText || !currentRowDrawsClef()) {
            return 0;
        }
        return clefInkRightOffset(ctx, rowStartClef);
    }

    function finalize(justify) {
        if (cur.length === 0 && rowStartClefSource === null && rowStartKeySigSource === null) {
            return false;
        }
        const showClef = currentRowDrawsClef();
        const rowIsFirst = isFirstRow;
        const available = rowItemsAvailable();
        isFirstRow = false;
        finalized = {
            row: {
                items: cur,
                itemsWidth: curWidth,
                justify,
                startClef: rowStartClef,
                startClefSource: rowStartClefSource,
                startKeySig: rowStartKeySig,
                drawStartClef: showClef,
                indentWidth: rowIsFirst ? firstRowIndentWidth : 0,
            },
            available,
        };
        if (showClef) {
            clefRowsDrawn++;
        }
        cur = [];
        curWidth = 0;
        rowStartClef = runningClef;
        rowStartClefSource = null;
        rowStartKeySig = runningKeySig;
        rowStartKeySigSource = null;
        return true;
    }

    // The result of a finalized row, with the state the next row starts from.
    function done(reason, ii, tail = null, carry = []) {
        return {
            ...finalized,
            reason,
            state: {
                ii, tail, carry,
                rowStartClef, rowStartClefSource, runningClef,
                rowStartKeySig, rowStartKeySigSource, runningKeySig,
                clefRowsDrawn, isFirstRow,
                done: reason === 'end',
            },
        };
    }

    // Place a ligature (item idx, or the tail of it), wrapping at its '/'
    // separators when it does not fit. As many leading groups as fit stay on
    // the current row; the remainder is carried to the next row as a
    // continuation, which may itself wrap again. A single-group neume (no '/')
    // simply wraps as a whole. Returns the finalized row when it breaks, or
    // null when the ligature was placed.
    function placeLigatureWithWrapping(lig, idx) {
        const w = measureItem(ctx, lig);
        const avail = rowItemsAvailable([lig]);
        if (idx < forceBefore || curWidth + w + levelingNeed(ctx, [...cur, lig]) <= avail) {
            cur.push(lig);
            curWidth += w;
            return null;
        }
        // Doesn't fit. Find the largest group-prefix that fits on this row
        // (0 if not even the first group fits at the current position).
        const groups = lig.groups;
        let k = 0;
        for (let n = 1; n < groups.length; n++) {
            const head = ligatureHead(lig, n);
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
                return lig === items[idx] ? done('auto', idx) : done('auto', idx + 1, lig);
            }
            // Row is empty and even the first group overflows a full row.
            // Nothing can be done for a single group; otherwise place one
            // group (unavoidable overflow) and carry the rest.
            if (groups.length === 1) {
                cur.push(lig);
                curWidth += w;
                return null;
            }
            k = 1;
        }
        const head = ligatureHead(lig, k);
        cur.push(head);
        curWidth += measureItem(ctx, head);
        finalize(true);
        return done('auto', idx + 1, ligatureTail(lig, k));
    }

    if (start.tail) {
        const wrapped = placeLigatureWithWrapping(start.tail, start.ii - 1);
        if (wrapped) {
            return wrapped;
        }
    }

    for (let ii = start.ii; ii < items.length; ii++) {
        const item = items[ii];
        if (ii === stopAt && item.kind !== 'break' && finalize(true)) {
            return done('auto', ii);
        }
        if (item.kind === 'break') {
            if (finalize(item.justify)) {
                return done('manual', ii + 1);
            }
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
            const wrapped = placeLigatureWithWrapping(item, ii);
            if (wrapped) {
                return wrapped;
            }
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
            if (groupW <= rowItemsAvailable(group)) {
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
        if (ii >= forceBefore && !gluedToPrev && cur.length > 0
            && curWidth + w + levelingNeed(ctx, [...cur, ...unit]) > rowItemsAvailable(unit)) {
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
                    if (finalize(true)) {
                        return done('auto', ii + 1, null, [...carried, item]);
                    }
                    // The neume was all the row had: it stays, with the barline.
                    for (const it of carried) {
                        cur.push(it);
                        curWidth += measureItem(ctx, it);
                    }
                    cur.push(item);
                    curWidth += measureItem(ctx, item);
                    continue;
                }
                finalize(true);
                return done('auto', ii + 1, null, [item]);
            } else if (item.kind === 'ligature' && item.recitationGlyphless) {
                // A wrapping tenor recitation must not strand a single word at a
                // line edge: no orphan (a lone first word left on this row) and
                // no widow (a lone last word pushed to the next). Breaking before
                // chain piece p is allowed only when p === 0 (the whole phrase
                // wraps) or 2 ≤ p ≤ N-2. If p is a forbidden break, carry the
                // already-placed trailing words of the phrase to the next row
                // until the break lands on an allowed position.
                // With avoidLoneSyllables, only a short word counts as lone: a
                // word at least recitationLoneWordMin wide reads well by itself
                // under the tenor note (`mert Krisztus | halála lett`).
                const N = item.recitationChainLen;
                const carried = [];
                let p = item.recitationChainIndex;
                const chainStart = ii - p;
                const isShort = k => !ctx.avoidLoneSyllables || items[chainStart + k].recitationWordShort;
                const loneAt = q => (q === 1 && isShort(0)) + (q === N - 1 && isShort(N - 1));
                const breakAllowed = q => q === 0 || loneAt(q) === 0;
                while (!breakAllowed(p) && cur.length > 0) {
                    const top = cur[cur.length - 1];
                    if (!(top.kind === 'ligature' && top.recitationGlyphless
                        && top.recitationChainId === item.recitationChainId)) break;
                    cur.pop();
                    curWidth -= measureItem(ctx, top);
                    carried.unshift(top);
                    p = top.recitationChainIndex;
                }
                // Everything on the row may have been carried: the break then
                // falls before the row's first word, so there's no row to end.
                if (!finalize(true)) {
                    for (const c of carried) {
                        cur.push(c);
                        curWidth += measureItem(ctx, c);
                    }
                    cur.push(item);
                    curWidth += measureItem(ctx, item);
                    continue;
                }
                return done('auto', ii + 1, null, [...carried, item]);
            } else {
                finalize(true);
                if (item.kind === 'clef') {
                    rowStartClef = item.clef;
                    rowStartClefSource = item;
                    return done('auto', ii + 1);
                }
                if (item.kind === 'keysig') {
                    rowStartKeySig = item.accidentals;
                    return done('auto', ii + 1);
                }
                return done('auto', ii + 1, null, [item]);
            }
        }
        cur.push(item);
        curWidth += measureItem(ctx, item);
    }
    if (finalize(false)) {
        return done('end', items.length);
    }
    return null;
}

// --- Lone syllables at a line break -------------------------------------

const VIOLATION_COST = 1000;
const BADNESS_SCALE = 100;
const PULL_BACK_COST = 10;

// The first ligature of the row a state starts: a wrapped neume tail, a carried
// neume, or the next neume in the items.
function firstLigatureOf(items, state) {
    if (state.tail) return state.tail;
    const carried = state.carry.find(it => it.kind === 'ligature');
    if (carried) return carried;
    for (let i = state.ii; i < items.length; i++) {
        if (items[i].kind === 'ligature') return items[i];
        if (items[i].kind === 'break') return null;
    }
    return null;
}

function lastLigatureOf(rowItems) {
    for (let i = rowItems.length - 1; i >= 0; i--) {
        if (rowItems[i].kind === 'ligature') return rowItems[i];
    }
    return null;
}

// Orphans and widows at the break a fill ended with. Manual breaks and the end
// of the section aren't breaks the line breaker chose, so they don't count.
function fillViolations(items, filled) {
    if (filled.reason !== 'auto') return 0;
    return breakViolations(lastLigatureOf(filled.row.items), firstLigatureOf(items, filled.state));
}

// How far a justified row stretches its gaps: the leftover space per leveled
// gap, as a share of the most extra white space a gap may take (§3.4).
function stretchUse(ctx, filled) {
    const { row, available } = filled;
    const leftover = available - row.itemsWidth;
    if (!row.justify || leftover <= 0) return 0;
    let gaps = 0;
    for (let i = 0; i < row.items.length - 1; i++) {
        if (isLeveledGap(row.items[i], row.items[i + 1])) gaps++;
    }
    const limit = ctx.wrapStretchMax * naturalNeumeWhite(ctx);
    if (gaps === 0 || limit <= 0) return Infinity;
    return (leftover / gaps) / limit;
}

// How far a row that takes in more than fits has to be condensed (§3.3):
// `{ use, condense }`, with `use` in 0…1 and `condense` the overflow the
// renderer takes out of the gaps, or null when it can't be condensed enough.
function condenseUse(ctx, filled) {
    const { row, available } = filled;
    const width = row.itemsWidth;
    const T = ctx.gapOutlierThreshold;
    const Tmin = Math.min(T, ctx.gapOutlierThresholdMin);
    const fits = t => width + levelingNeed(ctx, row.items, t) <= available;
    if (fits(T)) {
        return { use: stretchUse(ctx, filled), condense: 0 };
    }
    // Stage 1: accept a less even row by lowering the outlier threshold. The
    // leveling need is a step function of the threshold that only changes at
    // the row's own target floors, so the largest threshold that fits sits
    // just below the lowest floor in (Tmin, T] that doesn't.
    if (T > Tmin && fits(Tmin)) {
        const floors = levelingTargetFloors(ctx, row.items)
            .map(f => f / ctx.staffSpace)
            .filter(f => f > Tmin && f <= T)
            .sort((a, b) => a - b);
        const t = floors.find(f => !fits(f)) ?? T;
        return { use: 0.5 * (T - t) / (T - Tmin), condense: 0 };
    }
    // Stage 2: drop the leveling reserve and narrow the neume gaps.
    const deficit = Math.max(0, width - available);
    const condensed = condenseGaps(ctx, row.items, deficit);
    if (!condensed) return null;
    const limit = (1 - ctx.wrapCondenseMin) * naturalNeumeWhite(ctx);
    const share = condensed.delta > 0 ? condensed.delta / limit : 0;
    return { use: 0.5 + 0.5 * share, condense: deficit };
}

function isBreakPoint(items, i) {
    const it = items[i];
    if (it.kind === 'ligature') {
        return !it.recitationGlyphless && !(i > 0 && items[i - 1].kind === 'accidental');
    }
    return it.kind === 'accidental'
        && items[i + 1]?.kind === 'ligature' && !items[i + 1].recitationGlyphless;
}

// Items no candidate break moves content across.
function isBarrier(it) {
    return it.kind === 'break' || it.kind === 'clef' || it.kind === 'keysig'
        || it.kind === 'paren-open' || it.kind === 'paren-close'
        || (it.kind === 'ligature' && it.recitationGlyphless);
}

function hasOpenParen(rowItems) {
    let open = false;
    for (const it of rowItems) {
        if (it.kind === 'paren-open') open = true;
        else if (it.kind === 'paren-close') open = false;
    }
    return open;
}

// Rows a plain greedy fill needs from `state` to the end of the section, or to
// its next manual break (the rows after that don't depend on where it began).
function countGreedyRows(layout, state) {
    let rows = 0;
    while (!state.done) {
        const filled = fillRow(layout, state);
        if (!filled) break;
        rows++;
        if (filled.reason === 'manual') break;
        state = filled.state;
    }
    return rows;
}

// The greedy fill ended its row with an automatic break. If that break leaves
// one syllable of a word alone at either side, try the nearby breaks around the
// broken words and return the cheapest row (§3): pushing the break forward
// condenses the row, pulling it back stretches it. A candidate that can't bend
// that far, or a pull-back that would cost the section a row, is dropped, so
// the lone syllable stays only when nothing better fits.
function chooseBreak(layout, start, greedy) {
    const { items, ctx } = layout;
    const next = greedy.state;
    const left = lastLigatureOf(greedy.row.items);
    const right = firstLigatureOf(items, next);
    const violations = breakViolations(left, right);
    if (violations === 0 || hasOpenParen(greedy.row.items)) {
        return greedy;
    }

    // Where the greedy break falls: before item `breakAt`, or inside the neume
    // at `splitAt` when a '/' split carried its tail to the next row.
    const splitAt = next.tail ? next.ii - 1 : -1;
    const breakAt = next.tail ? -1 : (next.carry.length ? items.indexOf(next.carry[0]) : next.ii);
    if (splitAt < 0 && breakAt < 0) {
        return greedy;
    }
    const origin = splitAt >= 0 ? splitAt : breakAt;

    // The words the break cuts, per stanza, and the span of neumes they cover.
    const broken = left.lyricWord.map((a, s) => {
        const b = right.lyricWord[s];
        return a && b && a.word === b.word ? a.word : null;
    });
    const inBrokenWord = it => it.kind === 'ligature'
        && (it.lyricWord ?? []).some((e, s) => e && broken[s] !== null && e.word === broken[s]);
    let wordStart = origin;
    for (let i = origin; i >= 0 && items[i].kind !== 'break'; i--) {
        if (items[i].kind !== 'ligature') continue;
        if (!inBrokenWord(items[i])) break;
        wordStart = i;
    }
    let wordEnd = origin;
    for (let i = origin; i < items.length && items[i].kind !== 'break'; i++) {
        if (items[i].kind !== 'ligature') continue;
        if (!inBrokenWord(items[i])) break;
        wordEnd = i;
    }
    const neumeOf = i => (items[i].kind === 'accidental' ? i + 1 : i);

    let best = greedy;
    let bestCost = VIOLATION_COST * violations + BADNESS_SCALE * stretchUse(ctx, greedy) ** 3;
    const consider = (filled, use, extra) => {
        const cost = VIOLATION_COST * fillViolations(items, filled) + BADNESS_SCALE * use ** 3 + extra;
        if (cost < bestCost) {
            best = filled;
            bestCost = cost;
        }
    };
    const endsAt = (filled, p) => {
        if (!filled || !filled.row.items.some(it => it.kind === 'ligature')) return false;
        if (p === items.length) return filled.reason === 'end';
        const ii = items[p].kind === 'break' ? p + 1 : p;
        return filled.state.ii === ii && !filled.state.tail && filled.state.carry.length === 0;
    };

    // Push forward: breaks after the greedy one, up to and including the end
    // of the broken words. Condensing only grows, so stop at the first that
    // can't be condensed enough.
    for (let p = origin + 1; p <= items.length; p++) {
        const barrier = p === items.length || isBarrier(items[p]);
        if (!barrier && !isBreakPoint(items, p)) continue;
        if (p < items.length && items[p].kind === 'paren-close') break;
        const filled = fillRow(layout, start, { forceBefore: p });
        if (!endsAt(filled, p)) break;
        const condensed = condenseUse(ctx, filled);
        if (!condensed || condensed.use > 1) break;
        if (condensed.condense > 0) {
            filled.row.condense = condensed.condense;
        }
        consider(filled, condensed.use, 0);
        if (barrier || neumeOf(p) > wordEnd) break;
    }

    // Pull back: breaks before the greedy one, down to the start of the broken
    // words, never emptying the row or crossing its start.
    const lowest = start.tail || start.carry.length ? start.ii : start.ii + 1;
    let greedyRows = null;
    for (let p = splitAt >= 0 ? splitAt : breakAt - 1; p >= lowest; p--) {
        if (isBarrier(items[p])) break;
        if (!isBreakPoint(items, p)) continue;
        if (neumeOf(p) < wordStart) break;
        const filled = fillRow(layout, start, { stopBefore: p });
        if (!endsAt(filled, p)) continue;
        const use = stretchUse(ctx, filled);
        if (use > 1) continue;
        greedyRows ??= countGreedyRows(layout, next);
        if (countGreedyRows(layout, filled.state) > greedyRows) continue;
        consider(filled, use, PULL_BACK_COST);
    }
    return best;
}
