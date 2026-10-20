# Aretino Windows Preview (spike)

A Windows Explorer preview handler for `.aretino` files: select a file with the
preview pane open (`Alt+P`) and the score is rendered beside the file list. The
same handler serves every host that uses shell preview handlers, such as
Outlook's attachment preview and the preview pane of the Open/Save dialogs.

It is a C# COM server (`AretinoPreview.comhost.dll`) that Explorer loads into
its `prevhost.exe` surrogate. It hosts a WebView2 control that loads a small
page bundling `@aretino-chant/core` and the EB Garamond fonts the VS Code
extension ships, so text is measured with real canvas metrics, just like in the
editor preview.

## Requirements

- Windows 10/11 x64
- .NET 10 Desktop Runtime
- Microsoft Edge WebView2 Runtime (preinstalled on current Windows)

## Build

The page is built with npm (works from WSL too), the handler with the .NET SDK
on Windows:

```bash
npm run build -w packages/windows-preview
dotnet build -c Release packages/windows-preview/AretinoPreview
dotnet build -c Release packages/windows-preview/TestHost
```

## Install

Per user, no admin rights needed. It copies the build to
`%LOCALAPPDATA%\AretinoChant\PreviewHandler\bin` and registers it under
`HKCU\Software\Classes`. At run time the handler writes only under
`%LOCALAPPDATA%Low\AretinoChant\PreviewHandler` (log and WebView2 data), since
Explorer runs it at low integrity. Re-run it after every rebuild; it stops running
`prevhost.exe` processes so the old DLL is released, and Explorer starts them
again on demand.

```powershell
powershell -ExecutionPolicy Bypass -File packages\windows-preview\install.ps1
powershell -ExecutionPolicy Bypass -File packages\windows-preview\uninstall.ps1
```

What gets registered:

| Key | Purpose |
|---|---|
| `CLSID\{21B15767-…}\InprocServer32` | The COM class, pointing at the comhost shim. |
| `AppID\{2F39F93C-…}` `DllSurrogate=prevhost.exe` | A surrogate process of our own: one process can host only one .NET runtime, so we don't share one with other handlers. |
| `.aretino\shellex\{8895b1c6-…}` | The preview handler for the file type. |
| `Microsoft\Windows\CurrentVersion\PreviewHandlers` | The list of installed preview handlers. |

## Test without Explorer

`TestHost` drives the installed handler exactly as Explorer does: it creates it
out of process, passes the file as a stream, and gives it a window. Run it from
a Windows path (Windows won't execute it from `\\wsl.localhost`):

```powershell
AretinoPreviewTestHost.exe C:\path\to\score.aretino                  # interactive
AretinoPreviewTestHost.exe C:\path\to\score.aretino out.png 6         # screenshot after 6 s
AretinoPreviewTestHost.exe --cycle 2 a.aretino b.aretino ...           # one file every 2 s, Opus style
AretinoPreviewTestHost.exe --cycle 2 --reuse --low a.aretino ...       # Explorer style
```

`--low` starts the surrogate at low integrity, as Explorer does. Without it,
the test host gets a medium-integrity `prevhost.exe`, as Directory Opus does.
`--reuse` keeps one window and one handler and calls `Unload`/`Initialize`
between files, as Explorer does.

`--cycle` previews the files the way Directory Opus does. Each file gets a new
parent window and a new handler, the old window is destroyed, and `Unload` is
never called. It's the regression test for leaked WebView2 instances: count the
`msedgewebview2.exe` processes whose command line contains `AretinoChant`.

## Debugging

- Explorer says *"The file you are attempting to preview could harm your
  computer"* for files in the Internet security zone. That covers downloaded
  files (Mark of the Web; `Unblock-File` clears it) and paths such as
  `\\wsl.localhost\...`. This is Windows' own check, applied since the October
  2025 security update, and the handler is never loaded. Directory Opus doesn't
  apply it.

- The handler logs its lifecycle and any start-up failure to
  `%LOCALAPPDATA%Low\AretinoChant\PreviewHandler\preview.log`. Each line shows
  the process, thread and integrity level (`low` for Explorer).
- `ARETINO_PREVIEW_DEVTOOLS=1` in the `prevhost.exe` environment enables the
  WebView2 DevTools (F12 is off by default). COM starts `prevhost.exe`, so set
  it as a user environment variable. This is untested: COM may only pick up the
  change after you sign out and back in.

## How it works

1. Explorer calls `IInitializeWithStream.Initialize` with the file; the handler
   reads it as UTF-8.
2. `SetWindow`/`SetRect` give it the pane's window and size; `DoPreview` creates
   a `UserControl` hosting WebView2 and re-parents it into that window.
3. All UI work runs on an STA thread the handler owns (`UiThread`). WebView2
   refuses to start on the thread `prevhost.exe` calls in on.
4. The page is served from the `web` folder next to the DLL through a WebView2
   virtual host (`https://aretino-preview.example/`); navigation anywhere else
   is cancelled.
5. Every preview in a `prevhost.exe` shares one WebView2 environment (browser
   process). A preview is disposed on `Unload`, on the next `DoPreview`, or when
   the host destroys the window it gave us. Directory Opus does the last one and
   never calls `Unload`.
6. The browser process exits when its last WebView closes, which happens on
   every file change in Explorer. The environment is then replaced. If a preview
   catches the browser while it is exiting (`ERROR_INVALID_STATE`), it waits for
   the exit and retries in a new browser.
7. Explorer (low integrity) and Directory Opus (medium) can preview at the same
   time. WebView2 can't share a user data folder across integrity levels
   (`ERROR_BUSY`), so each level has its own.
8. Once EB Garamond has loaded, the page posts `ready`, the handler posts the
   source back, and the page renders it with `renderAretino`, reflowing on
   resize. `Ctrl` + scroll zooms.

## Not done yet

- Thumbnails (`IThumbnailProvider`): these need a renderer that does not
  depend on WebView2.
- An installer (MSI/MSIX), ARM64 builds, and code signing.
- Tab key focus hand-off back to Explorer beyond forwarding accelerators.
- Dark mode: the pane briefly flashes white before the page loads.
