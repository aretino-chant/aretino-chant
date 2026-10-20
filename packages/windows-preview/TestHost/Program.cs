/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using AretinoChant.Preview.Interop;

// Drives the installed preview handler the way Explorer's preview pane does:
// creates it out of process (in its prevhost.exe surrogate), hands it the file
// as a stream and a window to draw into, then asks for the preview.
//
//   AretinoPreviewTestHost <file.aretino>                  interactive window
//   AretinoPreviewTestHost <file.aretino> <out.png> [sec]  screenshot, then exit
//   AretinoPreviewTestHost --cycle <sec> <file>...         preview each file for
//       <sec> seconds the way Directory Opus does: a new parent window and a new
//       handler per file, the old window destroyed and the handler released
//       without Unload
//   AretinoPreviewTestHost --cycle <sec> --reuse <file>... the way Explorer does:
//       one window and one handler, with Unload and Initialize between files
//
// Add --low to start the surrogate at low integrity, as Explorer does.
namespace AretinoChant.Preview.TestHost;

internal static class Program
{
    // AretinoPreviewHandler.ClassId
    private static readonly Guid HandlerClsid = new("21B15767-4BC0-4D58-A1C8-703DB19BE876");

    private const uint CLSCTX_LOCAL_SERVER = 0x4;
    private const uint STGM_READ = 0x0;
    private const uint STGM_SHARE_DENY_NONE = 0x40;

    private static bool s_lowIntegrity;
    private static bool s_reuse;

    [STAThread]
    private static int Main(string[] args)
    {
        s_lowIntegrity = args.Contains("--low");
        s_reuse = args.Contains("--reuse");
        args = args.Where(a => a != "--low" && a != "--reuse").ToArray();
        if (args.Length < 1 || (args[0] == "--cycle" && args.Length < 3))
        {
            Console.Error.WriteLine("usage: AretinoPreviewTestHost <file.aretino> [out.png] [seconds]");
            Console.Error.WriteLine("       AretinoPreviewTestHost --cycle <seconds> [--reuse] <file.aretino>...");
            return 2;
        }
        if (args[0] == "--cycle")
        {
            return Cycle(int.Parse(args[1]), args.Skip(2).Select(Path.GetFullPath).ToArray());
        }
        string file = Path.GetFullPath(args[0]);
        string? png = args.Length > 1 ? Path.GetFullPath(args[1]) : null;
        int seconds = args.Length > 2 ? int.Parse(args[2]) : 5;
        int exitCode = 0;

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();

        var form = new Form
        {
            Text = $"Aretino preview — {Path.GetFileName(file)}",
            ClientSize = new Size(700, 600),
            StartPosition = FormStartPosition.CenterScreen,
            TopMost = png != null,
        };
        var pane = new Panel { Dock = DockStyle.Fill };
        form.Controls.Add(pane);

        IPreviewHandler? handler = null;
        form.Shown += (_, _) =>
        {
            try
            {
                handler = CreateHandler(file);
                var rect = PaneRect(pane);
                handler.SetWindow(pane.Handle, ref rect);
                handler.DoPreview();
                Console.WriteLine("DoPreview returned S_OK");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Preview failed: {ex}");
                exitCode = 1;
                form.Close();
                return;
            }

            if (png != null)
            {
                var timer = new System.Windows.Forms.Timer { Interval = seconds * 1000 };
                timer.Tick += (_, _) =>
                {
                    timer.Stop();
                    Capture(pane, png);
                    Console.WriteLine($"Saved {png}");
                    form.Close();
                };
                timer.Start();
            }
        };
        pane.Resize += (_, _) =>
        {
            if (handler != null)
            {
                var rect = PaneRect(pane);
                handler.SetRect(ref rect);
            }
        };
        form.FormClosing += (_, _) => handler?.Unload();

        Application.Run(form);
        return exitCode;
    }

    private static int Cycle(int seconds, string[] files)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();

        var form = new Form
        {
            Text = "Aretino preview — cycle",
            ClientSize = new Size(700, 600),
            StartPosition = FormStartPosition.CenterScreen,
        };
        int next = 0;
        int exitCode = 0;
        Panel? pane = null;
        IPreviewHandler? handler = null;
        var timer = new System.Windows.Forms.Timer { Interval = seconds * 1000 };

        // Opus keeps one prevhost.exe for the whole session. Releasing the last
        // handler would let the surrogate exit, so hold one that never previews.
        var keepAlive = CreateHandler(files[0]);

        void ShowNext()
        {
            if (s_reuse)
            {
                ShowNextReusingHandler();
                return;
            }
            pane?.Dispose();
            if (handler != null)
            {
                Marshal.ReleaseComObject(handler);
                handler = null;
            }
            if (next == files.Length)
            {
                Marshal.ReleaseComObject(keepAlive);
                timer.Stop();
                form.Close();
                return;
            }
            string file = files[next++];
            pane = new Panel { Dock = DockStyle.Fill };
            form.Controls.Add(pane);
            try
            {
                var started = DateTime.Now;
                handler = CreateHandler(file);
                var rect = PaneRect(pane);
                handler.SetWindow(pane.Handle, ref rect);
                handler.DoPreview();
                Console.WriteLine($"{next}/{files.Length} {Path.GetFileName(file)}: DoPreview took {(DateTime.Now - started).TotalMilliseconds:F0} ms");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Preview of {file} failed: {ex.Message}");
                exitCode = 1;
            }
        }

