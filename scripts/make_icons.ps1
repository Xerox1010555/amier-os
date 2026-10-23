# Amier OS icon generator — aurora glass "A" badge (pure GDI+).
# Saves: apps/desktop/assets/icon.png (256) + apps/mobile/assets/logo.png (1024)
Add-Type -AssemblyName System.Drawing

function New-Icon([int]$size) {
  $S = [double]$size
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  # ---- rounded panel ----
  $m = $S * 0.04
  $r = $S * 0.225
  $w = $S - 2 * $m
  $panel = New-Object System.Drawing.Drawing2D.GraphicsPath
  $panel.AddArc([single]$m, [single]$m, [single](2*$r), [single](2*$r), 180, 90)
  $panel.AddArc([single]($m + $w - 2*$r), [single]$m, [single](2*$r), [single](2*$r), 270, 90)
  $panel.AddArc([single]($m + $w - 2*$r), [single]($m + $w - 2*$r), [single](2*$r), [single](2*$r), 0, 90)
  $panel.AddArc([single]$m, [single]($m + $w - 2*$r), [single](2*$r), [single](2*$r), 90, 90)
  $panel.CloseFigure()

  $lg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point($size, $size)),
    [System.Drawing.Color]::FromArgb(255, 17, 25, 46),
    [System.Drawing.Color]::FromArgb(255, 5, 9, 18))
  $g.FillPath($lg, $panel)

  # ---- aurora glows (bounded by the panel) ----
  $panelRegion = New-Object System.Drawing.Region($panel)
  $oldClip = $g.Clip
  $g.Clip = $panelRegion

  $glows = @(
    @([double](0.30 * $S), [double](0.28 * $S), [double](0.85 * $S), @(46, 108, 255, 175)),
    @([double](0.80 * $S), [double](0.70 * $S), [double](0.75 * $S), @(150, 108, 255, 140)),
    @([double](0.74 * $S), [double](0.18 * $S), [double](0.55 * $S), @(126, 227, 176, 85))
  )
  foreach ($gz in $glows) {
    $cx = [single]$gz[0]; $cy = [single]$gz[1]; $rr = [single]$gz[2]
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse([single]($cx - $rr), [single]($cy - $rr), [single](2*$rr), [single](2*$rr))
    $pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
    $pgb.CenterColor = [System.Drawing.Color]::FromArgb($gz[3][3], $gz[3][0], $gz[3][1], $gz[3][2])
    $pgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
    $g.FillPath($pgb, $path)
    $pgb.Dispose(); $path.Dispose()
  }
  $g.Clip = $oldClip

  # ---- edge stroke + orbit ring ----
  $edge = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(90, 190, 214, 255), [single]($S * 0.012))
  $g.DrawPath($edge, $panel)
  $ring = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 180, 205, 255), [single]($S * 0.022))
  $ring.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $ring.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawArc($ring, [single]($S*0.115), [single]($S*0.115), [single]($S*0.77), [single]($S*0.77), 25, 285)

  # ---- central "A" ----
  $fam = New-Object System.Drawing.FontFamily("Segoe UI")
  $font = New-Object System.Drawing.Font($fam, [single]($S * 0.5), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = (New-Object System.Drawing.StringFormat).Clone()
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $box = New-Object System.Drawing.RectangleF([single]($S*0.02), [single]($S*0.04), [single]($S*0.96), [single]($S*0.96))
  $txt = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point([int]($S*0.20), [int]($S*0.90))),
    (New-Object System.Drawing.Point([int]($S*0.70), [int]($S*0.10))),
    [System.Drawing.Color]::FromArgb(255, 236, 243, 255),
    [System.Drawing.Color]::FromArgb(255, 120, 172, 255))
  $g.DrawString("A", $font, $txt, $box, $fmt)

  # ---- orbital accent dot ----
  $dcx = [single]($S * 0.855); $dcy = [single]($S * 0.242); $dr = [single]($S * 0.055)
  $dotPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $dotPath.AddEllipse([single]($dcx - $dr), [single]($dcy - $dr), [single](2*$dr), [single](2*$dr))
  $dotBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($dotPath)
  $dotBrush.CenterColor = [System.Drawing.Color]::FromArgb(240, 126, 227, 176)
  $dotBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 126, 227, 176))
  $g.FillPath($dotBrush, $dotPath)

  $g.Dispose()
  return $bmp
}

$root = Split-Path -Parent $PSScriptRoot
$d = New-Icon 256
$d.Save((Join-Path $root "apps\desktop\assets\icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$d.Dispose()
$l = New-Icon 1024
New-Item -ItemType Directory -Force (Join-Path $root "apps\mobile\assets") | Out-Null
$l.Save((Join-Path $root "apps\mobile\assets\logo.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$l.Dispose()

# ── icon.ico (16/32/48/256, PNG-compressed frames) for shortcuts/installers ─
$frames = @(16, 32, 48, 256)
$pngs = foreach ($n in $frames) { $b = New-Icon ([int]$n); $ms = New-Object System.IO.MemoryStream; $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose(); $ms.ToArray() }
$icoPath = Join-Path $root "apps\desktop\assets\icon.ico"
$fs = [System.IO.File]::Create($icoPath)
try {
  $bw = New-Object System.IO.BinaryWriter($fs)
  $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$frames.Count)
  $offset = 6 + 16 * $frames.Count
  for ($i = 0; $i -lt $frames.Count; $i++) {
    $n = $frames[$i]; $d8 = if ($n -eq 256) { 0 } else { $n }
    $bw.Write([Byte]$d8); $bw.Write([Byte]$d8); $bw.Write([Byte]0); $bw.Write([Byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32)
    $bw.Write([UInt32]$pngs[$i].Length); $bw.Write([UInt32]$offset)
    $offset += $pngs[$i].Length
  }
  foreach ($p in $pngs) { $bw.Write($p) }
  $bw.Flush()
} finally { $fs.Dispose() }
"icons OK (png256 + logo1024 + ico4)"
