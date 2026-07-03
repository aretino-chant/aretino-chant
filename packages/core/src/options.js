/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const HEADER_RENDERER_OPTION_TYPES = {
    width: 'number',
    widthMm: 'number',
    dpi: 'number',
    zoom: 'number',
    staffSpaceMm: 'number',
    lyricSize: 'number',
    textFont: 'string',
    noteSpacing: 'number',
    gapOutlierThreshold: 'number',
    staffGap: 'number',
    lyricDistance: 'number',
    hideRepeatClef: 'boolean',
    canvasHeight: 'number',
    sourceMap: 'boolean',
};

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
