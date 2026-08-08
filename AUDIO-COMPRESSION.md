# 🎵 Audio Compression Guide - Reduce Upload Size

## Problem
Your game upload is stuck at 0% because MP3 audio files are too large (~6 MB total).

---

## ✅ Quick Fix: Compress MP3 Files

### **Option 1: Using FFmpeg (Recommended - Fast & Automatic)**

#### Step 1: Install FFmpeg
- Download from: https://ffmpeg.org/download.html
- Extract to `C:\ffmpeg\` or add to PATH
- Verify installation: Open PowerShell and type `ffmpeg -version`

#### Step 2: Run Compression Script
```powershell
cd I:\@Projects\VibeJam-Game
.\compress-audio.ps1
```

This will automatically compress all MP3s in `dist/audio/` to 96kbps.

#### Expected Results:
| File | Before | After | Reduction |
|------|--------|-------|-----------|
| lyrics-theme.mp3 | 1.81 MB | ~1.0 MB | 45% |
| boss-fights.mp3 | 1.53 MB | ~0.85 MB | 44% |
| gameplay.mp3 | 1.52 MB | ~0.85 MB | 44% |
| menu.mp3 | 1.44 MB | ~0.8 MB | 44% |

**Total savings:** ~3 MB → New size: ~24 MB instead of 27 MB

---

### **Option 2: Online Tools (No Installation Required)**

If you don't want to install FFmpeg, use these free online converters:

#### Method A: CloudConvert
1. Visit: https://cloudconvert.com/mp3-compressor
2. Upload each MP3 file
3. Set Quality: "High" or bitrate: 96 kbps
4. Click Convert → Download compressed version
5. Replace original files in `dist/audio/music/` folder

#### Method B: Audio Transcoder
1. Visit: https://audio-transcoder.com/
2. Select "Advanced mode" 
3. Set Output: MP3, Bitrate: 96 kbps
4. Upload and convert each file

#### Method C: Online-Convert
1. Visit: https://www.online-convert.com/
2. Choose "MP3 Converter"
3. Set quality settings
4. Batch upload multiple files at once

---

### **Option 3: Audacity (Desktop App - Most Control)**

#### Step 1: Install Audacity
Download from: https://www.audacityteam.org/

#### Step 2: Compress Each File
1. Open Audacity
2. Import → Audio → Select your MP3
3. Effects → Filter Curve EQ (optional for better quality)
4. File → Export → Export as MP3
5. In export dialog:
   - Quality: High (or set custom)
   - Bitrate Mode: Constant
   - Encoder Setting: 96 kbps
6. Save and replace original

---

### **Option 4: Foobar2000 (Best Quality Control)**

1. Download from: https://www.foobar2000.org/
2. Right-click MP3 → Convert → Queue
3. Configure output:
   - Format: MP3
   - Preset: Custom
   - Target: 96 kbps VBR
4. Start queue and replace originals

---

## 🚀 After Compression

Once all MP3 files are compressed:

1. **Verify new sizes:**
   ```powershell
   Get-ChildItem dist\audio\music\*.mp3 | Select-Object Name, @{N="Size(MB)";E={[math]::Round($_.Length/1MB,3)}}
   ```

2. **Total should be now:** ~1.7-2 MB instead of 6+ MB

3. **Re-upload to WaveDash:**
   - The smaller bundle should upload successfully!

---

## ⚡ Alternative Solutions if Compression Doesn't Work

### Try These:

1. **Contact WaveDash Support**
   - Email: support@wavedash.io
   - Subject: "Upload issues - Game too large"
   - Attach screenshot of error
   - Mention: Current size 24-27 MB after compression

2. **Split into Multiple Uploads**
   ```
   Upload separately:
   - Part 1: assets/ (~1.5 MB)
   - Part 2: audio/ (~2 MB compressed)  
   - Part 3: models/ (~4 MB)
   - Part 4: ui/ + other (~2 MB)
   ```

3. **Use External CDN for Audio**
   - Host MP3s on Cloudflare/RawGitHub
   - Update code to load via URL instead of local files
   - Reduces game bundle by 2-3 MB

4. **Lower Audio Quality Further**
   - Try 64kbps instead of 96kbps
   - Acceptable for background music
   - Even smaller file sizes

---

## 🔧 Troubleshooting

### Issue: FFmpeg not found
**Solution:** Add ffmpeg to PATH or download standalone executable

### Issue: Still stuck after compression
**Possible causes:**
- Browser cache clearing needed (Ctrl+F5)
- Firewall blocking upload
- Network instability
- Server-side file limit

**Quick fixes:**
1. Clear browser cache and cookies
2. Try different browser (Edge Chrome Firefox Safari)
3. Test internet speed: ping wavedash.io
4. Use Ethernet instead of WiFi if possible

### Issue: Quality loss too noticeable
**Try:** Increase bitrate to 128kbps instead of 96kbps
- Less compression but better audio
- Trade-off between quality and file size

---

## 📊 Size Comparison

| Method | Resulting Size | Quality | Time Required |
|--------|---------------|---------|---------------|
| Original (200kbps) | 6.3 MB | Excellent | N/A |
| FFmpeg (96kbps) | ~2 MB | Good | 5 min |
| Online tools (96kbps) | ~2 MB | Good | 15-20 min |
| Audacity (96kbps) | ~2 MB | Very Good | 20-30 min |
| Foobar2000 (96kbps) | ~2 MB | Best | 15 min |

---

## 💡 Pro Tips

1. **Always keep backup** of original files before compressing
2. **Test audio quality** after compression to ensure it's acceptable
3. **Compress during build process** next time using npm scripts
4. **Consider adaptive streaming** for larger projects in future

---

## 🎯 Expected Outcome

After following this guide:
- ✅ Total upload size: ~21-24 MB (down from 27 MB)
- ✅ Upload should complete faster (< 2 minutes)
- ✅ No more 500 errors
- ✅ Better chance of success with chunked uploads

Good luck! 🎵🚀
