/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { METRICS, pitchY, noteInkBounds, computeAutoVirga } from './glyphs.js';
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

// A neume that carries real lyric text (set by the renderer from the w: lines;
// see hasRealLyricText). Leveling exists to even out spacing that *syllables*
// make uneven, so only these neumes take part in it.
function lyricBearing(it) {
    return it.kind === 'ligature' && it.hasLyric === true;
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
//    space between them;
//  - a gap with no real lyric on either side: a bare psalm melody (or one
//    written with nothing but division marks under it) keeps the default
//    advance between its notes instead of being leveled or justified out to
//    the margin. `justifyWithoutLyrics` marks every neume lyric-bearing to
//    restore the older, unconditional behaviour.
export function isLeveledGap(it, next) {
    if (it.kind === 'accidental' && next.kind === 'ligature') return false;
    if (it.kind === 'brace-open' || it.kind === 'brace-close' || it.kind === 'spacer') return false;
    if (it.kind === 'paren-open' || next.kind === 'paren-close') return false;
    if (it.recitationChainId != null && next.recitationChainId === it.recitationChainId) return false;
    if (!lyricBearing(it) && !lyricBearing(next)) return false;
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

// A leveled gap that may set the water level. Gaps touching a barline are
// excluded: a barline carries its own post-gap plus any centred-syllable
// clearance (barlinePostExtra), a local reserve that has nothing to do with
// the line's neume-to-neume rhythm. If such a gap were allowed to set the
// level, the width of whichever syllable happens to follow a barline would
// silently drive the spacing of every neume on the line — so the same syllable
// spreads the row when it sits after a barline but does nothing elsewhere.
// Only plain neume-to-neume gaps set the rhythm; barline-adjacent gaps keep
// their own (barline-inflated) width without pulling the rest of the line out.
export function isLevelingTargetGap(it, next) {
    return isLeveledGap(it, next) && it.kind !== 'barline' && next.kind !== 'barline';
}

// The level ragged rows raise their gaps to: the widest gap floor among the
// neume-to-neume gaps (`targetFloors`, gathered via isLevelingTargetGap),
// ignoring outliers. A floor wider than gapOutlierThreshold (e.g. one long
// syllable like "szent") keeps its own lyric-forced width instead of pulling
// every other gap on the line out to match it. If every candidate floor is an
// outlier there is nothing sensible to level toward, so the smallest wins (no
// extra space is spent); an empty candidate set levels to nothing.
// `threshold` (in staff spaces) defaults to the render's gapOutlierThreshold;
// the line breaker lowers it when it condenses a row (see levelingNeed).
export function levelingTarget(ctx, targetFloors, thresholdSS = ctx.gapOutlierThreshold ?? METRICS.gapOutlierThreshold) {
    if (targetFloors.length === 0) return 0;
    const threshold = ss(ctx, thresholdSS);
    const below = targetFloors.filter(f => f <= threshold);
    return below.length ? Math.max(...below) : Math.min(...targetFloors);
}

// Extra width, beyond the items' own advances, needed to raise every leveled
// gap between the given row items to the leveling target — the space an
// unjustified row consumes to make all neume distances come out the same.
// The need never decreases as `thresholdSS` grows, and only changes where the
// threshold passes one of the row's own target floors.
export function levelingNeed(ctx, rowItems, thresholdSS) {
    const floors = [];
    const targetFloors = [];
    for (let i = 0; i < rowItems.length - 1; i++) {
        const it = rowItems[i];
        const next = rowItems[i + 1];
        if (!isLeveledGap(it, next)) continue;
        const f = gapFloor(ctx, it, next);
        floors.push(f);
        if (isLevelingTargetGap(it, next)) targetFloors.push(f);
    }
    if (floors.length === 0) return 0;
    const top = levelingTarget(ctx, targetFloors, thresholdSS);
    return floors.reduce((s, f) => s + Math.max(0, top - f), 0);
}

// The floors of the gaps that may set the leveling target, in pixels. Their
// values are the only thresholds at which levelingNeed changes.
export function levelingTargetFloors(ctx, rowItems) {
    const targetFloors = [];
    for (let i = 0; i < rowItems.length - 1; i++) {
        if (isLevelingTargetGap(rowItems[i], rowItems[i + 1])) {
            targetFloors.push(gapFloor(ctx, rowItems[i], rowItems[i + 1]));
        }
    }
    return targetFloors;
}

// Orphaned and widowed syllables caused by breaking a line between two
// ligatures (the last of one row and the first of the next; the head and tail
// of a neume split at '/' both carry the neume's word). Each ligature carries
// `lyricWord`, one `{ word, pos, len }` or null per stanza (set by the
// renderer). When both sides of the break sing the same word, `b = left.pos`
// syllables stay before the break and `len − b` go after it: one syllable left
// at the end of the line is an orphan, one at the start of the next a widow.
// A split inside the word's last syllable leaves nothing after the break, so
// it is neither. Violations add up over the stanzas.
export function breakViolations(left, right) {
    const lw = left?.lyricWord;
    const rw = right?.lyricWord;
    if (!lw || !rw) return 0;
    let count = 0;
    for (let s = 0; s < lw.length; s++) {
        const a = lw[s];
        const b = rw[s];
        if (!a || !b || a.word !== b.word) continue;
        const after = a.len - a.pos;
        if (after === 0) continue;
        if (a.pos === 1) count++;
        if (after === 1) count++;
    }
    return count;
}

// The white space a neume leaves after its notehead at the natural advance,
// which condensing and stretching a row are measured against.
export function naturalNeumeWhite(ctx) {
    return ctx.singleNoteAdvance - ss(ctx, METRICS.noteBoxWidth);
}

// How far each gap after a row item may be narrowed: never below what its
// lyrics need (`syllableNeed`, set by the renderer), and never by more than
// (1 − wrapCondenseMin) of the natural white space between neumes. Only the
// neume-to-neume gaps that set the leveling target give anything up.
export function condenseCaps(ctx, rowItems) {
    const limit = Math.max(0, 1 - (ctx.wrapCondenseMin ?? METRICS.wrapCondenseMin)) * naturalNeumeWhite(ctx);
    const caps = new Array(rowItems.length).fill(0);
    for (let i = 0; i < rowItems.length - 1; i++) {
        const it = rowItems[i];
        if (it.kind !== 'ligature' || it.recitationGlyphless || it.syllableNeed == null) continue;
        if (!isLevelingTargetGap(it, rowItems[i + 1])) continue;
        const width = measureItem(ctx, it) - accidentalListAdvance(ctx, it.leadingCourtesyAccidentals);
        caps[i] = Math.max(0, Math.min(width - it.syllableNeed, limit));
    }
    return caps;
}

// Take `deficit` pixels out of a row's gaps, evenly, each gap giving up at most
// its cap (see condenseCaps): the smallest δ with Σ min(capᵢ, δ) = deficit.
// Returns `{ cuts, delta }`, where cuts[i] is the narrowing of the gap after
// item i, or null when the caps cannot cover the deficit.
export function condenseGaps(ctx, rowItems, deficit) {
    const caps = condenseCaps(ctx, rowItems);
    const cuts = new Array(rowItems.length).fill(0);
    if (deficit <= 0) return { cuts, delta: 0 };
    const total = caps.reduce((s, c) => s + c, 0);
    if (total + 1e-9 < deficit) return null;
    const sorted = caps.filter(c => c > 0).sort((a, b) => a - b);
    let remaining = deficit;
    let delta = 0;
    for (let i = 0; i < sorted.length; i++) {
        const open = sorted.length - i;
        const step = sorted[i] - delta;
        if (step * open >= remaining) {
            delta += remaining / open;
            remaining = 0;
            break;
        }
        remaining -= step * open;
        delta = sorted[i];
    }
    for (let i = 0; i < caps.length; i++) cuts[i] = Math.min(caps[i], delta);
    return { cuts, delta };
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

// Lowest (largest-y) ink reached by a ligature's notes, used to push the lyric
// baseline below whatever actually hangs beneath the staff. That is rarely the
// notehead: a virga stem descends to `virgaMaxBelowBottom` below the bottom line,
// well past the `lyricMinStaffDistance` floor the lyrics would otherwise take, and
// morae and a below-set ictus reach down too. So the verdict is `noteInkBounds`,
// the same geometry the drawing uses — including the auto-virga stems the drawing
// adds, and the group splits an internal mora forces, since both change which
// note a stem measures its length from.
export function ligatureLowestInkY(ctx, item, staffBottomY) {
    const { groups } = splitGroupsAtInternalMora(item.groups, item.gaps ?? []);
    let maxY = -Infinity;
    for (const notes of groups) {
        const autoVirga = computeAutoVirga(notes);
        let prevCy = null;
        for (let i = 0; i < notes.length; i++) {
            const cy = pitchY(ctx, notes[i], staffBottomY);
            const drawnNote = autoVirga[i] ? { ...notes[i], virga: true } : notes[i];
            const bounds = noteInkBounds(ctx, drawnNote, cy, staffBottomY, prevCy);
            if (bounds.maxY > maxY) maxY = bounds.maxY;
            prevCy = cy;
        }
    }
    return maxY;
}

// Lowest ink reached anywhere in a row. Used as the fallback when a row carries
// no syllables to measure against, where a single answer is needed for the whole
// row. Where one syllable's own clearance is the question — how far the first
// lyric baseline has to drop — the ink over that syllable is what answers it
// (see firstLyricBaselineY).
export function rowLowestNoteY(ctx, row, staffBottomY) {
    let maxY = staffBottomY;
    for (const it of row.items) {
        if (it.kind !== 'ligature') {
            continue;
        }
        const y = ligatureLowestInkY(ctx, it, staffBottomY);
        if (y > maxY) maxY = y;
    }
    return maxY;
}

// The baseline the first lyric line needs, given where each syllable sits and
// what music hangs over it.
//
// Each syllable is paired with the ink above *its own* horizontal span rather
// than with the row's deepest point, so one low virga stem pushes down only the
// syllables it actually stands over, and a tall letter elsewhere in the row adds
// no height under a stem that never meets it. The letters are measured by their
// real ascent, so the clearance is between the ink and the letters that are
// there, not between the ink and an em box mostly full of air.
//
// `spans` are `{ leftX, rightX, ascent }` for the syllables, `inkSpans` are
// `{ leftX, rightX, maxY }` for the drawn ligatures. `fallbackAscent` answers for
// a row with no syllables to measure.
export function firstLyricBaselineY(ctx, spans, inkSpans, staffBottomY, rowLowestY, fallbackAscent) {
    const floor = staffBottomY + ctx.lyricMinStaffDistance;
    if (!spans || spans.length === 0) {
        const top = Math.max(
            (rowLowestY > staffBottomY ? rowLowestY : staffBottomY) + ctx.lyricDistance,
            floor);
        return top + fallbackAscent;
    }
    let baseline = -Infinity;
    for (const span of spans) {
        let ink = staffBottomY;
        for (const s of inkSpans) {
            if (s.rightX < span.leftX || s.leftX > span.rightX) {
                continue;
            }
            if (s.maxY > ink) ink = s.maxY;
        }
        const top = Math.max(ink + ctx.lyricDistance, floor);
        const need = top + span.ascent;
        if (need > baseline) baseline = need;
    }
    return baseline;
}
