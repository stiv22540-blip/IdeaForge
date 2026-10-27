# Сборка IdeaForge.exe: Node.js + server.js + страница в одном файле (Node Single Executable Application).
# Нужен только Node.js 20+ (Windows); ничего не скачивается.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $here 'dist'
Set-Location $here
New-Item -ItemType Directory -Force $dist | Out-Null

# --- иконка: скруглённый квадрат с градиентом фиолетовый → розовый → оранжевый и белой звездой ---
Add-Type -AssemblyName System.Drawing
$ico = Join-Path $dist 'icon.ico'
$sizes = 256, 64, 48, 32, 16
$pngs = foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
    $k = $s / 256.0; $x = 8 * $k; $w = 240 * $k; $r = 64 * $k
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x, $x, $r, $r, 180, 90); $p.AddArc($x + $w - $r, $x, $r, $r, 270, 90)
    $p.AddArc($x + $w - $r, $x + $w - $r, $r, $r, 0, 90); $p.AddArc($x, $x + $w - $r, $r, $r, 90, 90); $p.CloseFigure()
    $br = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF 0, 0), (New-Object System.Drawing.PointF $s, $s), ([System.Drawing.Color]::FromArgb(139, 92, 246)), ([System.Drawing.Color]::FromArgb(245, 158, 11))
    $blend = New-Object System.Drawing.Drawing2D.ColorBlend 3
    $blend.Colors = [System.Drawing.Color[]]@([System.Drawing.Color]::FromArgb(139, 92, 246), [System.Drawing.Color]::FromArgb(236, 72, 153), [System.Drawing.Color]::FromArgb(245, 158, 11))
    $blend.Positions = [single[]]@(0, 0.55, 1)
    $br.InterpolationColors = $blend
    $g.FillPath($br, $p)
    $font = New-Object System.Drawing.Font 'Segoe UI Symbol', ([single](150 * $k)), ([System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat; $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
    $g.DrawString([string][char]0x2726, $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, (6 * $k), $s, $s), $sf)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    , $ms.ToArray()
}
$out = New-Object System.IO.MemoryStream; $bw = New-Object System.IO.BinaryWriter $out
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $d = $sizes[$i] % 256
    $bw.Write([Byte]$d); $bw.Write([Byte]$d); $bw.Write([Byte]0); $bw.Write([Byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]$pngs[$i].Length); $bw.Write([UInt32]$offset)
    $offset += $pngs[$i].Length
}
foreach ($png in $pngs) { $bw.Write($png) }
$bw.Flush(); [IO.File]::WriteAllBytes($ico, $out.ToArray())

# --- blob приложения ---
$cfg = Join-Path $dist 'sea-config.json'
@{ main = 'server.js'; output = 'dist/sea-prep.blob'; disableExperimentalSEAWarning = $true; useCodeCache = $false
   assets = @{ 'index.html' = 'public/index.html' } } | ConvertTo-Json | Set-Content -Encoding ASCII $cfg
node --experimental-sea-config $cfg
if ($LASTEXITCODE -ne 0) { throw 'Не удалось собрать blob' }

# --- exe: копия node.exe + иконка + вшитый blob ---
$exe = Join-Path $dist 'IdeaForge.exe'
Get-Process IdeaForge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $dist 'IdeaForge.old*.exe') -ErrorAction SilentlyContinue
if (Test-Path $exe) {
    # запущенный exe нельзя перезаписать, но можно переименовать — старая копия удалится при следующей сборке
    try { Remove-Item $exe -ErrorAction Stop } catch { Rename-Item $exe ("IdeaForge.old" + (Get-Date -Format 'HHmmss') + ".exe") }
}
Copy-Item (Get-Command node).Source $exe -Force
# SeaInject — своя замена postject: вшивает blob и иконку через Windows UpdateResource (компилируется встроенным csc)
$inject = Join-Path $dist 'SeaInject.exe'
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
& $csc /nologo /optimize+ /codepage:65001 /out:$inject (Join-Path $here 'tools\SeaInject.cs')
if ($LASTEXITCODE -ne 0) { throw 'Не удалось собрать SeaInject' }
& $inject $exe (Join-Path $dist 'sea-prep.blob') $ico --gui
if ($LASTEXITCODE -ne 0) { throw 'Не удалось вшить приложение в exe' }
Remove-Item $inject

Remove-Item $cfg, (Join-Path $dist 'sea-prep.blob') -ErrorAction SilentlyContinue
Copy-Item (Join-Path $here 'README.md') $dist -Force
Write-Host "`nГотово: $exe ($([math]::Round((Get-Item $exe).Length / 1MB)) МБ)"
