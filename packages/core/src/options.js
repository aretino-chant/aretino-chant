/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Single source of truth for %option: header directives. `detail` is the
// human-readable description and `default` the factory value, both shown by
// editor autocomplete (packages/editor/src/autocomplete.js) and the VS Code
// extension (packages/vscode/src/completion.js) — both derive their
// suggestion list from this registry, so adding an option here is enough to
// make it appear in autocomplete everywhere. `default` mirrors the fallback
// actually applied in renderer.js / glyphs.js (METRICS) / verse.js — keep
// them in sync when a default there changes. 'auto' marks an option with no
// fixed literal default (it's derived from other options at render time).
export const RENDERER_OPTIONS = [
    { name: 'width',          type: 'number',  detail: 'output width in pixels', default: 'auto' },
    { name: 'widthMm',        type: 'number',  detail: 'output width in mm', default: 180 },
    { name: 'dpi',            type: 'number',  detail: 'dots per inch', default: 96 },
    { name: 'zoom',           type: 'number',  detail: 'zoom factor', default: 1 },
    { name: 'staffSpaceMm',   type: 'number',  detail: 'staff space in mm', default: 1.75 },
    { name: 'lyricSize',      type: 'number',  detail: 'lyric font size', default: 10 },
    { name: 'textFont',       type: 'string',  detail: 'rendered text font family', default: 'Palatino Linotype' },
    { name: 'noteSpacing',    type: 'number',  detail: 'spacing between notes', default: 1 },
    { name: 'gapOutlierThreshold', type: 'number', detail: 'gap ratio flagged as an outlier when justifying', default: 2 },
    { name: 'avoidLoneSyllables', type: 'boolean', detail: 'avoid leaving a single syllable at a line break', default: true },
    { name: 'gapOutlierThresholdMin', type: 'number', detail: 'minimum gap ratio considered for outlier detection', default: 1 },
    { name: 'wrapCondenseMin', type: 'number', detail: 'minimum condense ratio allowed when wrapping', default: 0.75 },
    { name: 'wrapStretchMax', type: 'number',  detail: 'maximum stretch ratio allowed when wrapping', default: 2 },
    { name: 'recitationLoneWordMin', type: 'number', detail: 'minimum word count before recitation may end on a lone word', default: 2.25 },
    { name: 'staffGap',       type: 'number',  detail: 'gap between staves', default: 2.5 },
    { name: 'lyricDistance',  type: 'number',  detail: 'distance from lowest note to lyrics', default: 0.5 },
    { name: 'lyricMinStaffDistance', type: 'number', detail: 'minimum distance from bottom staff line to lyrics', default: 0.75 },
    { name: 'lyricLineSkip',  type: 'number',  detail: 'line spacing between stacked lyric lines', default: 1.2 },
    { name: 'lyricHyphenMinLen', type: 'number', detail: 'minimum syllable length before a hyphen may be inserted', default: 0.17 },
    { name: 'lyricHyphenMaxLen', type: 'number', detail: 'maximum gap length that still gets a hyphen', default: 0.33 },
    { name: 'lyricHyphenWidth', type: 'number', detail: 'width of an inserted hyphen', default: 0.04 },
    { name: 'lyricHyphenSpace', type: 'number', detail: 'spacing around an inserted hyphen', default: 0.05 },
    { name: 'lyricHyphenPos', type: 'number',  detail: 'vertical position of an inserted hyphen', default: 0.55 },
    { name: 'lyricHyphenRepeat', type: 'number', detail: 'minimum spacing between repeated hyphens', default: 4 },
    { name: 'virgaStemLength', type: 'number', detail: 'virga stem descent (staff-spaces)', default: 2.75 },
    { name: 'virgaStemDescentBelowPrev', type: 'number', detail: 'virga stem descent past a lower preceding note', default: 2.25 },
    { name: 'virgaMaxBelowBottom', type: 'number', detail: 'max virga stem descent below bottom staff line', default: 1.75 },
    { name: 'hideRepeatClef', type: 'boolean', detail: 'hide repeated clef at line start', default: false },
    { name: 'justifyWithoutLyrics', type: 'boolean', detail: 'justify neume gaps even without lyrics', default: false },
    { name: 'canvasHeight',   type: 'number',  detail: 'canvas height', default: 'auto' },
    { name: 'sourceMap',      type: 'boolean', detail: 'emit source position data for editor sync', default: true },
    { name: 'textStyle',      type: 'string',  detail: 'named text style preset', default: 'psalm' },
    { name: 'textMaxIndent',  type: 'number',  detail: 'maximum indent for the first music line', default: 8 },
    { name: 'textMarkerAlign', type: 'string', detail: 'alignment of rubric/caption markers', default: 'left' },
];

const HEADER_RENDERER_OPTION_TYPES = Object.fromEntries(
    RENDERER_OPTIONS.map(({ name, type }) => [name, type])
);

function parseBooleanOption(valueText) {
    const value = valueText.trim().toLowerCase();
    if (value === 'true' || value === '1' || value === 'yes' || value === 'on') {
        return true;
    }
    if (value === 'false' || value === '0' || value === 'no' || value === 'off') {
        return false;
    }
    return null;
}

function parseHeaderRendererOption(raw) {
    const text = String(raw ?? '').trim();
    const flag = text.match(/^([A-Za-z][A-Za-z0-9_]*)$/);
    if (flag && HEADER_RENDERER_OPTION_TYPES[flag[1]] === 'boolean') {
        return [flag[1], true];
    }

    const m = text.match(/^([A-Za-z][A-Za-z0-9_]*)\s*(?:=|:)\s*(.*)$/);
    if (!m) {
        return null;
    }

    const name = m[1];
    const valueText = m[2].trim();
    const type = HEADER_RENDERER_OPTION_TYPES[name];
    if (!type) {
        return null;
    }

    if (type === 'number') {
        if (valueText === '') {
            return null;
        }
        const value = Number(valueText);
        return Number.isFinite(value) ? [name, value] : null;
    }

    if (type === 'boolean') {
        const value = parseBooleanOption(valueText);
        return value === null ? null : [name, value];
    }

    return [name, valueText];
}

export function parseHeaderRendererOptions(ast) {
    const values = [];
    if (Array.isArray(ast?.optionHeaders)) {
        values.push(...ast.optionHeaders);
    }
    if (values.length === 0) {
        const headerOption = ast?.header?.option;
        if (Array.isArray(headerOption)) {
            values.push(...headerOption);
        } else if (typeof headerOption === 'string') {
            values.push(headerOption);
        }
    }

    const parsed = {};
    for (const raw of values) {
        const option = parseHeaderRendererOption(raw);
        if (option) {
            parsed[option[0]] = option[1];
        }
    }
    return parsed;
}
