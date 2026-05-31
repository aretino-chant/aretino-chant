/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

'use strict';

const vscode = require('vscode');
const { AretinoPreviewManager } = require('./preview');

function activate(context) {
    const manager = new AretinoPreviewManager(context);
    context.subscriptions.push(manager);

    context.subscriptions.push(
        vscode.commands.registerCommand('aretino.showPreviewToSide', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                manager.showPreview(editor.document, vscode.ViewColumn.Beside);
            }
        }),
        vscode.commands.registerCommand('aretino.showPreview', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                manager.showPreview(editor.document, editor.viewColumn);
            }
        }),
    );

    // Honour "open .aretino → show preview". Fires for the editor active now and
    // for every editor that becomes active later.
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => manager.maybeAutoOpen(editor)),
    );
    manager.maybeAutoOpen(vscode.window.activeTextEditor);
}

function deactivate() {}

module.exports = { activate, deactivate };
