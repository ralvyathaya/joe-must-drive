# Joe Must Drive 🏍️

**Sidecar Zombie Survival FPS | Vibe Jam 2026**

---

## 🎮 About

Ride shotgun through a ruined highway and survive endless zombie swarms! Play solo or team up with a friend in co-op mode - one drives, one shoots. Navigate three lanes of chaos, collect weapon pickups, and face epic helicopter bosses.

### Features

- **Co-op Multiplayer**: Real-time Driver/Gunner gameplay (or solo)
- **Dynamic Combat**: Lane-switching strategy against waves of zombies
- **Weapon Arsenal**: Pistol → Shotgun → Assault Rifle → Bazooka
- **Boss Battles**: Epic aerial encounters with weak points & telegraphed attacks
- **Adaptive Difficulty**: AI-powered challenge scaling based on performance
- **Mobile Support**: Full touch controls for handheld play

---

## 🚀 Run Locally

```bash
npm install
npm run dev
```

Open the URL shown in terminal to play immediately!

For co-op testing:
```bash
npm run relay  # Terminal 2 (optional)
```

---

## 📦 Build for Production

```bash
npm run build      # Optimized production build
npm run preview    # Test locally before deploying
```

Build output goes to `dist/` folder (~1.3 MB gzipped).

---

## 🌐 Deploy to WaveDash

### Quick Steps

1. Navigate to [WaveDash Dashboard](https://wavedash.io/dashboard)
2. Create new project named "joe-must-drive"
3. Upload **all contents** from the `dist/` folder
4. Set entry point: `index.html`
5. Deploy and get your live URL!

**URL format**: `https://[your-project].wavedash.io`

See deployment docs for detailed instructions.

---

## ⚙️ Tech Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript |
| Framework | Three.js + Vite |
| Multiplayer | WebSocket |
| Performance | Asset pooling, frame throttling |
| Platforms | Desktop browsers + Mobile |

---

## 🛠️ Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run preview` | Preview build locally |
| `npm run relay` | Co-op relay server |
| `npm test` | Run test suite |

---

## 📊 Stats

- **Bundle Size**: ~1.3 MB (gzipped)
- **Load Time**: < 2 seconds
- **FPS**: 60+ on modern devices
- **Players**: Solo or 2-player co-op
- **Assets**: 97 files total

---

## 🤝 Credits

- **Developer**: Ralvyathaya
- **Event**: Vibe Jam 2026
- **License**: MIT (code), All Rights Reserved (assets)
- **Built With**: ❤️ + ☕ + TypeScript

---

## 📄 License

Source code under [MIT License](LICENSE). Art, models, audio, and music assets copyright reserved - see `ASSET_ATTRIBUTION.md` for details.

---

**🎮 Good luck with your submission!**
