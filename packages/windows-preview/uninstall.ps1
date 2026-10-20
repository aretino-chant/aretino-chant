# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

# Removes what install.ps1 registered and copied, and the handler's log and
# WebView2 data under %LOCALAPPDATA%Low.

$ErrorActionPreference = 'Stop'

$Clsid = '{21B15767-4BC0-4D58-A1C8-703DB19BE876}'
$AppId = '{2F39F93C-0E4C-4B0A-9E4C-6C17899E94EE}'
$PreviewHandlerIid = '{8895b1c6-b41f-4c1c-a562-0d564250836f}'
$Classes = 'HKCU:\Software\Classes'

Get-Process prevhost -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

foreach ($Key in @("$Classes\.aretino\shellex\$PreviewHandlerIid", "$Classes\CLSID\$Clsid", "$Classes\AppID\$AppId")) {
    if (Test-Path $Key) { Remove-Item -Path $Key -Recurse -Force }
}
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers' -Name $Clsid -ErrorAction SilentlyContinue

$LocalLow = (New-Object -ComObject Shell.Application).NameSpace('shell:LocalAppDataLow').Self.Path
foreach ($Root in @((Join-Path $env:LOCALAPPDATA 'AretinoChant\PreviewHandler'), (Join-Path $LocalLow 'AretinoChant\PreviewHandler'))) {
    if (Test-Path $Root) { Remove-Item -Recurse -Force $Root }
}

Write-Host 'Uninstalled the Aretino Chant Preview Handler'
