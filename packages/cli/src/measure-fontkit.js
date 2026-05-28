/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Returns a synchronous measureTextWidth-compatible function backed by fontkit.
// fontInput can be:
//   - a string path to a single font (variable with wght/ital axes, or static)
//   - an object { regular, bold?, italic?, boldItalic? } where each value is a
//     path; regular and italic may themselves be variable fonts (wght axis)
export async function createFontkitMeasureFn(fontInput) {
    let open;
    try {
        ({ open } = await import('fontkit'));
    } catch {
        throw new Error(
            'fontkit is not installed. Run: npm install fontkit'
        );
    }

    const fonts = await loadFonts(open, fontInput);

    return function measureWithFontkit(text, fontSize, _fontFamily, bold, italic) {
        if (!text) return 0;
        const font = selectFont(fonts, bold, italic);
        const run = font.layout(text);
        return run.advanceWidth * fontSize / font.unitsPerEm;
    };
}

async function loadFonts(open, fontInput) {
    if (typeof fontInput === 'string') {
        const font = await open(fontInput);
        const axes = font.variationAxes ?? {};
        const hasWght = 'wght' in axes;
        const hasItal = 'ital' in axes;
        if (!hasWght && !hasItal) {
            return { regular: font, bold: font, italic: font, boldItalic: font };
        }
        const vary = (wght, ital) => font.getVariation({
            ...(hasWght && { wght }),
            ...(hasItal && { ital }),
        });
        return {
            regular:    vary(400, 0),
            bold:       vary(700, 0),
            italic:     vary(400, 1),
            boldItalic: vary(700, 1),
        };
    }

    const { regular, bold: boldPath, italic: italicPath, boldItalic: boldItalicPath } = fontInput;
    const [uprightFont, italicFont, explicitBoldFont, explicitBoldItalicFont] = await Promise.all([
        regular        ? open(regular)        : null,
        italicPath     ? open(italicPath)     : null,
        boldPath       ? open(boldPath)       : null,
        boldItalicPath ? open(boldItalicPath) : null,
    ]);

    const { normal: regularFont, bold: boldFont } = resolveWeights(uprightFont, explicitBoldFont);
    const { normal: italicFont2, bold: boldItalicFont } = resolveWeights(italicFont ?? uprightFont, explicitBoldItalicFont);

    return {
        regular:    regularFont,
        bold:       boldFont,
        italic:     italicFont2,
        boldItalic: boldItalicFont,
    };
}

// Resolves a (possibly variable) font into normal-weight and bold-weight instances.
// explicitBold overrides the derived bold variant when provided.
function resolveWeights(font, explicitBold = null) {
    const axes = font.variationAxes ?? {};
    const hasWght = 'wght' in axes;
    return {
        normal: hasWght ? font.getVariation({ wght: 400 }) : font,
        bold:   explicitBold ?? (hasWght ? font.getVariation({ wght: 700 }) : font),
    };
}

function selectFont({ regular, bold, italic, boldItalic }, isBold, isItalic) {
    if (isBold && isItalic) return boldItalic;
    if (isBold) return bold;
    if (isItalic) return italic;
    return regular;
}
