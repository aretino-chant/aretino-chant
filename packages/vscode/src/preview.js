/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

'use strict';

const vscode = require('vscode');

const VIEW_TYPE = 'aretino.preview';

// Manages one preview webview per source document. Re-revealing the command for
// a document that already has a preview focuses the existing panel instead of
// spawning a second one.
class AretinoPreviewManager {
    constructor(context) {
        this._context = context;
        /** @type {Map<string, vscode.WebviewPanel>} keyed by document URI */
        this._panels = new Map();
        this._disposables = [];

        // Push document edits to the matching preview.
        this._disposables.push(
            vscode.workspace.onDidChangeTextDocument((e) => {
                const panel = this._panels.get(e.document.uri.toString());
                if (panel) {
                    this._postUpdate(panel, e.document);
                }
            }),
        );

        // Move the preview's caret highlight when the editor's caret moves.
        this._disposables.push(
            vscode.window.onDidChangeTextEditorSelection((e) => {
                const panel = this._panels.get(e.textEditor.document.uri.toString());
                if (panel) {
                    this._postSelection(panel, e.textEditor);
                }
            }),
        );
    }

    maybeAutoOpen(editor) {
        if (!editor || editor.document.languageId !== 'aretino') {
            return;
        }
        const autoOpen = vscode.workspace
            .getConfiguration('aretino')
            .get('preview.autoOpen', true);
        if (!autoOpen) {
            return;
        }
        if (this._panels.has(editor.document.uri.toString())) {
            return; // already showing
        }
        this.showPreview(editor.document, vscode.ViewColumn.Beside, /* preserveFocus */ true);
    }

    showPreview(document, column, preserveFocus = false) {
        const key = document.uri.toString();
        const existing = this._panels.get(key);
        if (existing) {
            existing.reveal(existing.viewColumn, preserveFocus);
            return existing;
        }

        const panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            `Preview ${pathBasename(document.uri)}`,
            { viewColumn: column ?? vscode.ViewColumn.Beside, preserveFocus },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this._context.extensionUri, 'dist'),
                    vscode.Uri.joinPath(this._context.extensionUri, 'media'),
                ],
            },
        );

        panel.webview.html = this._buildHtml(panel.webview);

        // The webview asks for content once it has loaded its fonts; reply with
        // the current document text.
        const messageSub = panel.webview.onDidReceiveMessage((msg) => {
            if (msg && msg.type === 'ready') {
                this._postUpdate(panel, document);
            } else if (msg && msg.type === 'reveal' && Number.isFinite(msg.offset)) {
                revealOffset(document, msg.offset);
            }
        });

        panel.onDidDispose(() => {
            this._panels.delete(key);
            messageSub.dispose();
        });

        this._panels.set(key, panel);
        return panel;
    }

    _postUpdate(panel, document) {
        // Re-rendering wipes the previous highlight, so send the current caret
        // alongside the text and let the webview repaint it after rendering.
        panel.webview.postMessage({
            type: 'update',
            text: document.getText(),
            selection: this._selectionFor(document),
        });
    }

    _postSelection(panel, editor) {
        panel.webview.postMessage({
            type: 'selection',
            selection: selectionOffsets(editor, editor.document),
        });
    }

    // Caret/selection of a visible editor for `document`, as source offsets, or
    // null when no editor is currently showing it.
    _selectionFor(document) {
        const editor = vscode.window.visibleTextEditors.find((ed) => ed.document === document);
        return editor ? selectionOffsets(editor, document) : null;
    }

    _buildHtml(webview) {
        const nonce = makeNonce();
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'webview.js'),
        );
        const cssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'media', 'preview.css'),
        );
        const fontUpright = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'media', 'fonts', 'EBGaramond-Variable.ttf'),
        );
        const fontItalic = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'media', 'fonts', 'EBGaramond-Italic-Variable.ttf'),
        );

        const defaultZoom = vscode.workspace
            .getConfiguration('aretino')
            .get('preview.defaultZoom', 1.4);

        const csp = [
            `default-src 'none'`,
            `img-src ${webview.cspSource} data:`,
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `font-src ${webview.cspSource}`,
            `script-src 'nonce-${nonce}'`,
        ].join('; ');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${cssUri}" />
<style nonce="${nonce}">
@font-face {
  font-family: 'EB Garamond';
  src: url('${fontUpright}') format('truetype-variations');
  font-weight: 400 800;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: 'EB Garamond';
  src: url('${fontItalic}') format('truetype-variations');
  font-weight: 400 800;
  font-style: italic;
  font-display: block;
}
</style>
<title>Aretino Preview</title>
</head>
<body>
<div id="toolbar">
  <button id="zoom-out" title="Zoom out">&minus;</button>
  <span id="zoom-value">${Math.round(defaultZoom * 100)}%</span>
  <button id="zoom-in" title="Zoom in">+</button>
  <button id="zoom-reset" title="Reset zoom">Reset</button>
</div>
<div id="error" hidden></div>
<div id="scroll"><div id="page"><div id="content"></div></div></div>
<script nonce="${nonce}">window.__ARETINO__ = { defaultZoom: ${JSON.stringify(defaultZoom)} };</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    dispose() {
        for (const panel of this._panels.values()) {
            panel.dispose();
        }
        this._panels.clear();
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
    }
}

// Move the editor's caret to a source offset (from a preview click), focus the
// text editor, and scroll the caret into view. Reuses an already-visible editor
// for the document and its column when there is one; otherwise opens it.
function revealOffset(document, offset) {
    const position = document.positionAt(offset);
    const selection = new vscode.Selection(position, position);
    const existing = vscode.window.visibleTextEditors.find((ed) => ed.document === document);
    vscode.window
        .showTextDocument(document, {
            viewColumn: existing ? existing.viewColumn : vscode.ViewColumn.One,
            preserveFocus: false,
        })
        .then((editor) => {
            editor.selection = selection;
            editor.revealRange(selection, vscode.TextEditorRevealType.Default);
        });
}

// Primary selection as absolute source character offsets { from, to }. The core
// renderer's data-src-* attributes are offsets into document.getText(), which is
// exactly what offsetAt() returns, so the two line up without conversion.
function selectionOffsets(editor, document) {
    const sel = editor.selection;
    return {
        from: document.offsetAt(sel.start),
        to: document.offsetAt(sel.end),
    };
}

function pathBasename(uri) {
    const p = uri.path;
    const i = p.lastIndexOf('/');
    return i >= 0 ? p.slice(i + 1) : p;
}

function makeNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 32; i++) {
        s += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return s;
}

module.exports = { AretinoPreviewManager };
