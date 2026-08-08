import './styles.css';
import { Game } from './game/Game';
import type { BootProgress } from './core/boot';

// Import Wavedash SDK (will be available in WaveDash environment)
// In local dev, this will be undefined but won't break anything
let Wavedash: any = null;
try {
  // @ts-ignore - Dynamic import for Wavedash SDK
  Wavedash = await import('@wvdsh/sdk-js');
} catch {
  console.log('WaveDash not available in local development');
}

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Missing #app mount point.');
}

const loader = document.querySelector<HTMLElement>('#boot-loader');
const loaderFill = document.querySelector<HTMLElement>('#boot-loader-fill');
const loaderStage = document.querySelector<HTMLElement>('#boot-loader-stage');
const loaderPercent = document.querySelector<HTMLElement>('#boot-loader-percent');
const loaderRetry = document.querySelector<HTMLButtonElement>('#boot-loader-retry');

const updateLoading = ({ stage, percent }: BootProgress): void => {
  if (loaderFill) loaderFill.style.width = `${percent}%`;
  if (loaderStage) loaderStage.textContent = stage;
  if (loaderPercent) loaderPercent.textContent = `${percent}%`;
};

loaderRetry?.addEventListener('click', () => window.location.reload());

let game: Game | null = null;

const boot = async (): Promise<void> => {
  try {
    game = new Game(root);
    await game.prepare(updateLoading);
    game.start();
    
    // Initialize Wavedash once the game is fully loaded and ready to play
    if (Wavedash && Wavedash.default) {
      const wavedashSDK = Wavedash.default;
      console.log('[Wavedash] Initializing...', wavedashSDK);
      
      try {
        await wavedashSDK.init({ debug: true });
        console.log('[Wavedash] Initialization complete');
      } catch (error) {
        console.warn('[Wavedash] Init failed (expected in local dev):', error);
        // Don't fail the game initialization - just warn
      }
    } else {
      console.log('[Wavedash] Not available - running locally without platform features');
    }
    
    if (loader) {
      loader.dataset.hidden = 'true';
      window.setTimeout(() => loader.remove(), 240);
    }
  } catch (error) {
    console.error('[boot] Preflight failed.', error);
    if (loaderStage) loaderStage.textContent = 'Loading failed';
    if (loaderRetry) loaderRetry.hidden = false;
  }
};

void boot();

window.addEventListener('beforeunload', () => {
  game?.destroy();
});
