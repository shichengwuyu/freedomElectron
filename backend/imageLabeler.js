import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { TEMP_DIR } from './config.js';

const POWERSHELL_LABEL_SCRIPT = String.raw`
param(
  [Parameter(Mandatory=$true)]
  [string]$ManifestPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-LabelFont([int]$Size) {
  return [System.Drawing.Font]::new(
    'Microsoft YaHei',
    [single]$Size,
    [System.Drawing.FontStyle]::Bold,
    [System.Drawing.GraphicsUnit]::Pixel
  )
}

$items = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($item in @($items)) {
  $src = [string]$item.src
  $dest = [string]$item.dest
  $label = [string]$item.label
  if ([string]::IsNullOrWhiteSpace($label)) {
    $label = [System.IO.Path]::GetFileNameWithoutExtension($dest)
  }

  $image = [System.Drawing.Image]::FromFile($src)
  try {
    $width = $image.Width
    $height = $image.Height
    $barHeight = [Math]::Max(80, [Math]::Min(180, [int][Math]::Round($height * 0.13)))
    $canvas = [System.Drawing.Bitmap]::new($width, ($height + $barHeight), [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $g = [System.Drawing.Graphics]::FromImage($canvas)
      try {
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $g.Clear([System.Drawing.Color]::White)
        $g.DrawImage($image, 0, 0, $width, $height)

        $maxWidth = $width * 0.94
        $maxHeight = $barHeight * 0.84
        $fontSize = [int][Math]::Min([Math]::Round($barHeight * 0.68), [Math]::Round($width / [Math]::Max(2, $label.Length) * 1.18))
        if ($fontSize -lt 20) { $fontSize = 20 }

        $font = $null
        while ($fontSize -gt 14) {
          if ($font -ne $null) { $font.Dispose() }
          $font = New-LabelFont $fontSize
          $measured = $g.MeasureString($label, $font)
          if ($measured.Width -le $maxWidth -and $measured.Height -le $maxHeight) { break }
          $fontSize -= 2
        }

        $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 45, 45))
        $format = [System.Drawing.StringFormat]::new()
        try {
          $format.Alignment = [System.Drawing.StringAlignment]::Center
          $format.LineAlignment = [System.Drawing.StringAlignment]::Center
          $format.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
          $format.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
          $rect = [System.Drawing.RectangleF]::new(0, $height, $width, $barHeight)
          $g.DrawString($label, $font, $brush, $rect, $format)
        } finally {
          $format.Dispose()
          $brush.Dispose()
          if ($font -ne $null) { $font.Dispose() }
        }
      } finally {
        $g.Dispose()
      }

      $destDir = [System.IO.Path]::GetDirectoryName($dest)
      if (-not [string]::IsNullOrWhiteSpace($destDir)) {
        [System.IO.Directory]::CreateDirectory($destDir) | Out-Null
      }
      $canvas.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $canvas.Dispose()
    }
  } finally {
    $image.Dispose()
  }
}
`;

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export async function writeImagesWithNameLabels(items = []) {
  const safeItems = items
    .map((item) => ({
      src: path.resolve(String(item.src || '')),
      dest: path.resolve(String(item.dest || '')),
      label: String(item.label || '').trim(),
    }))
    .filter((item) => item.src && item.dest);

  if (!safeItems.length) return 0;

  const tempDir = await fs.promises.mkdtemp(path.join(TEMP_DIR, 'novel-image-label-'));
  const manifestPath = path.join(tempDir, 'manifest.json');
  const scriptPath = path.join(tempDir, 'label-images.ps1');
  await fs.promises.writeFile(manifestPath, JSON.stringify(safeItems), 'utf8');
  await fs.promises.writeFile(scriptPath, POWERSHELL_LABEL_SCRIPT, 'utf8');

  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      manifestPath,
    ], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    return safeItems.length;
  } catch (error) {
    const detail = String(error.stderr || error.message || '').trim();
    throw new Error(`图片名称标注失败${detail ? `：${detail}` : ''}`);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}
