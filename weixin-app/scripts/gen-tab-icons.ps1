# Generate tabBar icons: 81x81 PNG, transparent bg, normal gray / active forest.
# NOTE: keep this file ASCII-only. powershell.exe 5.1 misreads UTF-8 comments
# without BOM (GBK fallback), which can silently corrupt the following line.
# Run: powershell.exe -ExecutionPolicy Bypass -File scripts/gen-tab-icons.ps1
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\miniprogram\images\tabs"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$size = 81
$colors = @{
  ""        = [System.Drawing.Color]::FromArgb(154, 168, 162)  # normal #9aa8a2
  "-active" = [System.Drawing.Color]::FromArgb(33, 66, 57)     # active #214239
}

function New-Canvas {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  return @($bmp, $g)
}

function Draw-Icon($name, $color, $suffix) {
  $bmp, $g = New-Canvas
  $brush = New-Object System.Drawing.SolidBrush($color)
  $pen = New-Object System.Drawing.Pen($color, 5.5)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  switch ($name) {
    "home" {
      # roof + body
      $roof = @(
        (New-Object System.Drawing.PointF(14, 40)),
        (New-Object System.Drawing.PointF(40.5, 16)),
        (New-Object System.Drawing.PointF(67, 40))
      )
      $g.DrawLines($pen, $roof)
      $body = New-Object System.Drawing.Drawing2D.GraphicsPath
      $body.AddRectangle((New-Object System.Drawing.RectangleF(22, 38, 37, 28)))
      $g.FillPath($brush, $body)
    }
    "task" {
      # document + three lines
      $g.DrawLine($pen, 30, 26, 51, 26)
      $g.DrawLine($pen, 30, 40.5, 51, 40.5)
      $g.DrawLine($pen, 30, 55, 43, 55)
      $path = New-Object System.Drawing.Drawing2D.GraphicsPath
      $path.AddArc(20, 14, 10, 10, 180, 90)
      $path.AddArc(51, 14, 10, 10, 270, 90)
      $path.AddArc(51, 57, 10, 10, 0, 90)
      $path.AddArc(20, 57, 10, 10, 90, 90)
      $path.CloseFigure()
      $g.DrawPath($pen, $path)
    }
    "works" {
      # circle + play triangle
      $g.DrawEllipse($pen, 17, 17, 47, 47)
      $tri = @(
        (New-Object System.Drawing.PointF(36, 31)),
        (New-Object System.Drawing.PointF(36, 50)),
        (New-Object System.Drawing.PointF(53, 40.5))
      )
      $g.FillPolygon($brush, $tri)
    }
    "data" {
      # three bars
      $g.FillRectangle($brush, (New-Object System.Drawing.RectangleF(17, 44, 11, 22)))
      $g.FillRectangle($brush, (New-Object System.Drawing.RectangleF(35, 31, 11, 35)))
      $g.FillRectangle($brush, (New-Object System.Drawing.RectangleF(53, 19, 11, 47)))
    }
    "mine" {
      # head + shoulders
      $g.FillEllipse($brush, 30, 14, 22, 22)
      $g.FillEllipse($brush, 21, 44, 40, 26)
    }
  }

  $file = Join-Path $outDir ($name + $suffix + ".png")
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $brush.Dispose(); $pen.Dispose()
  Write-Host "written $file"
}

foreach ($suffix in $colors.Keys) {
  foreach ($name in @("home", "task", "works", "data", "mine")) {
    Draw-Icon $name $colors[$suffix] $suffix
  }
}
Write-Host "done"
