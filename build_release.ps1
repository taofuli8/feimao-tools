# Build TE MAN Pro compiled release (.pyd) with VS Build Tools + Comfy Python 3.13
$ErrorActionPreference = "Stop"

$ProRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Py = "C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\standalone-env\python.exe"
$VsDevCmd = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"

if (-not (Test-Path $Py)) { throw "Python not found: $Py" }
if (-not (Test-Path $VsDevCmd)) { throw "VsDevCmd not found: $VsDevCmd" }

Write-Host "Using Python: $Py"
& $Py -c "import sys; assert sys.version_info[:2]==(3,13), sys.version; import Cython; print('Cython', Cython.__version__)"

$cmd = @"
call "$VsDevCmd" -arch=amd64 -host_arch=amd64
cd /d "$ProRoot"
"$Py" build_release.py
"@

$tmp = Join-Path $env:TEMP "te_man_pro_build.cmd"
Set-Content -Path $tmp -Value $cmd -Encoding ASCII
Write-Host "Running build via VsDevCmd..."
cmd.exe /c $tmp
if ($LASTEXITCODE -ne 0) { throw "build failed: $LASTEXITCODE" }

$dist = Join-Path $ProRoot "dist\TE_MAN_Pro"
Write-Host "==== dist ===="
Get-ChildItem $dist -Recurse -File | ForEach-Object {
  "{0,10}  {1}" -f $_.Length, $_.FullName.Substring($dist.Length + 1)
}

# Optional: sync into share package
$share = "G:\ComfyUI\我的工作流\Moss批量生图工作流-改进版\custom_nodes\TE_MAN_Pro"
if (Test-Path (Split-Path $share -Parent)) {
  if (Test-Path $share) { Remove-Item $share -Recurse -Force }
  Copy-Item $dist $share -Recurse -Force
  Write-Host "Synced to share package: $share"
}

Write-Host "DONE"
