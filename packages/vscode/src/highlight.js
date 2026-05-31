/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

'use strict';

const vscode = require('vscode');
const { tokenizeDocument, scanBigJumps, SEMANTIC_TOKEN_TYPES } = require('./syntax');

const LANGUAGE = 'aretino';

const legend = new vscode.SemanticTokensLegend(SEMANTIC_TOKEN_TYPES, []);

// Theme-adaptive colouring: the parser produces custom semantic token types,
// and package.json maps each to a standard TextMate scope so the active theme
// supplies readable colours in both light and dark themes.
const semanticTokensProvider = {
    provideDocumentSemanticTokens(document) {
        const builder = new vscode.SemanticTokensBuilder(legend);
        for (const t of tokenizeDocument(document.getText())) {
            builder.push(t.line, t.start, t.length, SEMANTIC_TOKEN_TYPES.indexOf(t.type), 0);
        }
        return builder.build();
    },
};

// Wide melodic leaps (interval > a fifth) get a faint warm wash, mirroring the
// editor's big-jump decoration. A translucent background keeps the theme's text
// colour readable on both light and dark backgrounds.
const bigJumpDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(245, 158, 11, 0.30)',
    borderRadius: '2px',
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

function updateBigJumpDecorations(editor) {
    if (!editor || editor.document.languageId !== LANGUAGE) return;
    const ranges = scanBigJumps(editor.document.getText()).map(
        (r) => new vscode.Range(r.line, r.start, r.line, r.end),
    );
    editor.setDecorations(bigJumpDecoration, ranges);
}

// Registers semantic-token highlighting and the big-jump decoration for
// .aretino documents. Returns disposables for the extension to own.
function registerHighlighting(context) {
    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider(
            { language: LANGUAGE },
            semanticTokensProvider,
            legend,
        ),
        bigJumpDecoration,
        vscode.window.onDidChangeActiveTextEditor((editor) => updateBigJumpDecorations(editor)),
        vscode.workspace.onDidChangeTextDocument((e) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === e.document) updateBigJumpDecorations(editor);
        }),
    );

    // Paint any editors already open at activation.
    for (const editor of vscode.window.visibleTextEditors) updateBigJumpDecorations(editor);
}

module.exports = { registerHighlighting };
