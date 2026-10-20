/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

using System.Drawing;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AretinoChant.Preview;

// Child control hosting WebView2, re-parented into Explorer's preview pane.
// The page (web/index.html next to this DLL) is served from a virtual host so
// it can load its script and fonts; it asks for the source once EB Garamond has
// loaded, and we post it over.
internal sealed class PreviewControl : UserControl
{
    private const string HostName = "aretino-preview.example";
    private const int ERROR_INVALID_STATE = unchecked((int)0x8007139F);

    private readonly string _source;
    private readonly Label _message;
    private WebView2 _webView;

    public PreviewControl(string source)
    {
        _source = source;
        BackColor = Color.White;

        _webView = NewWebView();
        _message = new Label
        {
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            Visible = false,
        };
        Controls.Add(_webView);
        Controls.Add(_message);
    }

    public void AttachTo(IntPtr parent, Rectangle bounds)
    {
        SetParent(Handle, parent);
        Bounds = bounds;
    }

    public void FocusPreview()
    {
        if (_webView.CoreWebView2 != null)
        {
            _webView.Focus();
        }
    }

    // Fire-and-forget: Explorer's DoPreview must not block on WebView2 start-up.
    // The control can be disposed (Unload, or another file selected) while we await,
    // so every continuation checks IsDisposed before touching controls.
    public async void Start()
    {
        Visible = true;
        try
        {
            Log.Write($"Start: bounds={Bounds}");
            var env = await BrowserEnvironment.Get();
            if (IsDisposed) return;
            try
            {
                await _webView.EnsureCoreWebView2Async(env);
            }
            catch (COMException ex) when (ex.HResult == ERROR_INVALID_STATE)
            {
                // The previous preview was the browser's last WebView and it is
                // shutting down. Start a new browser, in a fresh control, since a
                // WebView2 control can't retry a failed initialisation.
                Log.Write("Browser process is exiting; starting a new one");
                BrowserEnvironment.Invalidate(env);
                Controls.Remove(_webView);
                _webView.Dispose();
                _webView = NewWebView();
                Controls.Add(_webView);
                env = await BrowserEnvironment.Get();
                if (IsDisposed) return;
                await _webView.EnsureCoreWebView2Async(env);
            }
            if (IsDisposed) return;
            Log.Write("WebView2 ready");

            var core = _webView.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = Environment.GetEnvironmentVariable("ARETINO_PREVIEW_DEVTOOLS") == "1";
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsPinchZoomEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;

            core.SetVirtualHostNameToFolderMapping(HostName, WebFolder(), CoreWebView2HostResourceAccessKind.Deny);
            core.NavigationStarting += (_, e) =>
            {
                if (!e.Uri.StartsWith($"https://{HostName}/", StringComparison.OrdinalIgnoreCase))
                {
                    e.Cancel = true;
                }
            };
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.NavigationCompleted += (_, e) =>
                Log.Write($"Navigation completed: success={e.IsSuccess}, status={e.WebErrorStatus}, http={e.HttpStatusCode}");
            core.ProcessFailed += (_, e) => Log.Write($"WebView2 process failed: {e.ProcessFailedKind}, {e.Reason}");
            core.WebMessageReceived += (_, e) =>
            {
                if (e.TryGetWebMessageAsString() == "ready")
                {
                    Log.Write("Page ready, posting source");
                    core.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "update", text = _source }));
                }
            };
            core.Navigate($"https://{HostName}/index.html");
        }
        catch (Exception ex)
        {
            if (IsDisposed)
            {
                // Closed before WebView2 finished starting (E_ABORT): nothing to show.
                Log.Write($"Start abandoned, preview closed: {ex.Message}");
                return;
            }
            Log.Write($"Start failed: {ex}");
            ShowMessage(ex is WebView2RuntimeNotFoundException
                ? "The Aretino preview needs the Microsoft Edge WebView2 Runtime."
                : $"Aretino preview failed: {ex.Message}");
        }
    }

    // Some hosts (Directory Opus) never call Unload: they destroy the window we
    // were parented into and create a new handler for the next file. Our window
    // goes down with theirs, but the WebView2 behind it would keep its renderer
    // process running, so dispose of everything once the window is gone.
    protected override void OnHandleDestroyed(EventArgs e)
    {
        base.OnHandleDestroyed(e);
        if (!RecreatingHandle && !Disposing && !IsDisposed)
        {
            Log.Write("Host destroyed the preview window");
            SynchronizationContext.Current?.Post(_ => Dispose(), null);
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Log.Write("Preview disposed");
        }
        base.Dispose(disposing);
    }

    private void ShowMessage(string text)
    {
        _webView.Visible = false;
        _message.Text = text;
        _message.Visible = true;
    }

    private static WebView2 NewWebView() =>
        new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.White };

    private static string WebFolder() =>
        Path.Combine(Path.GetDirectoryName(typeof(PreviewControl).Assembly.Location)!, "web");

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
}
