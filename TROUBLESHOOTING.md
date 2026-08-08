# 🔧 TROUBLESHOOTING WAVEDASH UPLOAD STUCK AT 0%

## Problem
Upload loading stuck at 0% when uploading `dist/` folder (~27 MB)

## Root Cause
- **Audio files too large** (4 MP3 files totaling ~6.3 MB)
- **Large 3D models** (helicopter-boss.glb: 1.94 MB, Motorcycle+sidecar.glb: 1.64 MB)
- **WaveDash may have file size limits** per upload

---

## ✅ Solutions (Try in Order)

### **Option A: Compress Audio Files (RECOMMENDED - Fastest)**

Use one of these methods to compress your MP3s from ~200kbps to ~96kbps:

#### Method 1: Online Converter (Easiest)
1. Go to [audio-transcoder.com](https://audio-transcoder.com/) or similar
2. Upload each MP3 file
3. Select quality: "High" or bitrate: 96kbps
4. Download compressed version
5. Replace in `dist/audio/music/` folder
6. Re-upload

**Expected savings:** ~3 MB reduction (files become ~1 MB each instead of ~1.8 MB)

#### Method 2: Command Line (If you have ffmpeg installed)
```bash
# Install ffmpeg first if needed
ffmpeg -version

# Compress each music file
ffmpeg -i dist\audio\music\menu.mp3 -b:a 96k -ar 44100 dist\audio\music\menu_96k.mp3
ffmpeg -i dist\audio\music\gameplay.mp3 -b:a 96k -ar 44100 dist\audio\music\gameplay_96k.mp3
ffmpeg -i dist\audio\music\boss-fights.mp3 -b:a 96k -ar 44100 dist\audio\music\boss-fights_96k.mp3
ffmpeg -i dist\audio\music\lyrics-theme.mp3 -b:a 96k -ar 44100 dist\audio\music\lyrics-theme_96k.mp3

# Replace originals
move /y dist\audio\music\menu_96k.mp3 dist\audio\music\menu.mp3
move /y dist\audio\music\gameplay_96k.mp3 dist\audio\music\gameplay.mp3
move /y dist\audio\music\boss-fights_96k.mp3 dist\audio\music\boss-fights.mp3
move /y dist\audio\music\lyrics-theme_96k.mp3 dist\audio\music\lyrics-theme.mp3
```

#### Method 3: Use Audacity (Free Desktop App)
1. Download [Audacity](https://www.audacityteam.org/)
2. Import each MP3
3. File → Export → Export as MP3 → Set bitrate: 96 kbps
4. Replace original files

**Result:** Each file reduced by ~40-50%

---

### **Option B: Zip & Chunk Upload**

If WaveDash supports ZIP uploads:
1. Right-click `dist/` folder → Send to → Compressed folder
2. Upload the ZIP file directly
3. WaveDash should auto-extract

Or break into smaller parts:
```
Split into multiple uploads:
- assets/      (~1.5 MB) - Upload first
- audio/       (~6 MB)   - Upload second  
- models/      (~4.2 MB) - Upload third
- ui/ + other  (~2 MB)  - Upload fourth
```

---

### **Option C: Check Network Issues**

Sometimes "stuck at 0%" is actually network timeout:

1. **Check internet connection stability**
   ```powershell
   # Test connection speed
   ping wavedash.io -t
   
   # Should see consistent response times < 100ms
   ```

2. **Try different browser or incognito mode**
   - Some extensions (ad blockers) interfere with uploads
   - Try Chrome, Firefox, or Edge in incognito/private mode

3. **Use download manager tool**
   - If WaveDash has download links, use tools like JDownloader or IDM

---

### **Option D: Contact WaveDash Support**

If none of above work, it might be platform-specific:

1. Email: support@wavedash.io
2. Subject: "Upload stuck at 0% - Joe Must Drive game"
3. Include:
   - Game name and description
   - Folder size: 27.42 MB
   - Number of files: 97
   - Browser/network details
   - Screenshots of error

---

## 🎯 Expected Result After Fix

After compressing audio files to 96kbps:
- **Current size**: 27.42 MB
- **After compression**: ~21 MB
- **Reduction**: ~6 MB (22% smaller)

This should allow successful upload!

---

## 💡 Prevention for Future Projects

To avoid this issue next time:

1. **Optimize audio during build**, not after
   - Use `lameenc` npm package in pre-build step
   - Or configure Three.js loader to load compressed versions

2. **Set build targets earlier**
   - Plan for max bundle size from start
   - Target: < 10 MB for browser games

3. **Use CDN/external hosting** for large assets
   - Host audio on Cloudflare or similar
   - Reference via URL in game code

---

## ⚡ Quick Checklist

Before re-uploading:

- [ ] Compressed all MP3 files to 96kbps
- [ ] Removed unnecessary test/dev files from dist/
- [ ] Verified zip size under 25 MB
- [ ] Tested with incognito browser
- [ ] Internet connection stable (no WiFi drops)
- [ ] No firewall/antivirus blocking upload
- [ ] Tried different upload method (ZIP vs individual files)

Good luck! 🚀
