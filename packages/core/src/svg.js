/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Wraps a rendered SVG fragment in a <g> carrying the token's source span (and
// optional staff/bbox geometry) so a cursor-tracking script can map screen
// positions back to source offsets. Returns the fragment unchanged when the
// item has no source span.
export function wrapSrc(item, svg, cls, staffBottomY, staffHeight, bboxX, bboxWidth) {
    if (item.srcStart === undefined || item.srcEnd === undefined) {
        return svg;
    }
    const staffAttrs = (staffBottomY !== undefined)
        ? ` data-staff-bottom="${staffBottomY}" data-staff-height="${staffHeight}"`
        : '';
    const bboxAttrs = (bboxX !== undefined && bboxWidth !== undefined)
        ? ` data-bbox-x="${bboxX}" data-bbox-width="${bboxWidth}"`
        : '';
    return `<g class="${cls}" data-src-start="${item.srcStart}" data-src-end="${item.srcEnd}"${staffAttrs}${bboxAttrs}>${svg}</g>`;
}
