/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
    METRICS,
    pitchToPos,
    pitchY,
    drawNoteHead,
    drawEpisema,
    drawEpisemaSpan,
    drawIctus,
    drawMora,
    drawPlica,
    drawLigatureConnector,
    ligatureConnectorHalfStroke,
    noteheadRightPoint,
    noteheadLeftPoint,
    drawAccidental,
    noteInkBounds,
} from './glyphs.js';
import { ss } from './units.js';
import { accidentalSymbolAdvance, accidentalAdvance } from './accidentals.js';
import { splitGroupsAtInternalMora, measureSplitLigature } from './measure.js';
import { wrapSrc } from './svg.js';

export function emitLigature(ctx, groups, x, staffBottomY, gaps = [], leadingCourtesyAccidentals = []) {
    const splitResult = splitGroupsAtInternalMora(groups, gaps);
    groups = splitResult.groups;
    gaps = splitResult.gaps;
    const parts = [];
    const halfSW = ligatureConnectorHalfStroke(ctx);
    let groupStartX = x;
    let courtesyAdvance = 0;
    let firstNoteCx = null;
    let lastNoteCx = null;
    let allNotesMinY = Infinity;
    let allNotesMaxY = -Infinity;

    for (const acc of leadingCourtesyAccidentals) {
        const accX = groupStartX + courtesyAdvance;
        const a = drawAccidental(ctx, acc.pitch, acc.symbol, accX, staffBottomY);
        parts.push(`<g class="aretino-accidental aretino-courtesy-accidental">${a.svg}</g>`);
        courtesyAdvance += accidentalAdvance(ctx, acc);
    }
    groupStartX += courtesyAdvance;

    for (let g = 0; g < groups.length; g++) {
        const notes = groups[g];
        const positions = [];
        let cx = groupStartX + ss(ctx, METRICS.noteBoxWidth) * 0.5;

        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            // Draw inline accidental before this note if present.
            if (note.accidental) {
                const accX = cx - ss(ctx, METRICS.noteBoxWidth) * 0.5;
                const a = drawAccidental(ctx, note.accidental.pitch, note.accidental.symbol, accX, staffBottomY);
                parts.push(wrapSrc(note.accidental, a.svg, 'aretino-accidental aretino-inline-accidental', staffBottomY, ctx.staffHeight, undefined, undefined, ctx.sourceMap));
                cx += accidentalSymbolAdvance(ctx, note.accidental.symbol);
            }
            const cy = pitchY(ctx, note, staffBottomY);
            positions.push({ note, cx, cy });
            if (firstNoteCx === null) {
                firstNoteCx = cx;
            }
            lastNoteCx = cx;
            if (i < notes.length - 1) {
                cx += ctx.ligatureStepAdvance;
            }
        }

        // Auto-virga per group: every local pitch peak gets a downward stem on the left.
        // Left side non-strict (>=), right side strict (>) so only the last note of a
        // plateau is marked (e.g. "ggf" → virga on the second g).
        const autoVirga = new Array(notes.length).fill(false);
        if (notes.length >= 2) {
            const pitchPositions = notes.map(n => pitchToPos(n));
            const hasVariation = Math.max(...pitchPositions) > Math.min(...pitchPositions);
            if (hasVariation) {
                for (let i = 0; i < notes.length; i++) {
                    const atLeastAsHighAsLeft = i === 0 || pitchPositions[i] >= pitchPositions[i - 1];
                    const higherThanRight = i === notes.length - 1 || pitchPositions[i] > pitchPositions[i + 1];
                    if (atLeastAsHighAsLeft && higherThanRight && !notes[i].noVirga) {
                        autoVirga[i] = true;
                    }
                }
            }
        }

        // Collect ligature connectors to draw on top of everything else.
        const connectorParts = [];
        for (let i = 1; i < positions.length; i++) {
            const prev = positions[i - 1];
            const cur = positions[i];
            if (cur.note.shape === 'virga' || cur.note.virga || autoVirga[i]) {
                continue;
            }
            // Skip connector into a note preceded by an inline accidental —
            // the accidental glyph occupies the space where the connector would be.
            if (cur.note.accidental) {
                continue;
            }
            const prevPos = pitchToPos(prev.note);
            const curPos = pitchToPos(cur.note);
            if (curPos === prevPos) {
                continue;
            }
            const prevScale = prev.note.modifiers && prev.note.modifiers.includes('small') ? METRICS.smallNoteScale : 1;
            const curScale = cur.note.modifiers && cur.note.modifiers.includes('small') ? METRICS.smallNoteScale : 1;
            const from = noteheadRightPoint(ctx, prev.cx, prev.cy, prevScale);
            const to = noteheadLeftPoint(ctx, cur.cx, cur.cy, curScale);
            const kind = curPos > prevPos ? 'up' : 'down';
            if (kind === 'up' && curPos - prevPos <= 0) {
                continue;
            }
            if (kind === 'up') {
                connectorParts.push(drawLigatureConnector(ctx, from.x - halfSW / 4, from.y + ss(ctx, 0.2), to.x + halfSW / 4, to.y - ss(ctx, 0.2), kind));
            } else {
                connectorParts.push(drawLigatureConnector(ctx, from.x - halfSW + ss(ctx, 0.03), from.y + ss(ctx, 0.1), to.x + halfSW - ss(ctx, 0.04), to.y - ss(ctx, 0.1), kind));
            }
            
        }

        // Detect runs of consecutive notes that all carry an episema.
        // For each run of 2+ notes, draw one spanning episema at the highest
        // note's vertical position so all segments touch.
        const halfEW = ss(ctx, METRICS.episemaWidth) / 2;
        const episemaInGroup = new Set(); // indices covered by a group episema
        {
            let runStart = null;
            const flushRun = (end) => {
                if (runStart === null) {
                    return;
                }
                if (end - runStart >= 2) {
                    const run = positions.slice(runStart, end);
                    const highest = run.reduce((best, p) => (p.cy < best.cy ? p : best), run[0]);
                    const onLine = pitchToPos(highest.note) % 2 === 0;
                    const x1 = run[0].cx - halfEW;
                    const x2 = run[run.length - 1].cx + halfEW;
                    parts.push(drawEpisemaSpan(ctx, x1, x2, highest.cy, onLine));
                    for (let j = runStart; j < end; j++) {
                        episemaInGroup.add(j);
                    }
                }
                runStart = null;
            };
            for (let i = 0; i <= positions.length; i++) {
                const hasEpisema = i < positions.length && positions[i].note.modifiers.includes('episema');
                if (hasEpisema) {
                    if (runStart === null) {
                        runStart = i;
                    }
                } else {
                    flushRun(i);
                }
            }
        }

        // When multiple notes in this group carry a mora and two of them land at
        // the same vertical position, shift the later one down by a half staff-space
        // so both dots remain visible.
        const moraDotYForNote = new Map();
        {
            const moraNoteCount = notes.filter(n => n.modifiers.includes('mora')).length;
            if (moraNoteCount >= 2) {
                const seenDotYs = new Set();
                for (let i = 0; i < positions.length; i++) {
                    const p = positions[i];
                    if (!p.note.modifiers.includes('mora')) continue;
                    const onLine = pitchToPos(p.note) % 2 === 0;
                    let dotY = onLine ? p.cy - ctx.staffSpace / 2 : p.cy;
                    if (seenDotYs.has(dotY)) {
                        dotY += ctx.staffSpace;
                    }
                    seenDotYs.add(dotY);
                    moraDotYForNote.set(i, dotY);
                }
            }
        }

        // Draw note heads + modifiers, wrapped per-note so each note can be
        // highlighted independently when the cursor sits on it.
        for (let i = 0; i < positions.length; i++) {
            const p = positions[i];
            const prevCy = i > 0 ? positions[i - 1].cy : null;
            const drawnNote = autoVirga[i] ? { ...p.note, virga: true } : p.note;
            const bounds = noteInkBounds(ctx, drawnNote, p.cy, staffBottomY, prevCy);
            if (bounds.minY < allNotesMinY) allNotesMinY = bounds.minY;
            if (bounds.maxY > allNotesMaxY) allNotesMaxY = bounds.maxY;
            const noteParts = [drawNoteHead(ctx, drawnNote, p.cx, p.cy, staffBottomY, prevCy)];
            const modifierSpans = p.note.modifierSpans ?? [];
            for (let mi = 0; mi < p.note.modifiers.length; mi++) {
                const mod = p.note.modifiers[mi];
                let glyph = null;
                if (mod === 'episema') {
                    if (!episemaInGroup.has(i)) {
                        const onLine = pitchToPos(p.note) % 2 === 0;
                        glyph = drawEpisema(ctx, p.cx, p.cy, onLine);
                    }
                } else if (mod === 'mora') {
                    const onLine = pitchToPos(p.note) % 2 === 0;
                    const moraNoteCount = notes.filter(n => n.modifiers.includes('mora')).length;
                    // Multi-mora: all dots share the same x position (after the last notehead),
                    // each at their own vertical pitch position.
                    const drawCx = moraNoteCount >= 2 ? positions[positions.length - 1].cx : p.cx;
                    let moraCy = p.cy;
                    if (moraDotYForNote.has(i)) {
                        const targetDotY = moraDotYForNote.get(i);
                        moraCy = onLine ? targetDotY + ctx.staffSpace / 2 : targetDotY;
                        const r = ss(ctx, METRICS.moraRadius);
                        if (targetDotY - r < allNotesMinY) allNotesMinY = targetDotY - r;
                        if (targetDotY + r > allNotesMaxY) allNotesMaxY = targetDotY + r;
                    }
                    glyph = drawMora(ctx, drawCx, moraCy, onLine);
                } else if (mod === 'ictus') {
                    const pos = pitchToPos(p.note);
                    const below = p.note.modifiers.includes('episema');
                    const onLine = pos % 2 === 0 && (below || pos < (METRICS.staffLineCount - 1) * 2);
                    glyph = drawIctus(ctx, p.cx, p.cy, onLine, below);
                } else if (mod === 'plica') {
                    glyph = drawPlica(ctx, p.cx, p.cy, 'down');
                }
                if (glyph === null) continue;
                noteParts.push(wrapSrc(modifierSpans[mi] ?? {}, glyph, `aretino-modifier aretino-mod-${mod}`, undefined, undefined, undefined, undefined, ctx.sourceMap));
            }
            parts.push(wrapSrc(p.note, noteParts.join(''), 'aretino-note', staffBottomY, ctx.staffHeight, p.cx - ss(ctx, METRICS.noteBoxWidth) * 0.5, ss(ctx, METRICS.noteBoxWidth), ctx.sourceMap));
        }

        // Draw connectors on top of noteheads.
        for (const c of connectorParts) parts.push(c);

        if (g < groups.length - 1) {
            const gapType = gaps[g] ?? 1;
            const slashCount = typeof gapType === 'number' ? gapType : 0;
            const lastNote = notes[notes.length - 1];
            const hasMora = lastNote.modifiers && lastNote.modifiers.includes('mora');
            const moraOverhang = hasMora
                ? ss(ctx, METRICS.moraOffsetX + METRICS.moraRadius)
                : 0;
            const accExtra = notes.reduce((sum, note) => sum + (note.accidental ? accidentalSymbolAdvance(ctx, note.accidental.symbol) : 0), 0);
            groupStartX += ss(ctx, METRICS.noteBoxWidth) + (notes.length - 1) * ctx.ligatureStepAdvance + slashCount * ctx.neumeGapAdvance + moraOverhang + accExtra;
        }
    }

    const advance = courtesyAdvance + measureSplitLigature(ctx, groups, gaps);
    const totalNotes = groups.reduce((sum, g) => sum + g.length, 0);
    const lastNote = groups[groups.length - 1]?.[groups[groups.length - 1].length - 1];
    const lastNoteHasMora = lastNote?.modifiers?.includes('mora');
    const allMoraNoteCount = groups.reduce((sum, g) => sum + g.filter(n => n.modifiers?.includes('mora')).length, 0);
    // A mora dot appears past the last notehead if the final note has one, or when
    // multiple notes in the neume carry moras (they all stack at the last notehead's x).
    const hasMora = lastNoteHasMora || allMoraNoteCount >= 2;
    const isTenor = groups.some(g => g.some(n => n.shape === 'tenor'));
    const shouldAlignLeft = totalNotes > 1 || isTenor;
    // centerX is the notehead center used for lyric alignment — mora and gap are excluded.
    const centerX = firstNoteCx !== null
        ? (firstNoteCx + lastNoteCx) / 2
        : x + advance / 2;
    const leftX = firstNoteCx !== null
        ? firstNoteCx - ss(ctx, METRICS.noteBoxWidth) * 0.5
        : x;
    // Visual right edge of the last notehead (extended for a trailing mora dot),
    // distinct from `advance` which also includes inter-neume spacing.
    const rightX = lastNoteCx !== null
        ? lastNoteCx + ss(ctx, hasMora ? METRICS.moraOffsetX + METRICS.moraRadius : METRICS.noteBoxWidth * 0.5)
        : x + advance;

    return { svg: parts.join(''), advance, centerX, leftX, rightX, shouldAlignLeft, minY: allNotesMinY, maxY: allNotesMaxY, firstNoteCx, lastNoteCx };
}
