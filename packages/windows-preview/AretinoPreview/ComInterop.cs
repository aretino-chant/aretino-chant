/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

// Shell interfaces a preview handler implements or talks to. Shared with the
// test host, which drives the handler the way Explorer does.
namespace AretinoChant.Preview.Interop;

[StructLayout(LayoutKind.Sequential)]
public struct RECT
{
    public int Left, Top, Right, Bottom;
}

[StructLayout(LayoutKind.Sequential)]
public struct MSG
{
    public IntPtr hwnd;
    public uint message;
    public IntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public int ptX, ptY;
}

[ComImport, Guid("8895b1c6-b41f-4c1c-a562-0d564250836f"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPreviewHandler
{
    void SetWindow(IntPtr hwnd, ref RECT prc);
    void SetRect(ref RECT prc);
    void DoPreview();
    void Unload();
    void SetFocus();
    void QueryFocus(out IntPtr phwnd);
    [PreserveSig] int TranslateAccelerator(ref MSG pmsg);
}

[ComImport, Guid("fec87aaf-35f9-447a-adb7-20234491401a"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPreviewHandlerFrame
{
    void GetWindowContext(IntPtr pinfo);
    [PreserveSig] int TranslateAccelerator(ref MSG pmsg);
}

[ComImport, Guid("b824b49d-22ac-4161-ac8a-9916e8fa3f7f"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IInitializeWithStream
{
    void Initialize(IStream pstream, uint grfMode);
}

[ComImport, Guid("fc4801a3-2ba9-11cf-a229-00aa003d7352"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IObjectWithSite
{
    void SetSite([MarshalAs(UnmanagedType.IUnknown)] object? pUnkSite);
    void GetSite(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object? ppvSite);
}

[ComImport, Guid("00000114-0000-0000-c000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IOleWindow
{
    void GetWindow(out IntPtr phwnd);
    void ContextSensitiveHelp([MarshalAs(UnmanagedType.Bool)] bool fEnterMode);
}

public static class HResult
{
    public const int S_OK = 0;
    public const int S_FALSE = 1;
    public const int E_FAIL = unchecked((int)0x80004005);
}
