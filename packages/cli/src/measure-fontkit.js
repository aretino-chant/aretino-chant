/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Returns a synchronous measureTextWidth-compatible function backed by fontkit.
// The font file is loaded once asynchronously; the returned closure is sync.
export async function createFontkitMeasureFn(fontPath) {
    let fontkit;
    try {
        fontkit = (await import('fontkit')).default;
    } catch {
        throw new Error(
            'fontkit is not installed. Run: npm install fontkit'
        );
    }
    const font = await fontkit.open(fontPath);
    return function measureWithFontkit(text, fontSize, _fontFamily, _bold, _italic) {
        if (!text) return 0;
        const run = font.layout(text);
        return run.advanceWidth * fontSize / font.unitsPerEm;
    };
}
