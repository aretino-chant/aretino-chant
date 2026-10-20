/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

using Microsoft.Web.WebView2.Core;

namespace AretinoChant.Preview;

// One WebView2 environment (browser process) shared by every preview in this
// prevhost.exe; only used on the UI thread. The browser process exits once its
// last WebView closes, which happens between files when the host calls Unload.
// Its environment is dead from then on. A new environment on the same user data
// folder can only be created once the old process has finished exiting.
internal static class BrowserEnvironment
{
    private static Task<CoreWebView2Environment>? s_current;
    private static Task s_exited = Task.CompletedTask;

    public static Task<CoreWebView2Environment> Get()
    {
        if (s_current == null || s_current.IsFaulted)
        {
            s_current = Create();
        }
        return s_current;
    }

    // Stop handing out `env`: its browser process has exited or is exiting.
    public static void Invalidate(CoreWebView2Environment env)
    {
        if (s_current is { IsCompletedSuccessfully: true } current && current.Result == env)
        {
            s_current = null;
        }
    }

    private static async Task<CoreWebView2Environment> Create()
    {
        try
        {
            await s_exited.WaitAsync(TimeSpan.FromSeconds(5));
        }
        catch (TimeoutException)
        {
            Log.Write("Previous browser process did not exit in time");
        }
        var env = await CoreWebView2Environment.CreateAsync(null, Storage.UserDataFolder);
        var exited = new TaskCompletionSource();
        env.BrowserProcessExited += (_, _) =>
        {
            Log.Write("Browser process exited");
            exited.TrySetResult();
            Invalidate(env);
        };
        s_exited = exited.Task;
        return env;
    }
}
