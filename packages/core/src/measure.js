/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { METRICS, pitchY } from './glyphs.js';
import { ss } from './units.js';
import {
    accidentalSymbolAdvance,
    accidentalListAdvance,
    keySigAdvance,
} from './accidentals.js';
import { clefAdvance } from './clef.js';

// A mora on a non-final note within a group acts like an implicit '/' cut:
// the group is split after that note so the remaining notes form a new group.
// Exception: when the last 2 notes of the group both carry a mora, no split is
// inserted between them and both moras are drawn after the last notehead.
// Returns { groups, gaps } where gaps[i] is the gap type after groups[i]:
//   'mora'  — implicit split from an internal mora (compact spacing)
//   N (number) — explicit '/' separator repeated N times (N × neumeGapAdvance)
export function splitGroupsAtInternalMora(groups, gaps = []) {
    const resultGroups = [];
    const resultGaps = [];
    for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi];
        let current = [];
        for (let i = 0; i < group.length; i++) {
            current.push(group[i]);
            const hasMora = group[i].modifiers && group[i].modifiers.includes('mora');
            if (i < group.length - 1 && hasMora) {
                // Don't split between the last two notes when both carry a mora.
                const isSecondToLast = i === group.length - 2;
                const nextHasMora = isSecondToLast &&
                    group[i + 1].modifiers && group[i + 1].modifiers.includes('mora');
                if (!nextHasMora) {
                    resultGroups.push(current);
                    resultGaps.push('mora');
                    current = [];
                }
            }
        }
        if (current.length > 0) {
            resultGroups.push(current);
            if (gi < groups.length - 1) {
                resultGaps.push(gaps[gi] ?? 1);
            }
        }
    }
    return { groups: resultGroups, gaps: resultGaps };
}

// A plica on a non-final note within a group acts like an explicit '/' cut: the
// note is liquescent and the neume breaks after it, so the remaining notes form
// a new group separated by a normal neume gap. This makes a plica note behave
// like a note followed by a separator for both spacing and line wrapping.
// Applied when the ligature item is built (before layout) so the split is a real
// group boundary that line-wrapping can break at.
export function splitGroupsAtPlica(groups, gaps = []) {
    const resultGroups = [];
    const resultGaps = [];
    for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi];
        let current = [];
        for (let i = 0; i < group.length; i++) {
            current.push(group[i]);
            const hasPlica = group[i].modifiers && group[i].modifiers.includes('plica');
            if (i < group.length - 1 && hasPlica) {
                resultGroups.push(current);
                resultGaps.push(1);
                current = [];
            }
        }
        if (current.length > 0) {
            resultGroups.push(current);
            if (gi < groups.length - 1) {
                resultGaps.push(gaps[gi] ?? 1);
            }
        }
    }
    return { groups: resultGroups, gaps: resultGaps };
}

// groups: Note[][] — each group is a run of notes; groups are separated by neumatic cuts ('/').
// All groups except the last contribute a gap advance; the last group contributes singleNoteAdvance.
// Gap types: N (number) = N × neumeGapAdvance; 'mora' = compact spacing just past the mora dot.
export function measureLigature(ctx, groups, gaps = []) {
    const split = splitGroupsAtInternalMora(groups, gaps);
    return measureSplitLigature(ctx, split.groups, split.gaps);
}

export function measureLigatureVisualRight(ctx, groups, gaps = []) {
    const split = splitGroupsAtInternalMora(groups, gaps);
    groups = split.groups;
    gaps = split.gaps;

    const halfNoteW = ss(ctx, METRICS.noteBoxWidth) * 0.5;
    let groupStartX = 0;
    let lastNoteCx = null;

    for (let g = 0; g < groups.length; g++) {
        const notes = groups[g];
        let cx = groupStartX + halfNoteW;

        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            if (note.accidental) {
                cx += accidentalSymbolAdvance(ctx, note.accidental.symbol);
            }
            lastNoteCx = cx;
            if (i < notes.length - 1) {
                cx += ctx.ligatureStepAdvance;
            }
        }

        if (g < groups.length - 1) {
            const gapType = gaps[g] ?? 1;
            const slashCount = typeof gapType === 'number' ? gapType : 0;
            const lastNote = notes[notes.length - 1];
            const hasMora = lastNote.modifiers && lastNote.modifiers.includes('mora');
            const moraNoteCount = notes.filter(note => note.modifiers && note.modifiers.includes('mora')).length;
            const moraOverhang = (hasMora || moraNoteCount >= 2)
                ? ss(ctx, METRICS.moraOffsetX + METRICS.moraRadius)
                : 0;
            const accExtra = notes.reduce((sum, note) => sum + (note.accidental ? accidentalSymbolAdvance(ctx, note.accidental.symbol) : 0), 0);
            groupStartX += ss(ctx, METRICS.noteBoxWidth) + (notes.length - 1) * ctx.ligatureStepAdvance + slashCount * ctx.neumeGapAdvance + moraOverhang + accExtra;
        }
    }

    if (lastNoteCx === null) {
        return 0;
    }

    const lastGroup = groups[groups.length - 1];
    const lastNote = lastGroup?.[lastGroup.length - 1];
    const lastNoteHasMora = lastNote?.modifiers?.includes('mora');
    const allMoraNoteCount = groups.reduce((sum, group) => sum + group.filter(note => note.modifiers?.includes('mora')).length, 0);
    const hasMora = lastNoteHasMora || allMoraNoteCount >= 2;
    return lastNoteCx + ss(ctx, hasMora ? METRICS.moraOffsetX + METRICS.moraRadius : METRICS.noteBoxWidth * 0.5);
}

