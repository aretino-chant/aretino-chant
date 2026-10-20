/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

namespace AretinoChant.Preview;

// Appends to %LOCALAPPDATA%Low\AretinoChant\PreviewHandler\preview.log. The
// handler runs inside prevhost.exe with no console, so this is the only way to
// see what it did.
internal static class Log
{

    public static void Write(string message)
    {
        try
        {
            Directory.CreateDirectory(Storage.Root);
            string level = Storage.IsLowIntegrity ? "low" : "medium";
            File.AppendAllText(Storage.LogFile, $"{DateTime.Now:HH:mm:ss.fff} [{Environment.ProcessId}:{Environment.CurrentManagedThreadId} {level}] {message}{Environment.NewLine}");
        }
        catch
        {
            // Logging must never take the preview down.
        }
    }
}
