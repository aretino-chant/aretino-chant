/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Where the 'bravura' preset in notehead-presets.js comes from: fit an ellipse
// to Bravura's noteheadBlack outline, then find the tilt that, inside our own
// box model (radii solved from the glyph's 1.18 × 1.0 box), sits closest to
// that outline. Run with `node dev/fit-smufl-head.mjs`.
//
// Two numbers are worth reading off it: the free conic fit says how much of an
// ellipse the glyph is at all, and the deviation table says how much our head
// gives up by being forced into the glyph's bounding box.

import { SMUFL_GLYPHS, UNITS_PER_STAFF_SPACE } from './smufl-glyphs.js';
import { ellipseRadiiForBox } from '../src/glyphs.js';

// Flatten a path of M/L/C/Z into points; the outlines here have no arcs.
function samplePath(d, perCurve = 120) {
    const toks = d.match(/[MLCZ]|-?\d*\.?\d+/gi) || [];
    const pts = [];
    let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = null;
    const num = () => parseFloat(toks[i++]);
    while (i < toks.length) {
        if (/[MLCZ]/i.test(toks[i])) { cmd = toks[i].toUpperCase(); i++; }
        if (cmd === 'M') { cx = num(); cy = num(); sx = cx; sy = cy; pts.push([cx, cy]); }
        else if (cmd === 'L') { cx = num(); cy = num(); pts.push([cx, cy]); }
        else if (cmd === 'C') {
            const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
            for (let k = 1; k <= perCurve; k++) {
                const s = k / perCurve, m = 1 - s;
                pts.push([
                    m * m * m * cx + 3 * m * m * s * x1 + 3 * m * s * s * x2 + s * s * s * x,
                    m * m * m * cy + 3 * m * m * s * y1 + 3 * m * s * s * y2 + s * s * s * y,
                ]);
            }
            cx = x; cy = y;
        } else if (cmd === 'Z') { cx = sx; cy = sy; cmd = null; }
        else i++;
    }
    return pts;
}

// Gauss-Jordan, enough for the 5×5 normal equations below.
function solve(M, v) {
    const n = v.length;
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
        [M[c], M[p]] = [M[p], M[c]];
        [v[c], v[p]] = [v[p], v[c]];
        for (let r = 0; r < n; r++) {
            if (r === c) continue;
            const f = M[r][c] / M[c][c];
            for (let k = c; k < n; k++) M[r][k] -= f * M[c][k];
            v[r] -= f * v[c];
        }
    }
    return v.map((x, r) => x / M[r][r]);
}

// Least-squares conic Ax² + Bxy + Cy² + Dx + Ey = 1 through centred points.
function fitConic(P) {
    const M = Array.from({ length: 5 }, () => Array(5).fill(0));
    const v = Array(5).fill(0);
    for (const [x, y] of P) {
        const b = [x * x, x * y, y * y, x, y];
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) M[r][c] += b[r] * b[c];
            v[r] += b[r];
        }
    }
    const [A, B, C, D, E] = solve(M, v);
    const F = -1;
    const den = B * B - 4 * A * C;
    const t1 = 2 * (A * E * E + C * D * D - B * D * E + den * F);
    const t2 = Math.hypot(A - C, B);
    return {
        rx: -Math.sqrt(t1 * (A + C + t2)) / den,
        ry: -Math.sqrt(t1 * (A + C - t2)) / den,
        // In SVG's y-down frame this is the angle rotate() wants.
        deg: 0.5 * Math.atan2(-B, C - A) * 180 / Math.PI,
    };
}

// How far the outline strays from the ellipse our model draws for a box+tilt,
// measured radially in staff spaces.
function deviation(P, w, h, deg) {
    const { rx, ry } = ellipseRadiiForBox(w, h, deg);
    if (!Number.isFinite(rx) || !Number.isFinite(ry)) return null;
    const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
    let max = 0, sum = 0;
    for (const [x, y] of P) {
        const u = x * c + y * s, v = -x * s + y * c;
        const r = Math.hypot(u / rx, v / ry);
        const err = Math.abs(r - 1) * Math.hypot(u, v) / Math.max(r, 1e-9);
        max = Math.max(max, err);
        sum += err;
    }
    return { rx, ry, max, mean: sum / P.length };
}

const glyph = SMUFL_GLYPHS.find((g) => g.name === 'noteheadBlack');
const pts = samplePath(glyph.d);
const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
const P = pts.map(([x, y]) => [(x - cx) / UNITS_PER_STAFF_SPACE, (y - cy) / UNITS_PER_STAFF_SPACE]);

const boxW = glyph.bbox.x1 - glyph.bbox.x0;
const boxH = glyph.bbox.y1 - glyph.bbox.y0;
const free = fitConic(P);

console.log(`glyph box        ${boxW.toFixed(4)} × ${boxH.toFixed(4)} SS`);
console.log(`free conic fit   rx ${free.rx.toFixed(5)}  ry ${free.ry.toFixed(5)}  tilt ${free.deg.toFixed(2)}°`);
console.log(`\ntilt      rx       ry       mean dev   max dev   (box fixed at the glyph's)`);
for (let deg = -34; deg <= -28; deg += 0.1) {
    const d = deviation(P, boxW, boxH, deg);
    if (d) {
        console.log(`${deg.toFixed(1).padStart(6)}  ${d.rx.toFixed(5)}  ${d.ry.toFixed(5)}  ${d.mean.toFixed(5)}    ${d.max.toFixed(5)}`);
    }
}
