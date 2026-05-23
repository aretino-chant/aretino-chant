/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { renderAretino } from '@aretino-chant/core';

const STYLE = `
:host {
  display: flex;
  flex-direction: row;
  box-sizing: border-box;
  height: 300px;
  overflow: hidden;
  font-family: monospace;
  gap: 8px;
}

.pane {
  flex: 1;
  min-width: 0;
  overflow: auto;
  box-sizing: border-box;
}

.editor-pane .cm-editor {
  height: 100%;
}

.editor-pane .cm-scroller {
  overflow: auto;
}

.error {
  color: red;
  font-size: 0.85em;
  padding: 4px;
  white-space: pre-wrap;
}
`;

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

class AretinoEditor extends HTMLElement {
    static get observedAttributes() {
        return ['value', 'zoom'];
    }

    constructor() {
        super();
        this._shadow = this.attachShadow({ mode: 'open' });
        this._view = null;
        this._previewEl = null;
        this._resizeObserver = null;
    }

    connectedCallback() {
        const style = document.createElement('style');
        style.textContent = STYLE;

        const editorPane = document.createElement('div');
        editorPane.className = 'pane editor-pane';
        editorPane.setAttribute('part', 'editor');

        this._previewEl = document.createElement('div');
        this._previewEl.className = 'pane preview-pane';
        this._previewEl.setAttribute('part', 'preview');

        this._shadow.append(style, editorPane, this._previewEl);

        this._view = new EditorView({
            state: EditorState.create({
                doc: this.getAttribute('value') ?? '',
                extensions: [
                    basicSetup,
                    EditorView.updateListener.of(update => {
                        if (update.docChanged) this._handleChange();
                    }),
                ],
            }),
            parent: editorPane,
        });

        this._resizeObserver = new ResizeObserver(() => this._renderPreview());
        this._resizeObserver.observe(this._previewEl);

        this._renderPreview();
    }

    disconnectedCallback() {
        this._view?.destroy();
        this._view = null;
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
    }

    attributeChangedCallback(name, _old, value) {
        if (name === 'value' && this._view) {
            const current = this._view.state.doc.toString();
            if (current !== value) this.value = value ?? '';
        }
        if (name === 'zoom') {
            this._renderPreview();
        }
    }

    get value() {
        return this._view?.state.doc.toString() ?? '';
    }

    set value(v) {
        if (!this._view) return;
        this._view.dispatch({
            changes: { from: 0, to: this._view.state.doc.length, insert: String(v) },
        });
    }

    get zoom() {
        return parseFloat(this.getAttribute('zoom') ?? '1');
    }

    set zoom(v) {
        this.setAttribute('zoom', String(v));
    }

    _handleChange() {
        this._renderPreview();
        this.dispatchEvent(new CustomEvent('change', {
            bubbles: true,
            composed: true,
            detail: { value: this.value },
        }));
    }

    _renderPreview() {
        if (!this._previewEl || !this._view) return;
        const source = this.value;
        const zoom = this.zoom;
        const containerWidth = this._previewEl.clientWidth || 600;
        const width = Math.max(120, Math.round(containerWidth / zoom));
        try {
            this._previewEl.innerHTML = renderAretino(source, { width, zoom });
        } catch (err) {
            this._previewEl.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
        }
    }
}

customElements.define('aretino-editor', AretinoEditor);
export { AretinoEditor };
