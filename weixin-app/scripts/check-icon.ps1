Add-Type -AssemblyName System.Drawing
Get-ChildItem 'D:\ITEM\zhihu-app\weixin-app\miniprogram\images\tabs\*.png' | ForEach-Object {
  $b = [System.Drawing.Bitmap]::FromFile($_.FullName)
  $bands = @{}
  for ($y = 0; $y -lt 81; $y++) {
    for ($x = 0; $x -lt 81; $x++) {
      $p = $b.GetPixel($x, $y)
      if ($p.A -gt 30) { $bands[[int]($y / 10)] = $true }
    }
  }
  "{0}: {1}" -f $_.Name, (($bands.Keys | Sort-Object) -join ',')
  $b.Dispose()
}
