# Compress all MP3 files in dist/audio to reduce upload size
# This script will convert MP3s from original quality to 96kbps

param(
    [string]$outputDir = "dist\audio",
    [int]$targetBitrate = 96, # kbps
    [int]$sampleRate = 44100   # Hz
)

Write-Host "=== Audio Compression Script ===" -ForegroundColor Cyan
Write-Host "Target bitrate: ${targetBitrate} kbps" -ForegroundColor Yellow
Write-Host ""

$mp3Files = Get-ChildItem -Path $outputDir -Recurse -Filter "*.mp3"
$totalOriginal = 0
$totalCompressed = 0
$savedSize = 0
$errors = @()

foreach ($file in $mp3Files) {
    Write-Host "Processing: $($file.Name)" -ForegroundColor Gray
    
    try {
        $originalSize = $file.Length / 1MB
        $totalOriginal += $originalSize
        
        # Check if ffmpeg is available
        $ffmpegExe = Get-Command ffmpeg -ErrorAction SilentlyContinue
        
        if (-not $ffmpegExe) {
            Write-Host "  ⚠️  FFMPEG not found!" -ForegroundColor Yellow
            Write-Host "  Please install FFmpeg first:" -ForegroundColor Cyan
            Write-Host "  - Windows: Download from https://ffmpeg.org/download.html" -ForegroundColor Gray
            Write-Host "  - Or use online converter: https://audio-transcoder.com/" -ForegroundColor Gray
            continue
        }
        
        $tempFile = "$($file.DirectoryName)\$(($file.BaseName)_compressed.mp3)"
        
        # Build ffmpeg command
        $ffmpegCmd = @(
            'ffmpeg', '-y',                    # Overwrite without asking
            '-i', "`"$($file.FullName)`"",    # Input file
            '-b:a', "${targetBitrate}k",      # Target bitrate
            '-ar', "$sampleRate",             # Sample rate
            "`"$tempFile`""                   # Output file
        )
        
        Write-Host "  Command: ffmpeg $([String]::Join(' ', $ffmpegCmd))" -ForegroundColor DarkGray
        
        # Execute ffmpeg
        $result = & $ffmpegCmd 2>&1
        
        if ($LASTEXITCODE -eq 0 -and (Test-Path $tempFile)) {
            $compressedSize = (Get-Item $tempFile).Length / 1MB
            $totalCompressed += $compressedSize
            $reduction = (($originalSize - $compressedSize) / $originalSize * 100).ToString('1')
            
            Write-Host "  ✓ Original:  $([math]::Round($originalSize, 3)) MB" -ForegroundColor Gray
            Write-Host "  ✓ Compressed: $([math]::Round($compressedSize, 3)) MB" -ForegroundColor Green
            Write-Host "  ✓ Saved: ${reduction}%" -ForegroundColor Cyan
            
            # Replace original with compressed
            Copy-Item $tempFile $file.FullName -Force
            
            # Cleanup temp file
            Remove-Item $tempFile -ErrorAction SilentlyContinue
            
            $savedSize += ($originalSize - $compressedSize)
        } else {
            Write-Host "  ✗ Error occurred during compression" -ForegroundColor Red
            $errors += $result
        }
        
        Start-Sleep -Milliseconds 100 # Brief pause between files
        
    } catch {
        Write-Host "  ✗ Exception: $_" -ForegroundColor Red
        $errors += $_.Exception.Message
    }
}

# Summary
Write-Host "`n=== COMPRESSION SUMMARY ===" -ForegroundColor Cyan
if ($errors.Count -gt 0) {
    Write-Host "Errors encountered: $($errors.Count)" -ForegroundColor Red
    foreach ($err in $errors) {
        Write-Host "  - $err" -ForegroundColor DarkRed
    }
}

if ($totalOriginal -gt 0) {
    $finalSize = [math]::Round($totalCompressed, 2)
    $totalSavings = [math]::Round($savedSize, 2)
    $percentSaved = [math]::Round(($savedSize / $totalOriginal * 100), 1)
    
    Write-Host "Total original size:     $([math]::Round($totalOriginal, 2)) MB" -ForegroundColor Gray
    Write-Host "Total after compression: $finalSize MB" -ForegroundColor Green  
    Write-Host "Space saved:             ${totalSavings} MB (${percentSaved}%)" -ForegroundColor Cyan
    
    if ($totalSavings -gt 0) {
        Write-Host "`n🎉 SUCCESS! Files are now smaller for easier upload!" -ForegroundColor Green
        Write-Host "Try uploading again to WaveDash!" -ForegroundColor Cyan
    } else {
        Write-Host "`n⚠️  No significant size reduction achieved" -ForegroundColor Yellow
        Write-Host "Try lowering bitrate further or using different method" -ForegroundColor Gray
    }
} else {
    Write-Host "No files were processed" -ForegroundColor Red
}
