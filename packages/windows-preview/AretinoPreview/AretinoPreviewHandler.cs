/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

using System.Drawing;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using AretinoChant.Preview.Interop;

namespace AretinoChant.Preview;

// The COM object Explorer's preview pane creates (inside prevhost.exe) for a
// .aretino file. Explorer hands over the file as a stream, then a parent window
// and its rectangle, then asks for the preview; we answer with a child control,
// parented into that window, hosting the WebView2 page that renders it.
[ComVisible(true)]
[Guid(ClassId)]
[ClassInterface(ClassInterfaceType.None)]
public sealed class AretinoPreviewHandler : IPreviewHandler, IInitializeWithStream, IObjectWithSite, IOleWindow
{
    public const string ClassId = "21B15767-4BC0-4D58-A1C8-703DB19BE876";

    private IntPtr _parent;
    private Rectangle _bounds;
    private string? _source;
    private object? _site;
    private PreviewControl? _control;

    public void Initialize(IStream pstream, uint grfMode)
    {
        try
        {
            _source = ReadAllText(pstream);
        }
        finally
        {
            Marshal.ReleaseComObject(pstream);
        }
    }

    // Everything that touches the preview control runs on the UI thread, in the
    // order Explorer called us; _control is only ever read or written there.
    public void SetWindow(IntPtr hwnd, ref RECT prc)
    {
        _parent = hwnd;
        _bounds = ToRectangle(prc);
        var (parent, bounds) = (_parent, _bounds);
        UiThread.Post(() => _control?.AttachTo(parent, bounds));
    }

    public void SetRect(ref RECT prc)
    {
        _bounds = ToRectangle(prc);
        var bounds = _bounds;
        UiThread.Post(() =>
        {
            if (_control != null)
            {
                _control.Bounds = bounds;
            }
        });
    }

    public void DoPreview()
    {
        Log.Write($"DoPreview: parent={_parent}, bounds={_bounds}, source={_source?.Length.ToString() ?? "none"} chars");
        if (_source == null)
        {
            return;
        }
        var (source, parent, bounds) = (_source, _parent, _bounds);
        UiThread.Post(() =>
        {
            _control?.Dispose();
            _control = new PreviewControl(source);
            _control.AttachTo(parent, bounds);
            _control.Start();
        });
    }

    public void Unload()
    {
        Log.Write("Unload");
        _source = null;
        UiThread.Post(() =>
        {
            _control?.Dispose();
            _control = null;
        });
    }

    public void SetFocus() => UiThread.Post(() => _control?.FocusPreview());

    public void QueryFocus(out IntPtr phwnd) => phwnd = GetFocus();

    // Keys the preview does not handle (e.g. Tab to leave the pane) go back to
    // Explorer through the frame it gave us as our site.
    public int TranslateAccelerator(ref MSG pmsg) =>
        _site is IPreviewHandlerFrame frame ? frame.TranslateAccelerator(ref pmsg) : HResult.S_FALSE;

    public void SetSite(object? pUnkSite) => _site = pUnkSite;

    public void GetSite(ref Guid riid, out object? ppvSite)
    {
        ppvSite = _site ?? throw new COMException("No site.", HResult.E_FAIL);
    }

    public void GetWindow(out IntPtr phwnd) => phwnd = UiThread.Invoke(() => _control?.Handle ?? IntPtr.Zero);

    public void ContextSensitiveHelp(bool fEnterMode) => throw new NotImplementedException();

    private static Rectangle ToRectangle(RECT r) => Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);

    private static string ReadAllText(IStream stream)
    {
        using var bytes = new MemoryStream();
        var buffer = new byte[64 * 1024];
        IntPtr read = Marshal.AllocCoTaskMem(sizeof(int));
        try
        {
            while (true)
            {
                stream.Read(buffer, buffer.Length, read);
                int n = Marshal.ReadInt32(read);
                if (n <= 0)
                {
                    break;
                }
                bytes.Write(buffer, 0, n);
            }
        }
        finally
        {
            Marshal.FreeCoTaskMem(read);
        }
        bytes.Position = 0;
        using var reader = new StreamReader(bytes, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        return reader.ReadToEnd();
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetFocus();
}
