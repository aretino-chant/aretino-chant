# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

# Installs the Aretino preview handler for the current user (no admin needed):
# copies the build output to %LOCALAPPDATA%\AretinoChant\PreviewHandler\bin and
# registers it under HKCU for .aretino files. Re-run after every rebuild.

param(
    [string]$Source = (Join-Path $PSScriptRoot 'AretinoPreview\bin\Release\net10.0-windows\win-x64')
)

$ErrorActionPreference = 'Stop'

$Clsid = '{21B15767-4BC0-4D58-A1C8-703DB19BE876}'
$AppId = '{2F39F93C-0E4C-4B0A-9E4C-6C17899E94EE}'
$PreviewHandlerIid = '{8895b1c6-b41f-4c1c-a562-0d564250836f}'
$Name = 'Aretino Chant Preview Handler'

$Root = Join-Path $env:LOCALAPPDATA 'AretinoChant\PreviewHandler'
$Bin = Join-Path $Root 'bin'
$Classes = 'HKCU:\Software\Classes'

if (-not (Test-Path (Join-Path $Source 'AretinoPreview.comhost.dll'))) {
    throw "No build found in $Source. Run 'dotnet build -c Release' in AretinoPreview first."
}

# A running preview host keeps the old DLL loaded and locked. Explorer starts a
# new one on demand.
Get-Process prevhost -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

if (Test-Path $Bin) { Remove-Item -Recurse -Force $Bin }
New-Item -ItemType Directory -Force $Root | Out-Null
Copy-Item -Recurse $Source $Bin

function Set-Key([string]$Path, [string]$Default) {
    New-Item -Path $Path -Force | Out-Null
    if ($Default) { Set-Item -Path $Path -Value $Default }
}

# The COM class. comhost.dll is the native shim that loads .NET and our DLL.
$ClsidKey = "$Classes\CLSID\$Clsid"
Set-Key $ClsidKey $Name
New-ItemProperty -Path $ClsidKey -Name 'DisplayName' -Value $Name -Force | Out-Null
New-ItemProperty -Path $ClsidKey -Name 'AppID' -Value $AppId -Force | Out-Null
Set-Key "$ClsidKey\InprocServer32" (Join-Path $Bin 'AretinoPreview.comhost.dll')
New-ItemProperty -Path "$ClsidKey\InprocServer32" -Name 'ThreadingModel' -Value 'Apartment' -Force | Out-Null

# Our own surrogate AppID, so the handler gets a prevhost.exe of its own rather
# than sharing one with other handlers (a process can host only one .NET runtime).
$AppIdKey = "$Classes\AppID\$AppId"
Set-Key $AppIdKey $Name
New-ItemProperty -Path $AppIdKey -Name 'DllSurrogate' -PropertyType ExpandString -Value '%SystemRoot%\system32\prevhost.exe' -Force | Out-Null

# Hook it up to the file type and list it as a preview handler.
Set-Key "$Classes\.aretino\shellex\$PreviewHandlerIid" $Clsid
$Handlers = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers'
if (-not (Test-Path $Handlers)) { New-Item -Path $Handlers -Force | Out-Null }
New-ItemProperty -Path $Handlers -Name $Clsid -Value $Name -Force | Out-Null

Write-Host "Installed $Name to $Bin"
