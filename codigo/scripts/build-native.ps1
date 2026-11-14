$ErrorActionPreference = "Stop"

$CodeDir = Split-Path -Parent $PSScriptRoot
$RootDir = Split-Path -Parent $CodeDir
$AssetsDir = Join-Path $CodeDir "assets"
$NativeBinDir = Join-Path $CodeDir "src\native\bin"

if (!(Test-Path $AssetsDir)) { New-Item -ItemType Directory -Path $AssetsDir | Out-Null }
if (!(Test-Path $NativeBinDir)) { New-Item -ItemType Directory -Path $NativeBinDir | Out-Null }

# 1. Gerar icone Sci-Fi Ciano/Azul + Giroscopio Dourado/Ambar (Katharos Nous | katharos AI)
Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(255, 8, 13, 22))

$gp = New-Object System.Drawing.Drawing2D.GraphicsPath
$gp.AddEllipse(10, 10, 236, 236)
$bgBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($gp)
$bgBrush.CenterColor = [System.Drawing.Color]::FromArgb(255, 16, 28, 46)
$bgBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(255, 8, 13, 22))
$g.FillEllipse($bgBrush, 10, 10, 236, 236)
$gp.Dispose()

$cyanOuterPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 86, 182, 237), 5)
$cyanBrightPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(230, 115, 243, 255), 2.5)
$goldRingPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 213, 132), 3.5)
$amberRingPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(235, 255, 184, 51), 3)
$darkGoldPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(215, 229, 184, 75), 2.5)
$cyanBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 115, 243, 255))
$goldBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 213, 132))

# Halo externo Sci-Fi ciano
$g.DrawEllipse($cyanOuterPen, 16, 16, 224, 224)
$g.DrawEllipse($cyanBrightPen, 28, 28, 200, 200)

# Ticks orbitais em ciano
for ($i = 0; $i -lt 12; $i++) {
    $rad = ($i * 30.0) * [Math]::PI / 180.0
    $x1 = 128 + [Math]::Cos($rad) * 102
    $y1 = 128 + [Math]::Sin($rad) * 102
    $x2 = 128 + [Math]::Cos($rad) * 112
    $y2 = 128 + [Math]::Sin($rad) * 112
    $g.DrawLine($cyanBrightPen, [float]$x1, [float]$y1, [float]$x2, [float]$y2)
}

# Giroscopio 3D inclinado em dourado/ambar
$state = $g.Save()
$g.TranslateTransform(128, 128)
$g.RotateTransform(-28)
$g.DrawEllipse($goldRingPen, -74, -42, 148, 84)
$g.RotateTransform(58)
$g.DrawEllipse($amberRingPen, -72, -36, 144, 72)
$g.RotateTransform(45)
$g.DrawEllipse($darkGoldPen, -58, -26, 116, 52)
$g.Restore($state)

# Nucleo ciano/dourado da Katharos Nous
$g.DrawEllipse($cyanBrightPen, 100, 100, 56, 56)
$g.FillEllipse($goldBrush, 118, 118, 20, 20)
$g.FillEllipse($cyanBrush, 123, 123, 10, 10)

$pngPath = Join-Path $AssetsDir "icon.png"
$icoPath = Join-Path $AssetsDir "icon.ico"
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Criar arquivo .ICO valido com payload PNG 256x256
$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$fs = New-Object System.IO.FileStream($icoPath, [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]1)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]32)
$bw.Write([UInt32]$pngBytes.Length)
$bw.Write([UInt32]22)
$bw.Write($pngBytes)
$bw.Close()
$fs.Close()
$bgBrush.Dispose()
$cyanOuterPen.Dispose()
$cyanBrightPen.Dispose()
$goldRingPen.Dispose()
$amberRingPen.Dispose()
$darkGoldPen.Dispose()
$cyanBrush.Dispose()
$goldBrush.Dispose()
$g.Dispose()
$bmp.Dispose()

Write-Host "[Katharos] Icones gerados em assets/icon.ico e assets/icon.png"

# 2. Compilar MpeHook.exe e Katharos.exe com o compilador nativo C# do Windows
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (!(Test-Path $csc)) {
    $csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

$hookSrc = Join-Path $CodeDir "src\native\MpeHook.cs"
$hookOut = Join-Path $NativeBinDir "MpeHook.exe"
& $csc /nologo /optimize+ /target:exe /out:$hookOut $hookSrc

$launcherSrc = Join-Path $CodeDir "src\native\MpeLauncher.cs"
$launcherOut = Join-Path $RootDir "Katharos.exe"
$launcherAliasOut = Join-Path $RootDir "Artharos.exe"
& $csc /nologo /optimize+ /target:winexe /win32icon:$icoPath /out:$launcherOut $launcherSrc
Copy-Item $launcherOut $launcherAliasOut -Force

Write-Host "[Katharos] Binarios nativos compilados com sucesso:"
Write-Host "  -> $hookOut"
Write-Host "  -> $launcherOut"
Write-Host "  -> $launcherAliasOut"
