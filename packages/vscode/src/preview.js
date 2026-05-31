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
        panel.webview.postMessage({ type: 'update', text: document.getText() });
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
