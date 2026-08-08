// WaveDash Leaderboard Integration for Joe Must Drive

import Wavadash from '@wvdsh/sdk-js';

// Leaderboard configurations
const LEADERBOARDS = {
  TIME_SCORED: 'time-scored',       // Shortest time to score X points
  SCORE_TOTAL: 'score-total',        // Highest total score
  BEST_TIME: 'best-time',            // Fastest survival time
};

/**
 * Initialize leaderboards when game starts
 */
export async function initLeaderboards(): Promise<void> {
  try {
    const user = Wavedash.getUser();
    console.log('[Leaderboard] Initializing...', user?.id);
    
    // Create/load leaderboards if they don't exist
    await loadOrCreateTimeScoredLeaderboard();
    await loadOrCreateTotalScoreLeaderboard();
    await loadOrCreateBestTimeLeaderboard();
    
    console.log('[Leaderboard] Setup complete');
  } catch (error) {
    console.error('[Leaderboard] Initialization failed:', error);
  }
}

/**
 * Track time-to-reach-score milestone
 */
export async function trackTimeToScore(milestoneSeconds: number): Promise<void> {
  try {
    const lb = await Wavedash.getLeaderboard(LEADERBOARDS.TIME_SCORED);
    const entry = {
      playerId: Wavedash.getUser().id,
      data: { timestamp: Date.now() },
    };
    
    // Upload as personal best time to reach milestone
    await Wavadash.uploadLeaderboardScore(lb.data.id, milestoneSeconds, true);
    console.log(`[Leaderboard] Time to ${milestoneSeconds}s: Uploaded`);
  } catch (error) {
    console.warn('[Leaderboard] Time tracking failed:', error);
  }
}

/**
 * Update score leaderboard on kills/events
 */
export async function updateScoreLeaderboard(newScore: number): Promise<void> {
  try {
    const lb = await Wavadash.getLeaderboard(LEADERBOARS.SCORE_TOTAL);
    const currentUser = Wavadash.getUser();
    
    // Check if this is a new high score
    const allScores = await Wavadash.getLeaderboardEntries(lb.data.id, 10);
    const highestScore = Math.max(...allScores.map(e => e.score));
    
    if (newScore > highestScore) {
      await Wavadash.uploadLeaderboardScore(lb.data.id, newScore, true);
      
      // Award achievement
      if (newScore >= 1000) {
        Wavadash.setAchievement('first_1k_points', true);
      }
      if (newScore >= 5000) {
        Wavadash.setAchievement('elite_shooter', true);
      }
      
      console.log(`[Leaderboard] New high score: ${newScore}`);
    }
  } catch (error) {
    console.warn('[Leaderboard] Score update failed:', error);
  }
}

/**
 * Track longest survival time
 */
export async function trackSurvivalTime(elapsedSeconds: number): Promise<void> {
  try {
    const lb = await Wavadash.getLeaderboard(LEADERBOARD.BEST_TIME);
    
    // For time leaderboard, longer is better
    await Wavadash.uploadLeaderboardScore(lb.data.id, elapsedSeconds, true);
    
    console.log(`[Leaderboard] Survival time: ${elapsedSeconds}s`);
  } catch (error) {
    console.warn('[Leaderboard] Survival tracking failed:', error);
  }
}

/**
 * Load or create leaderboard with metadata
 */
async function loadOrCreateTimeScoredLeaderboard(): Promise<void> {
  try {
    const existing = await Wavedash.getLeaderboard(LEADERBOARDS.TIME_SCORED);
    console.log('[Leaderboard] Time-scored already exists:', existing?.data.id);
  } catch (e) {
    // Leaderboard doesn't exist, we'll need to create it first in Wavedash dashboard
    console.log('[Leaderboard] Creating time-scored leaderboard...');
    // In production, you'd use Wavedash.createLeaderboard() API
  }
}

/**
 * Get current session statistics
 */
export function getSessionStats() {
  return {
    elapsedTime: Wavadash.getTime(),
    currentScore: 0, // Will be updated by game loop
    personalBests: {},
  };
}

// Export for use in Game system
export { LEADERBOARDS };