        void ShowNextReusingHandler()
        {
            handler?.Unload();
            if (next == files.Length)
            {
                Marshal.ReleaseComObject(keepAlive);
                timer.Stop();
                form.Close();
                return;
            }
            string file = files[next++];
            try
            {
                var started = DateTime.Now;
                if (handler == null)
                {
                    pane = new Panel { Dock = DockStyle.Fill };
                    form.Controls.Add(pane);
                    handler = CreateHandler(file);
                }
                else
                {
                    Initialize(handler, file);
                }
                var rect = PaneRect(pane!);
                handler.SetWindow(pane!.Handle, ref rect);
                handler.DoPreview();
                Console.WriteLine($"{next}/{files.Length} {Path.GetFileName(file)}: DoPreview took {(DateTime.Now - started).TotalMilliseconds:F0} ms");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Preview of {file} failed: {ex.Message}");
                exitCode = 1;
            }
        }

        timer.Tick += (_, _) => ShowNext();
        form.Shown += (_, _) =>
        {
            ShowNext();
            timer.Start();
        };
        Application.Run(form);
        return exitCode;
    }

    private static IPreviewHandler CreateHandler(string file)
    {
        var clsid = HandlerClsid;
        var iid = typeof(IPreviewHandler).GUID;
        object obj = s_lowIntegrity
            ? CreateAtLowIntegrity(clsid, iid)
            : CreateLocal(clsid, iid, CLSCTX_LOCAL_SERVER);
        Initialize(obj, file);
        return (IPreviewHandler)obj;
    }

    private static void Initialize(object handler, string file)
    {
        Marshal.ThrowExceptionForHR(SHCreateStreamOnFileEx(file, STGM_READ | STGM_SHARE_DENY_NONE, 0, false, IntPtr.Zero, out IStream stream));
        ((IInitializeWithStream)handler).Initialize(stream, STGM_READ);
    }

    private static object CreateLocal(Guid clsid, Guid iid, uint context)
    {
        Marshal.ThrowExceptionForHR(CoCreateInstance(ref clsid, IntPtr.Zero, context, ref iid, out object obj));
        return obj;
    }

    // Activate while impersonating a low-integrity copy of our own token, with
    // cloaking so COM launches the surrogate with that token.
    private static object CreateAtLowIntegrity(Guid clsid, Guid iid)
    {
        const uint TOKEN_ALL_ACCESS = 0xF01FF;
        const uint CLSCTX_ENABLE_CLOAKING = 0x100000;
        const int SecurityImpersonation = 2, TokenImpersonation = 2, TokenIntegrityLevel = 25;
        const uint SE_GROUP_INTEGRITY = 0x20;

        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, out IntPtr token)
            || !DuplicateTokenEx(token, TOKEN_ALL_ACCESS, IntPtr.Zero, SecurityImpersonation, TokenImpersonation, out IntPtr low)
            || !ConvertStringSidToSid("S-1-16-4096", out IntPtr sid))
        {
            throw new System.ComponentModel.Win32Exception();
        }
        var label = new TOKEN_MANDATORY_LABEL { Sid = sid, Attributes = SE_GROUP_INTEGRITY };
        if (!SetTokenInformation(low, TokenIntegrityLevel, ref label, Marshal.SizeOf<TOKEN_MANDATORY_LABEL>() + GetLengthSid(sid))
            || !SetThreadToken(IntPtr.Zero, low))
        {
            throw new System.ComponentModel.Win32Exception();
        }
        try
        {
            return CreateLocal(clsid, iid, CLSCTX_LOCAL_SERVER | CLSCTX_ENABLE_CLOAKING);
        }
        finally
        {
            RevertToSelf();
        }
    }

    private static RECT PaneRect(Control pane) =>
        new() { Right = pane.ClientSize.Width, Bottom = pane.ClientSize.Height };

    // The preview lives in another process (and WebView2 composites on the GPU),
    // so DrawToBitmap sees nothing; copy the pixels off the screen instead.
    private static void Capture(Control pane, string path)
    {
        var area = pane.RectangleToScreen(pane.ClientRectangle);
        using var bitmap = new Bitmap(area.Width, area.Height);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.CopyFromScreen(area.Location, Point.Empty, area.Size);
        }
        bitmap.Save(path, ImageFormat.Png);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TOKEN_MANDATORY_LABEL
    {
        public IntPtr Sid;
        public uint Attributes;
    }

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool DuplicateTokenEx(IntPtr existingToken, uint desiredAccess, IntPtr tokenAttributes,
        int impersonationLevel, int tokenType, out IntPtr newToken);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool ConvertStringSidToSid(string stringSid, out IntPtr sid);

    [DllImport("advapi32.dll")]
    private static extern int GetLengthSid(IntPtr sid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetTokenInformation(IntPtr tokenHandle, int tokenInformationClass,
        ref TOKEN_MANDATORY_LABEL tokenInformation, int tokenInformationLength);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetThreadToken(IntPtr thread, IntPtr token);

    [DllImport("advapi32.dll")]
    private static extern bool RevertToSelf();

    [DllImport("ole32.dll")]
    private static extern int CoCreateInstance(ref Guid rclsid, IntPtr pUnkOuter, uint dwClsContext, ref Guid riid,
        [MarshalAs(UnmanagedType.IUnknown)] out object ppv);

    [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
    private static extern int SHCreateStreamOnFileEx(string pszFile, uint grfMode, uint dwAttributes,
        [MarshalAs(UnmanagedType.Bool)] bool fCreate, IntPtr pstmTemplate, out IStream ppstm);
}
