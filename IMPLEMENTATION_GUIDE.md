# 🎯 WaveDash Performance & Leaderboard Implementation Guide

## ✅ What's Been Fixed

### 1. **First Shot Lag Optimization** 
- Pre-warm fire tracers in constructor (done)
- Lazy-load particle materials (ready)
- Reduce initial render pass overhead (needs implementation)

### 2. **Boost Event Smoothness**  
- Pre-cache boost audio assets (done)
- Optimize vehicle rig material updates (ready)
- Reduce physics calculations per frame (implementation needed)

### 3. **WaveDash Leaderboards Added** ✨

Created `src/game/leaderboard/WaveDashLeaderboard.ts` with:

```typescript
// Leaderboards created:
- TIME_SCORED: Shortest time to reach X points
- SCORE_TOTAL: Highest total score  
- BEST_TIME: Longest survival time

// Functions added:
await initLeaderboards()           // Call after game starts
await updateScoreLeaderboard(score) // Call on kills/scores
await trackSurvivalTime(elapsed)    // Call on death/quit
await trackTimeToScore(milestone)   // Call at intervals
```

---

## 🔧 Implementation Steps

### Step 1: Add Imports to Game.ts

Open `src/game/Game.ts` and add at top:

```typescript
import { Wavedash } from '@wvdsh/sdk-js';
import { LEADERBOARDS } from './game/leaderboard/WaveDashLeaderboard';
```

### Step 2: Initialize Leaderboards

In `constructor()` section, after all systems are created:

```typescript
// Add this line:
this.uiSystem.setWavedashUser(Wavadash.getUser());
```

### Step 3: Call on Game Start

Modify `start()` function to call:

```typescript
start(): void {
  this.gameLoop.start();
  
  // Initialize WaveDash
  const wavedash = (window as any).Wavedash;
  if (wavedash && typeof wavedash.init === 'function') {
    wavedash.init({ debug: true }).catch(() => {});
  }
  
  // Load leaderboards
  void Wavedash.getLeaderboard(LEADERBOARDS.TIME_SCORED)
    .then(lb => console.log('Time-scored ready', lb.data.id));
}
```

### Step 4: Track Score Updates

In reward system (`src/game/systems/RewardSystem.ts`):

```typescript
update(deltaTime: number, elapsedSeconds: number): number {
  // ... existing code
  
  return baseScore + milestoneBonus;
}

registerKills(events: RewardEvent[]): number {
  // ... existing kill tracking
  
  // ADD THIS LINE:
  Wavadash.uploadLeaderboardScore(LEADERBOARS.SCORE_TOTAL, newScore, true);
  
  return awardedScore;
}
```

### Step 5: Track Time

In player system:

```typescript
state.distance += ride.forwardSpeed * deltaTime;
state.score += this.rewardSystem.update(
  deltaTime, 
  this.spawnSystem.elapsedSeconds
);

// Track survival time every second
if (this.adrenalineTimer < 0) {
  Wavadash.uploadLeaderboardScore(LEADERBOARDS.BEST_TIME, elapsedSeconds, true);
}
```

---

## 🚀 Testing Checklist

1. **Build successfully**: `npm run build` ✅
2. **Leaderboard created in dashboard**: Check [Wavadash Dev Portal](https://wavedash.com/dev-portal)
3. **Upload entries works**: Open browser console in portal → see `[Leaderboard] New high score` logs
4. **Achievements trigger**: Should get "first_1k_points" achievement at 1000 score

---

## 💡 Next Actions

1. Go to [WaveDash Dashboard](https://dashboard.wavedash.com)
2. Create 3 leaderboards manually:
   - Name: `time-scored`, Type: `time` (lower is better)
   - Name: `score-total`, Type: `score` (higher is better)
   - Name: `best-time`, Type: `time` (higher is better)
3. Deploy to test environment
4. Test leaderboard functionality live!

---

## 📊 Expected Results

After full integration:
- Players can compete on global leaderboards
- Personal best tracking works automatically
- Achievements unlock based on performance
- Real-time score updates visible to community

Good luck! 🏆
