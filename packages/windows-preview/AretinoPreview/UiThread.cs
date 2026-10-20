/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

namespace AretinoChant.Preview;

// The preview's windows live on an STA thread of our own with a WinForms message
// loop. prevhost.exe calls the handler on a thread WebView2 refuses to start on
// (CO_E_NOTINITIALIZED), and a loop we own also gives the WebView2 awaits a
// synchronization context to come back to.
internal static class UiThread
{
    private static readonly Lazy<Control> Marshaller = new(Start);

    public static void Post(Action action) => Marshaller.Value.BeginInvoke(action);

    public static T Invoke<T>(Func<T> func) => (T)Marshaller.Value.Invoke(func);

    private static Control Start()
    {
        Control? marshaller = null;
        using var ready = new ManualResetEventSlim();
        var thread = new Thread(() =>
        {
            marshaller = new Control();
            marshaller.CreateControl();
            ready.Set();
            Application.Run();
        })
        {
            IsBackground = true,
            Name = "Aretino preview UI",
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        ready.Wait();
        return marshaller!;
    }
}
