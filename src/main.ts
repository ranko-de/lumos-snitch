import './ui/style.css';
import { App } from './app';

function boot(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  const hud = document.getElementById('hud');
  const screens = document.getElementById('screens');
  if (!canvas || !hud || !screens) throw new Error('Missing page elements');
  const app = new App(canvas, hud, screens);
  app.start();
  // Handle for manual testing in the browser console / automated checks.
  (window as unknown as { __lumos: App }).__lumos = app;
}

boot();
