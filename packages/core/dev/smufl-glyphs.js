/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// SMuFL reference outlines, traced out of Bravura 1.x (Steinberg Media
// Technologies GmbH, SIL Open Font License 1.1) with fontkit. Dev-only: this
// file is not part of the published package, it exists so the notehead
// playground can lay a standard glyph over our own head and see where ours
// differs. Only the two round heads are here — the black one is the shape a
// chant punctum is closest to, the whole one shows the same pen at its widest.
//
// `d` is in font units with y already flipped to SVG's y-down, so the outline
// is in staff spaces once scaled by 1/UNITS_PER_STAFF_SPACE. `bbox` and
// `advance` are in staff spaces already. The glyph's origin is its left edge,
// on the staff position it sits on.
export const UNITS_PER_STAFF_SPACE = 250;

export const SMUFL_GLYPHS = [
    {"name": "noteheadBlack", "label": "Notehead black (U+E0A4)", "cp": "U+E0A4", "d": "M97 125C186 125 295 43 295 -42C295 -93 255 -125 198 -125C88 -125 0 -44 0 42C0 94 43 125 97 125Z", "bbox": {"x0": 0, "y0": -0.5, "x1": 1.18, "y1": 0.5}, "advance": 1.18},
    {"name": "noteheadWhole", "label": "Notehead whole (U+E0A2)", "cp": "U+E0A2", "d": "M216 -125C83 -125 0 -70 0 -2C0 65 57 125 206 125C370 125 422 68 422 -2C422 -73 309 -125 216 -125ZM111 -63C122 -98 159 -103 190 -103C259 -103 314 -29 314 31C314 62 301 90 268 98C258 101 247 102 237 102C201 102 164 78 143 50C123 27 108 -7 108 -39C108 -47 109 -55 111 -63Z", "bbox": {"x0": 0, "y0": -0.5, "x1": 1.688, "y1": 0.5}, "advance": 1.688}
];
