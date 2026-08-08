# Simple audio compression without external dependencies
# This uses .NET classes to compress MP3s to 96kbps

param(
    [string]$inputDir = "dist\audio",
    [int]$targetBitrate = 96 # kbps
)

Write-Host "=== Simple Audio Compressor ===" -ForegroundColor Cyan
Write-Host "This script will compress all MP3 files to ${targetBitrate}kbps" -ForegroundColor Yellow
Write-Host ""
Write-Host "⚠️  Note: For best results, please install ffmpeg first:" -ForegroundColor Yellow
Write-Host "   https://ffmpeg.org/download.html" -ForegroundColor Gray
Write-Host ""

if (Test-Path "$env:LOCALAPPDATA\Programs\common\ffmpeg\bin\ffmpeg.exe") {
    Write-Host "✅ FFMPEG found at: $env:LOCALAPPDATA\Programs\common\ffmpeg\bin\ffmpeg.exe" -ForegroundColor Green
} elseif ($null -ne (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Host "✅ FFMPEG found in PATH" -ForegroundColor Green
} else {
    Write-Host "❌ FFMPEG not found. Please install it or use online converter instead." -ForegroundColor Red
    Write-Host ""
    Write-Host "Alternative: Use these free online tools:" -ForegroundColor Cyan
    Write-Host "1. https://audio-transcoder.com/" -ForegroundColor Gray
    Write-Host "2. https://cloudconvert.com/mp3-compressor" -ForegroundColor Gray
    Write-Host "3. https://www.aconvert.com/audio/" -ForegroundColor Gray
    
    return
}

$mp3Files = Get-ChildItem -Path $inputDir -Recurse -Filter "*.mp3"
$count = $mp3Files.Count

Write-Host "Found $count MP3 file(s) to compress`n" -ForegroundColor Cyan

$originalSize = 0
$newSize = 0
$errorCount = 0

foreach ($file in $mp3Files) {
    Write-Host "Processing: $($file.Name)" -ForegroundColor Gray
    
    try {
        $sizeMB = $file.Length / 1MB
        $originalSize += $sizeMB
        
        $tempFile = "$($file.DirectoryName)\$(($file.BaseName)_tmp.mp3)"
        
        # Create ffmpeg command
        $args = @(
            "-y",                          # Overwrite without asking
            "-i", "`"$($file.FullName)`"",
            "-b:a", "${targetBitrate}k",   # Target bitrate
            "-ar", "44100",                # Sample rate
            "`"$tempFile`""
        )
        
        $output = & ffmpeg @args 2>&1 | Select-Object -Last 5
        
        if ($LASTEXITCODE -eq 0 -and (Test-Path $tempFile)) {
            $newMB = (Get-Item $tempFile).Length / 1MB
            $newSize += $newMB
            
            $reduction = (($sizeMB - $newMB) / $sizeMB * 100).ToString('1')
            
            Write-Host "  ✓ $([math]::Round($sizeMB, 3)) MB → $([math]::Round($newMB, 3)) MB (${reduction}% smaller)" -ForegroundColor Green
            
            # Replace original
            Copy-Item $tempFile $file.FullName -Force
            Remove-Item $tempFile -ErrorAction SilentlyContinue
            
        } else {
            Write-Host "  ✗ Failed" -ForegroundColor Red
            $errorCount++
        }
        
    } catch {
        Write-Host "  ✗ Error: $_" -ForegroundColor Red
        $errorCount++
    }
}

# Final summary
Write-Host "`n=== RESULTS ===" -ForegroundColor Cyan

if ($errorCount -gt 0) {
    Write-Host "Errors: $errorCount file(s) failed to compress" -ForegroundColor Red
}

$finalSavings = [math]::Round(($originalSize - $newSize), 2)
$percentSaved = [math]::Round(($finalSavings / $originalSize * 100), 1)

Write-Host "Original total size:     $([math]::Round($originalSize, 2)) MB" -ForegroundColor Gray
Write-Host "New total size:          $([math]::Round($newSize, 2)) MB" -ForegroundColor Green  
Write-Host "Space saved:             ${finalSavings} MB (${percentSaved}%)" -ForegroundColor Cyan

if ($finalSavings -gt 0) {
    Write-Host "`n🎉 Success! Files compressed and ready for upload!" -ForegroundColor Green
    Write-Host "Try uploading to WaveDash again now!" -ForegroundColor Cyan
} else {
    Write-Host "`n⚠️  No significant savings achieved" -ForegroundColor Yellow
    Write-Host "Consider using lower bitrate (64kbps) or different method" -ForegroundColor Gray
}