export function measureSplitLigature(ctx, groups, gaps) {
    let total = 0;
    for (let g = 0; g < groups.length; g++) {
        const notes = groups[g];
        const n = notes.length;
        // Add advance for any inline accidentals on notes in this group.
        const accExtra = notes.reduce((sum, note) => sum + (note.accidental ? accidentalSymbolAdvance(ctx, note.accidental.symbol) : 0), 0);
        if (g < groups.length - 1) {
            const gapType = gaps[g] ?? 1;
            const slashCount = typeof gapType === 'number' ? gapType : 0;
            const lastNote = notes[n - 1];
            const hasMora = lastNote.modifiers && lastNote.modifiers.includes('mora');
            const moraNoteCount = notes.filter(note => note.modifiers && note.modifiers.includes('mora')).length;
            // The mora dot extends past the note box right edge; account for that overhang
            // whether the gap after it is an explicit '/' or an implicit mora split.
            // For multi-mora groups, the dot is drawn after the last notehead even if it
            // doesn't itself carry a mora.
            const moraOverhang = (hasMora || moraNoteCount >= 2)
                ? ss(ctx, METRICS.moraOffsetX + METRICS.moraRadius)
                : 0;
            total += ss(ctx, METRICS.noteBoxWidth) + (n - 1) * ctx.ligatureStepAdvance + slashCount * ctx.neumeGapAdvance + moraOverhang + accExtra;
        } else {
            const lastNote = notes[n - 1];
            const hasMora = lastNote.modifiers && lastNote.modifiers.includes('mora');
            const moraNoteCount = notes.filter(note => note.modifiers && note.modifiers.includes('mora')).length;
            const moraExtra = (hasMora || moraNoteCount >= 2) ? ss(ctx, METRICS.moraOffsetX + METRICS.moraRadius) : 0;
            const hasTenor = notes.some(n => n.shape === 'tenor');
            const tenorExtra = hasTenor ? ss(ctx, METRICS.tenorAdvanceExtra) : 0;
            total += ctx.singleNoteAdvance + (n - 1) * ctx.ligatureStepAdvance + moraExtra + accExtra + tenorExtra;
        }
    }
    return total;
}

export function measureBarline(ctx, kind) {
    if (kind === ':|:') {
        return ss(ctx, METRICS.barlineDoubleAdvance) * 1.5 + ss(ctx, METRICS.barlinePostGap);
    }
    const base = (kind === '||' || kind === ':|' || kind === '|:' || kind === '|||')
        ? ss(ctx, METRICS.barlineDoubleAdvance)
        : ss(ctx, METRICS.barlineAdvance);
    return base + ss(ctx, METRICS.barlinePostGap);
}

// Whether the boundary between two adjacent row items receives leveled
// inter-neume space. Skipped boundaries:
//  - an accidental glued to its following neume (one atomic unit);
//  - zero-advance markers (brace/slur ends) and fixed spacers are transparent:
//    the boundary before them is the one real gap; counting the boundary after
//    them too would insert the leveled space twice across a single visual
//    break (a spacer thus rides on top of a normally leveled gap);
//  - paren arcs hug their group the way an accidental hugs its note;
//  - words of one tenor recitation phrase (~-joined) keep a fixed normal
//    space between them.
export function isLeveledGap(it, next) {
    if (it.kind === 'accidental' && next.kind === 'ligature') return false;
    if (it.kind === 'brace-open' || it.kind === 'brace-close' || it.kind === 'spacer') return false;
    if (it.kind === 'paren-open' || next.kind === 'paren-close') return false;
    if (it.recitationChainId != null && next.recitationChainId === it.recitationChainId) return false;
    return true;
}

