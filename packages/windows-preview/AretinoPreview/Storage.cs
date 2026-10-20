/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

using System.Runtime.InteropServices;

namespace AretinoChant.Preview;

// Where the handler may write. Explorer runs prevhost.exe at low integrity
// (it ignores DisableLowILProcessIsolation registered per user), Directory Opus
// at medium, so both can be running at once. A low-integrity process can only
// write under %LOCALAPPDATA%Low, and WebView2 refuses to share a user data
// folder between browser processes of different integrity (ERROR_BUSY), so each
// level gets its own.
internal static class Storage
{
    private static readonly Guid LocalAppDataLow = new("A520A1A4-1780-4FF6-BD18-167343C5AF16");

    public static readonly bool IsLowIntegrity = IntegrityLevel() < 0x2000;

    public static string Root { get; } = Path.Combine(KnownFolder(LocalAppDataLow), "AretinoChant", "PreviewHandler");

    public static string LogFile => Path.Combine(Root, "preview.log");

    public static string UserDataFolder => Path.Combine(Root, IsLowIntegrity ? "WebView2-LowIL" : "WebView2");

    private static string KnownFolder(Guid id)
    {
        Marshal.ThrowExceptionForHR(SHGetKnownFolderPath(id, 0, IntPtr.Zero, out IntPtr path));
        try
        {
            return Marshal.PtrToStringUni(path)!;
        }
        finally
        {
            Marshal.FreeCoTaskMem(path);
        }
    }

    // The RID of the process token's mandatory label: 0x1000 low, 0x2000 medium.
    private static int IntegrityLevel()
    {
        const int TokenIntegrityLevel = 25;
        const uint TOKEN_QUERY = 0x8;
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, out IntPtr token))
        {
            return 0x2000;
        }
        IntPtr buffer = IntPtr.Zero;
        try
        {
            GetTokenInformation(token, TokenIntegrityLevel, IntPtr.Zero, 0, out int length);
            buffer = Marshal.AllocHGlobal(length);
            if (!GetTokenInformation(token, TokenIntegrityLevel, buffer, length, out _))
            {
                return 0x2000;
            }
            IntPtr sid = Marshal.ReadIntPtr(buffer);
            int count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
            return Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1)));
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
            CloseHandle(token);
        }
    }

    [DllImport("shell32.dll")]
    private static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid rfid, uint dwFlags, IntPtr hToken, out IntPtr ppszPath);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr tokenHandle, int tokenInformationClass, IntPtr tokenInformation, int tokenInformationLength, out int returnLength);

    [DllImport("advapi32.dll")]
    private static extern IntPtr GetSidSubAuthority(IntPtr sid, uint subAuthority);

    [DllImport("advapi32.dll")]
    private static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
}
