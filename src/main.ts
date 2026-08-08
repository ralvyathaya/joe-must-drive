import './styles.css';
import { Game } from './game/Game';
import type { BootProgress } from './core/boot';

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
  
  // Update progress for WaveDash if available
  const wavedash = (window as any).Wavedash;
  if (wavedash && typeof wavedash.updateLoadProgressZeroToOne === 'function') {
    try {
      wavedash.updateLoadProgressZeroToOne(percent / 100);
    } catch (e) {
      console.warn('[WaveDash] Progress update failed:', e);
    }
  }
};

loaderRetry?.addEventListener('click', () => window.location.reload());

let game: Game | null = null;

const boot = async (): Promise<void> => {
  try {
    game = new Game(root);
    await game.prepare(updateLoading);
    
    game.start();
    
    // Initialize WaveDash after game is fully loaded
    game.markAsReadyForWaveDash();
    
    if (loader) {
      // For WaveDash environment, completely remove loader immediately
      // to prevent any z-index issues from blocking interaction
      const wavedash = (window as any).Wavedash;
      
      if (wavedash && typeof wavedash.init === 'function') {
        console.log('[Main] In Wavedash environment - removing loader');
        loader.remove();
      } else {
        console.log('[Main] Local dev mode');
        loader.style.display = 'none';
        window.setTimeout(() => loader.remove(), 10);
      }
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