// Whitespace a boundary already provides (baked into the items' advances).
// Leveling raises the total visible gap toward the water level, so built-in
// padding must count as floor rather than have the level added on top.
export function gapFloor(ctx, it, next) {
    let f = 0;
    if (it.kind === 'ligature') f += it.syllableExtra || 0;
    else if (it.kind === 'barline') f += ss(ctx, METRICS.barlinePostGap) + (it.barlineExtra || 0) / 2 + (it.barlinePostExtra || 0);
    else if (it.kind === 'clef') f += ss(ctx, METRICS.clefInlinePostGap);
    else if (it.kind === 'keysig' && it.accidentals.length) f += ss(ctx, METRICS.keySigInlinePostGap);
    // A labelled barline pads before its glyph too.
    if (next.kind === 'barline') f += (next.barlineExtra || 0) / 2;
    return f;
}

// The level ragged rows raise their gaps to: the widest gap floor, ignoring
// outliers. A floor wider than gapOutlierThreshold (e.g. one long syllable
// like "szent") keeps its own lyric-forced width instead of pulling every
// other gap on the line out to match it. If every floor is an outlier there
// is nothing sensible to level toward, so the smallest floor wins (no extra
// space is spent).
export function levelingTarget(ctx, floors) {
    if (floors.length === 0) return 0;
    const threshold = ss(ctx, ctx.gapOutlierThreshold ?? METRICS.gapOutlierThreshold);
    const below = floors.filter(f => f <= threshold);
    return below.length ? Math.max(...below) : Math.min(...floors);
}

// Extra width, beyond the items' own advances, needed to raise every leveled
// gap between the given row items to the leveling target — the space an
// unjustified row consumes to make all neume distances come out the same.
export function levelingNeed(ctx, rowItems) {
    const floors = [];
    for (let i = 0; i < rowItems.length - 1; i++) {
        if (isLeveledGap(rowItems[i], rowItems[i + 1])) {
            floors.push(gapFloor(ctx, rowItems[i], rowItems[i + 1]));
        }
    }
    if (floors.length === 0) return 0;
    const top = levelingTarget(ctx, floors);
    return floors.reduce((s, f) => s + Math.max(0, top - f), 0);
}

export function measureItem(ctx, item) {
    if (item.kind === 'clef') {
        return clefAdvance(ctx, item.clef) + ss(ctx, METRICS.clefInlinePostGap);
    }
    if (item.kind === 'accidental') {
        if (item.symbol === 'x') return ss(ctx, METRICS.accidentalAdvanceFlat);
        if (item.symbol === 'y') return ss(ctx, METRICS.accidentalAdvanceNatural);
        if (item.symbol === '#') return ss(ctx, METRICS.accidentalAdvanceSharp);
        return ss(ctx, METRICS.accidentalAdvanceFlat); // fallback
    }
    if (item.kind === 'keysig') {
        return keySigAdvance(ctx, item.accidentals) + (item.accidentals?.length ? ss(ctx, METRICS.keySigInlinePostGap) : 0);
    }
    if (item.kind === 'barline') {
        return measureBarline(ctx, item.value) + (item.barlineExtra || 0) + (item.barlinePostExtra || 0);
    }
    if (item.kind === 'spacer') {
        return ss(ctx, METRICS.spacerAdvance) * item.multiplier;
    }
    if (item.kind === 'expander') {
        return ctx.expanderWidth;
    }
    if (item.kind === 'paren-open' || item.kind === 'paren-close') {
        return ss(ctx, METRICS.parenthesisWidth) + ss(ctx, METRICS.parenthesisInnerGap);
    }
    if (item.kind === 'brace-open' || item.kind === 'brace-close') {
        return 0;
    }
    if (item.kind === 'ligature') {
        // A recitation piece draws no notehead of its own (the repeated tenor
        // glyph sits at the row-start word's left edge), so its width is purely
        // the word's prose advance carried in syllableExtra.
        if (item.recitationGlyphless) {
            return item.syllableExtra || 0;
        }
        return accidentalListAdvance(ctx, item.leadingCourtesyAccidentals)
            + measureLigature(ctx, item.groups, item.gaps ?? [])
            + (item.syllableExtra || 0);
    }
    return 0;
}

// Lowest (largest-y) point reached by any notehead in a row, used to push the
// lyric baseline below notes that dip beneath the staff.
export function rowLowestNoteY(ctx, row, staffBottomY) {
    let maxY = staffBottomY;
    const halfNoteH = ss(ctx, METRICS.noteBoxHeight) * 0.5;
    for (const it of row.items) {
        if (it.kind !== 'ligature') {
            continue;
        }
        for (const group of it.groups) {
            for (const note of group) {
                const cy = pitchY(ctx, note, staffBottomY);
                if (cy > maxY) {
                    maxY = cy + halfNoteH;
                }
            }
        }
    }
    return maxY;
}
