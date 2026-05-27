/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { renderAretino, parseAretino } from '@aretino-chant/core';
import { aretino } from './highlight.js';
import { highlightAtSelection, sourceSpanFromPreviewClick } from './caret.js';

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

.welcome {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #aaa;
  font-size: 0.85em;
  text-align: center;
  padding: 12px;
  box-sizing: border-box;
}

.welcome a {
  color: inherit;
}

.preview-pane [data-src-start] {
  cursor: pointer;
}
`;

function hasMusicContent(ast) {
    if (Object.keys(ast.header).length > 0) return true;
    return ast.lines.some(l =>
        (l.type === 'music' && l.tokens.length > 0) ||
        l.type === 'verse'
    );
}

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
        this._handlePreviewClick = this._handlePreviewClick.bind(this);
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
                        if (update.selectionSet) this._handleSelectionChange();
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
        this._previewEl?.removeEventListener('click', this._handlePreviewClick);
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

    get caret() {
        return this._view?.state.selection.main.head ?? 0;
    }

    set caret(v) {
        if (!this._view) return;
        const position = Math.max(0, Math.min(this._view.state.doc.length, Number(v) || 0));
        this._view.dispatch({
            selection: { anchor: position },
            scrollIntoView: true,
        });
        this._view.focus();
    }

    get selection() {
        return this._sourceSelection();
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

    focus() {
        this._view?.focus();
    }

    _handleChange() {
        this._renderPreview();
        this.dispatchEvent(new CustomEvent('change', {
            bubbles: true,
            composed: true,
            detail: { value: this.value, caret: this.caret, selection: this.selection },
        }));
    }

    _handleSelectionChange() {
        this._highlightAtSelection();
        this.dispatchEvent(new CustomEvent('selectionchange', {
            bubbles: true,
            composed: true,
            detail: { caret: this.caret, selection: this.selection },
        }));
    }

    _syncPreviewPane() {
        if (this.preview) {
            if (this._previewEl || !this._editorPane) return;

            this._previewEl = document.createElement('div');
            this._previewEl.className = 'pane preview-pane';
            this._previewEl.setAttribute('part', 'preview');
            this._previewEl.addEventListener('click', this._handlePreviewClick);
            this._shadow.append(this._previewEl);

            this._resizeObserver = new ResizeObserver(() => this._renderPreview());
            this._resizeObserver.observe(this._previewEl);
            this._renderPreview();
            return;
        }

        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
        this._previewEl?.removeEventListener('click', this._handlePreviewClick);
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
            const ast = parseAretino(source);
            if (!hasMusicContent(ast)) {
                this._previewEl.innerHTML = `<div class="welcome">Welcome to Aretino Chant notation &mdash; <a href="https://aretino-chant.github.io" target="_blank">aretino-chant.github.io</a></div>`;
                return;
            }
            this._previewEl.innerHTML = renderAretino(ast, { width, zoom });
        } catch (err) {
            this._previewEl.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
        }
        this._highlightAtSelection();
    }

    _sourceSelection() {
        const selection = this._view?.state.selection.main;
        if (!selection) return { anchor: 0, head: 0, from: 0, to: 0 };
        return {
            anchor: selection.anchor,
            head: selection.head,
            from: selection.from,
            to: selection.to,
        };
    }

    _highlightAtSelection() {
        if (!this._previewEl || !this._view) return;
        highlightAtSelection(this._previewEl, this._view.state.selection.main, { scrollIntoView: true });
    }

    _handlePreviewClick(event) {
        const span = sourceSpanFromPreviewClick(event, this._previewEl);
        if (!span) return;
        this.caret = span.srcEnd;
    }
}

customElements.define('aretino-editor', AretinoEditor);
export { AretinoEditor };
