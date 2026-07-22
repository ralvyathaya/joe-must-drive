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
};

loaderRetry?.addEventListener('click', () => window.location.reload());

let game: Game | null = null;

const boot = async (): Promise<void> => {
  try {
    game = new Game(root);
    await game.prepare(updateLoading);
    game.start();
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
