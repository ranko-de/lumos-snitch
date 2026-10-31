import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { CONFIG } from '../config';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Pitch texture: painterly mown stripes, brush-stroke grass and chalk markings. */
export function makeGrassTexture(size: number): Texture {
  const [c, g] = canvas(size, size);
  const stripes = 18;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 === 0 ? '#5aa646' : '#67b351';
    g.fillRect((i * size) / stripes, 0, size / stripes + 1, size);
  }
  // Soft brush strokes in a few greens and yellows.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const strokes = Math.round(size * size * 0.0045);
  const tones = ['rgba(48,120,44,0.18)', 'rgba(140,190,80,0.16)', 'rgba(90,160,60,0.2)', 'rgba(200,220,110,0.08)'];
  g.lineCap = 'round';
  for (let i = 0; i < strokes; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const len = size * (0.004 + rnd() * 0.01);
    const a = -Math.PI / 2 + (rnd() - 0.5) * 0.9;
    g.strokeStyle = tones[Math.floor(rnd() * tones.length)];
    g.lineWidth = size * (0.0012 + rnd() * 0.002);
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + len * 0.2, y + Math.sin(a) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  // Big soft light patches (like a watercolour wash).
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = size * (0.04 + rnd() * 0.08);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, rnd() < 0.5 ? 'rgba(255,255,200,0.08)' : 'rgba(20,80,30,0.08)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Chalk lines (texture space: x = length, y = width), slightly hand-drawn.
  const cx = size / 2;
  const cy = size / 2;
  g.strokeStyle = 'rgba(250,250,238,0.9)';
  g.lineWidth = size / 260;
  g.beginPath();
  g.ellipse(cx, cy, size * 0.47, size * 0.47, 0, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, size * 0.06, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, size * 0.008, 0, Math.PI * 2);
  g.fillStyle = 'rgba(250,250,238,0.9)';
  g.fill();
  g.beginPath();
  g.moveTo(cx, cy - size * 0.47);
  g.lineTo(cx, cy + size * 0.47);
  g.stroke();
  const ringU = CONFIG.arena.ringX / CONFIG.arena.fieldA;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + side * ringU * size * 0.5, cy, size * 0.09, size * 0.2, 0, 0, Math.PI * 2);
    g.stroke();
  }
  return finish(c);
}

/** Soft painted cumulus cloud for billboards. */
export function makeCloudTexture(): Texture {
  const [c, g] = canvas(512, 256);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const puffs: [number, number, number][] = [];
  for (let i = 0; i < 14; i++) {
    const x = 90 + rnd() * 330;
    const y = 120 + (rnd() - 0.3) * 60 - Math.sin(((x - 90) / 330) * Math.PI) * 50;
    puffs.push([x, y, 38 + rnd() * 46]);
  }
  // Shadowed underside first, then bright tops.
  for (const [x, y, r] of puffs) {
    const grad = g.createRadialGradient(x, y + r * 0.35, r * 0.2, x, y + r * 0.35, r);
    grad.addColorStop(0, 'rgba(196,210,232,0.95)');
    grad.addColorStop(1, 'rgba(196,210,232,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y + r * 0.35, r, 0, Math.PI * 2);
    g.fill();
  }
  for (const [x, y, r] of puffs) {
    const grad = g.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.1, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return finish(c);
}

export function makeGlowTexture(inner = 'rgba(255,240,180,1)', outer = 'rgba(255,190,40,0)'): Texture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.7)'));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return finish(c);
}

export function makeMoonTexture(): Texture {
  const [c, g] = canvas(256, 256);
  const grad = g.createRadialGradient(110, 110, 20, 128, 128, 120);
  grad.addColorStop(0, '#fbfbf0');
  grad.addColorStop(1, '#cfd6e6');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(128, 128, 120, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(150,160,185,0.35)';
  for (const [x, y, r] of [
    [90, 100, 22],
    [160, 80, 14],
    [150, 160, 28],
    [80, 170, 12],
    [120, 130, 9],
  ]) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return finish(c);
}

/** Vertical stripes for tower walls. */
export function makeStripeTexture(a: string, b: string, stripes = 8): Texture {
  const [c, g] = canvas(256, 64);
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 === 0 ? a : b;
    g.fillRect((i * 256) / stripes, 0, 256 / stripes + 1, 64);
  }
  const t = finish(c);
  t.wrapS = RepeatWrapping;
  return t;
}

/** Banner pattern for flags: two colours with a simple emblem. */
export function makeFlagTexture(base: string, accent: string): Texture {
  const [c, g] = canvas(128, 64);
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = accent;
  g.fillRect(0, 26, 128, 12);
  g.beginPath();
  g.moveTo(64, 8);
  g.lineTo(76, 32);
  g.lineTo(64, 56);
  g.lineTo(52, 32);
  g.closePath();
  g.fill();
  return finish(c);
}
