/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { renderAretino, parseAretino } from '@aretino-chant/core';
import { aretino } from './highlight.js';
import { highlightAtSelection, sourceSpanFromPreviewClick } from './caret.js';
import { buildToolbarState } from './toolbar.js';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,600;1,400&display=swap';

const STYLE = `
:host {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  height: 300px;
  overflow: hidden;
  font-family: 'Inter', system-ui, sans-serif;
}

.content {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  gap: 8px;
  overflow: hidden;
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

.toolbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
  padding: 3px 6px;
  border-bottom: 1px solid #e0e0e0;
  flex-shrink: 0;
  overflow-x: auto;
  flex-wrap: wrap;
}

.toolbar-group {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 1px;
  padding: 0 4px;
  border-right: 1px solid #e0e0e0;
}

.toolbar-group:last-child {
  border-right: none;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  padding: 3px;
  color: #333;
  line-height: 1;
}

.toolbar-btn:hover:not(:disabled) {
  background: #f3f4f6;
  border-color: #d1d5db;
}

.toolbar-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.toolbar-btn.active {
  background: #dbeafe;
  color: #1d4ed8;
  border-color: #93c5fd;
}

.toolbar-btn svg {
  width: 18px;
  height: 18px;
  display: block;
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
        return ['value', 'zoom', 'preview', 'toolbar'];
    }

    constructor() {
        super();
        this._shadow = this.attachShadow({ mode: 'open' });
        this._view = null;
        this._contentEl = null;
        this._editorPane = null;
        this._previewEl = null;
        this._toolbarEl = null;
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

        const contentEl = document.createElement('div');
        contentEl.className = 'content';
        this._contentEl = contentEl;

        const editorPane = document.createElement('div');
        editorPane.className = 'pane editor-pane';
        editorPane.setAttribute('part', 'editor');
        this._editorPane = editorPane;
        contentEl.appendChild(editorPane);

        this._shadow.append(style, contentEl);
        this._syncToolbarPane();
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
        this._renderToolbar();
    }

    disconnectedCallback() {
        this._view?.destroy();
        this._view = null;
        this._contentEl = null;
        this._editorPane = null;
        this._toolbarEl = null;
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
        if (name === 'toolbar') {
            this._syncToolbarPane();
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

    get toolbar() {
        return this.getAttribute('toolbar') !== 'false';
    }

    set toolbar(v) {
        this.setAttribute('toolbar', v === false || v === 'false' ? 'false' : 'true');
    }

    focus() {
        this._view?.focus();
    }

    getToolbarState() {
        return this._computeToolbarState();
    }

    getSourceHtml(from, to) {
        if (!this._view || from >= to) return '';
        const view = this._view;
        try {
            const a = view.domAtPos(from);
            const b = view.domAtPos(to);
            const range = document.createRange();
            range.setStart(a.node, a.offset);
            range.setEnd(b.node, b.offset);
            const frag = range.cloneContents();
            const wrap = document.createElement('span');
            wrap.appendChild(frag);
            let firstLine = true;
            wrap.querySelectorAll('.cm-line').forEach(line => {
                if (!firstLine) { line.parentNode.insertBefore(document.createTextNode(' '), line); }
                while (line.firstChild) { line.parentNode.insertBefore(line.firstChild, line); }
                firstLine = false;
                line.remove();
            });
            return wrap.innerHTML;
        } catch (_e) {
            const t = view.state.doc.sliceString(from, to);
            return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
    }

    _handleChange() {
        this._renderPreview();
        this.dispatchEvent(new CustomEvent('change', {
            bubbles: true,
            composed: true,
            detail: { value: this.value, caret: this.caret, selection: this.selection },
        }));
        this._emitToolbarChange();
    }

    _handleSelectionChange() {
        this._highlightAtSelection();
        this.dispatchEvent(new CustomEvent('selectionchange', {
            bubbles: true,
            composed: true,
            detail: { caret: this.caret, selection: this.selection },
        }));
        this._emitToolbarChange();
    }

    _emitToolbarChange() {
        const state = this._computeToolbarState();
        this._renderToolbarFromState(state);
        this.dispatchEvent(new CustomEvent('toolbarchange', {
            bubbles: true,
            composed: true,
            detail: state,
        }));
    }

    _computeToolbarState() {
        if (!this._view) return { groups: [], context: { type: 'empty' } };
        const ast = parseAretino(this.value);
        const sel = this._view.state.selection.main;
        return buildToolbarState(this._view, ast, sel.head, sel.from, sel.to);
    }

    _syncToolbarPane() {
        if (!this._contentEl) return;
        if (this.toolbar) {
            if (this._toolbarEl) return;
            this._toolbarEl = document.createElement('div');
            this._toolbarEl.className = 'toolbar';
            this._toolbarEl.setAttribute('part', 'toolbar');
            this._shadow.insertBefore(this._toolbarEl, this._contentEl);
            this._renderToolbar();
            return;
        }
        this._toolbarEl?.remove();
        this._toolbarEl = null;
    }

    _renderToolbar() {
        if (!this._toolbarEl) return;
        this._renderToolbarFromState(this._computeToolbarState());
    }

    _renderToolbarFromState(state) {
        if (!this._toolbarEl) return;
        this._toolbarEl.innerHTML = '';
        for (const group of state.groups) {
            const groupEl = document.createElement('span');
            groupEl.className = 'toolbar-group';
            for (const action of group.actions) {
                const btn = document.createElement('button');
                btn.className = 'toolbar-btn' + (action.active ? ' active' : '');
                btn.disabled = !action.enabled;
                btn.title = action.tooltip;
                btn.innerHTML = action.icon;
                btn.addEventListener('click', () => { action.execute(); this._view?.focus(); });
                groupEl.appendChild(btn);
            }
            this._toolbarEl.appendChild(groupEl);
        }
    }

    _syncPreviewPane() {
        if (this.preview) {
            if (this._previewEl || !this._contentEl) return;

            this._previewEl = document.createElement('div');
            this._previewEl.className = 'pane preview-pane';
            this._previewEl.setAttribute('part', 'preview');
            this._previewEl.addEventListener('click', this._handlePreviewClick);
            this._contentEl.append(this._previewEl);

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
