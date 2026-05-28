import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    compactResolvedFontPaths,
    fontconfigPatternFromCssFontFamily,
    resolveSystemFontForFontkit,
} from '../src/system-fonts.js';

describe('fontconfigPatternFromCssFontFamily', () => {
    it('keeps an unquoted family name', () => {
        assert.equal(fontconfigPatternFromCssFontFamily('EB Garamond'), 'EB Garamond');
    });

    it('normalizes a quoted CSS font stack for fontconfig', () => {
        assert.equal(
            fontconfigPatternFromCssFontFamily('"EB Garamond", serif'),
            'EB Garamond,serif'
        );
    });

    it('handles single quotes and whitespace', () => {
        assert.equal(
            fontconfigPatternFromCssFontFamily(" 'Times New Roman' , 'Noto Serif' "),
            'Times New Roman,Noto Serif'
        );
    });
});

describe('compactResolvedFontPaths', () => {
    it('uses a single file input when every style resolves to the same file', () => {
        assert.equal(compactResolvedFontPaths({
            regular: '/fonts/Family.ttf',
            italic: '/fonts/Family.ttf',
            bold: '/fonts/Family.ttf',
            boldItalic: '/fonts/Family.ttf',
        }), '/fonts/Family.ttf');
    });

    it('omits style paths that duplicate their variable base font', () => {
        assert.deepEqual(compactResolvedFontPaths({
            regular: '/fonts/Family-Regular.ttf',
            italic: '/fonts/Family-Italic.ttf',
            bold: '/fonts/Family-Regular.ttf',
            boldItalic: '/fonts/Family-Italic.ttf',
        }), {
            regular: '/fonts/Family-Regular.ttf',
            italic: '/fonts/Family-Italic.ttf',
        });
    });

    it('keeps distinct static style files', () => {
        assert.deepEqual(compactResolvedFontPaths({
            regular: '/fonts/Family-Regular.ttf',
            italic: '/fonts/Family-Italic.ttf',
            bold: '/fonts/Family-Bold.ttf',
            boldItalic: '/fonts/Family-BoldItalic.ttf',
        }), {
            regular: '/fonts/Family-Regular.ttf',
            italic: '/fonts/Family-Italic.ttf',
            bold: '/fonts/Family-Bold.ttf',
            boldItalic: '/fonts/Family-BoldItalic.ttf',
        });
    });
});

describe('resolveSystemFontForFontkit', () => {
    it('does not attempt fontconfig resolution on non-Linux platforms', async () => {
        assert.equal(await resolveSystemFontForFontkit('EB Garamond', 'darwin'), null);
        assert.equal(await resolveSystemFontForFontkit('EB Garamond', 'win32'), null);
    });
});
