param([string]$OutDir = "docs", [string]$PreviewDir = "")
Add-Type -AssemblyName System.Drawing

function New-Image([string]$text, [int]$size) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $ff = New-Object System.Drawing.FontFamily('Times New Roman')
  $path.AddString($text, $ff, [int][System.Drawing.FontStyle]::Regular, [float]100, (New-Object System.Drawing.PointF(0, 0)), [System.Drawing.StringFormat]::GenericTypographic)
  $b = $path.GetBounds()
  $penW = [float]([Math]::Max(1.2, $size * 0.07))
  $k = [float](($size - 2 * $penW) / [Math]::Max($b.Width, $b.Height))
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $m = New-Object System.Drawing.Drawing2D.Matrix
  $m.Translate([float](($size - $b.Width * $k) / 2), [float](($size - $b.Height * $k) / 2))
  $m.Scale($k, $k)
  $m.Translate(-$b.X, -$b.Y)
  $path.Transform($m)
  $m.Dispose()

  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, $penW)
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawPath($pen, $path)
  $g.FillPath([System.Drawing.Brushes]::White, $path)

  $pen.Dispose(); $path.Dispose(); $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return , $ms.ToArray()
}

function New-Frame([int]$size) {
  return , (New-Image 'bt' $size)
}

New-Item -ItemType Directory -Force $OutDir | Out-Null
[System.IO.File]::WriteAllBytes((Join-Path $OutDir 'icon.png'), (New-Frame 512))
Write-Output "icon.png written"

if ($PreviewDir) {
  foreach ($s in 16, 32, 72) {
    [System.IO.File]::WriteAllBytes((Join-Path $PreviewDir ("prev_" + $s + ".png")), (New-Frame $s))
  }
  Write-Output "previews written"
}
