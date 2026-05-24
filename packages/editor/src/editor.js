/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { renderAretino } from '@aretino-chant/core';
import { aretino } from './highlight.js';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,600;1,400&display=swap';

const STYLE = `
:host {
  display: flex;
  flex-direction: row;
  box-sizing: border-box;
  height: 300px;
  overflow: hidden;
  font-family: 'Inter', system-ui, sans-serif;
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
  font-family: 'Inter', system-ui, sans-serif;
}

.editor-pane .cm-scroller {
  overflow: auto;
}

.editor-pane .cm-content,
.editor-pane .cm-line {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 0.95rem;
  line-height: 1.6;
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
        return ['value', 'zoom', 'preview'];
    }

    constructor() {
        super();
        this._shadow = this.attachShadow({ mode: 'open' });
        this._view = null;
        this._editorPane = null;
        this._previewEl = null;
        this._resizeObserver = null;
    }

    connectedCallback() {
        if (!document.querySelector(`link[href="${FONT_HREF}"]`)) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = FONT_HREF;
            document.head.appendChild(link);
        }

        const style = document.createElement('style');
        style.textContent = STYLE;

        const editorPane = document.createElement('div');
        editorPane.className = 'pane editor-pane';
        editorPane.setAttribute('part', 'editor');
        this._editorPane = editorPane;

        this._shadow.append(style, editorPane);
        this._syncPreviewPane();

        this._view = new EditorView({
            state: EditorState.create({
                doc: this.getAttribute('value') ?? '',
                extensions: [
                    basicSetup,
                    aretino(),
                    EditorView.updateListener.of(update => {
                        if (update.docChanged) this._handleChange();
                        else if (update.selectionSet) this._highlightAtCaret();
                    }),
                ],
            }),
            parent: editorPane,
        });

        this._renderPreview();
    }

    disconnectedCallback() {
        this._view?.destroy();
        this._view = null;
        this._editorPane = null;
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
        this._previewEl = null;
    }

    attributeChangedCallback(name, _old, value) {
        if (name === 'value' && this._view) {
            const current = this._view.state.doc.toString();
            if (current !== value) this.value = value ?? '';
        }
        if (name === 'zoom') {
            this._renderPreview();
        }
        if (name === 'preview') {
            this._syncPreviewPane();
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

    get preview() {
        return this.getAttribute('preview') !== 'false';
    }

    set preview(v) {
        this.setAttribute('preview', v === false || v === 'false' ? 'false' : 'true');
    }

    _handleChange() {
        this._renderPreview();
        this.dispatchEvent(new CustomEvent('change', {
            bubbles: true,
            composed: true,
            detail: { value: this.value },
        }));
    }

    _syncPreviewPane() {
        if (this.preview) {
            if (this._previewEl || !this._editorPane) return;

            this._previewEl = document.createElement('div');
            this._previewEl.className = 'pane preview-pane';
            this._previewEl.setAttribute('part', 'preview');
            this._shadow.append(this._previewEl);

            this._resizeObserver = new ResizeObserver(() => this._renderPreview());
            this._resizeObserver.observe(this._previewEl);
            this._renderPreview();
            return;
        }

        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
        this._previewEl?.remove();
        this._previewEl = null;
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
        this._highlightAtCaret();
    }

    _highlightAtCaret() {
        if (!this._previewEl || !this._view) return;
        const caret = this._view.state.selection.main.head;

        this._previewEl.querySelectorAll('.aretino-cursor-rect')
            .forEach(el => el.remove());

        const candidates = this._previewEl.querySelectorAll('[data-src-start]');
        let best = null, bestA = 0, bestB = 0;
        for (const el of candidates) {
            const a = +el.dataset.srcStart, b = +el.dataset.srcEnd;
            if (caret > a && caret <= b) {
                if (!best || (b - a) < (bestB - bestA)) {
                    best = el; bestA = a; bestB = b;
                }
            }
        }

        if (!best || best.dataset.staffBottom === undefined) return;

        const staffBottom = +best.dataset.staffBottom;
        const staffHeight = +best.dataset.staffHeight;
        const bbox = best.getBBox();
        if (bbox.width === 0) return;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'aretino-cursor-rect aretino-cursor-bg');
        rect.setAttribute('x', bbox.x);
        rect.setAttribute('y', staffBottom - staffHeight - staffHeight/4);
        rect.setAttribute('width', bbox.width);
        rect.setAttribute('height', staffHeight + 2 * staffHeight/4);
        rect.setAttribute('fill', 'rgba(234, 88, 12, 0.13)');
        rect.setAttribute('stroke', 'none');
        best.prepend(rect);
    }
}

customElements.define('aretino-editor', AretinoEditor);
export { AretinoEditor };
