$ErrorActionPreference = 'Stop'
$installer = Get-ChildItem 'release/*Windows*x64*Setup.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$installDir = Join-Path $env:RUNNER_TEMP 'Hinana association test'
$process = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installDir") -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
try {
  $classes = 'Registry::HKEY_CURRENT_USER\Software\Classes'
  $progId = (Get-Item "$classes\.hinanaimage").GetValue('')
  if ($progId -ne 'HinanaStudioImage.Project') { throw "Unexpected project class: $progId" }
  $icon = (Get-Item "$classes\$progId\DefaultIcon").GetValue('')
  if ($icon -notlike '*HinanaImageDocument.ico*') { throw "Wrong icon registration: $icon" }
  $installedIcon = Join-Path $installDir 'resources/HinanaImageDocument.ico'
  if ((Get-FileHash $installedIcon).Hash -ne (Get-FileHash 'assets/document-icon/HinanaImageDocument.ico').Hash) { throw 'Installed icon differs from source' }
  $command = (Get-Item "$classes\$progId\shell\open\command").GetValue('')
  if ($command -notlike '*Hinana Studio Image.exe*' -or $command -notlike '*"%1"*') { throw "Invalid open command: $command" }
  Write-Output 'PASS: installed project association, dedicated icon bytes and quoted project argument'
} finally {
  $uninstaller = Join-Path $installDir 'Uninstall Hinana Studio Image.exe'
  if (Test-Path $uninstaller) { Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait }
}
