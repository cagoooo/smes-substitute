#!/usr/bin/env node
// 生成 favicon 全套 + app icon（📅 調代課主題，藍色）。本機微軟正黑體，產物為 PNG 點陣，部署後不 tofu。
import { writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'docs');

for (const [p, name] of [['C:/Windows/Fonts/msjhbd.ttc', 'JhengHeiBold'], ['C:/Windows/Fonts/msjh.ttc', 'JhengHei']]) {
  if (existsSync(p)) GlobalFonts.registerFromPath(p, name);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 畫一張圖示：藍底 + 白色日曆 + 紅色標頭 + 「調」字
function drawIcon(size, { maskable = false } = {}) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const S = size;

  // 背景（maskable 填滿方形；一般版圓角）
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, '#3b82f6');
  g.addColorStop(1, '#1d4ed8');
  ctx.fillStyle = g;
  if (maskable) { ctx.fillRect(0, 0, S, S); } else { roundRect(ctx, 0, 0, S, S, S * 0.22); ctx.fill(); }

  // safe zone：maskable 主視覺縮到 ~62%
  const inset = maskable ? S * 0.19 : S * 0.16;
  const x = inset, y = inset * 1.05, w = S - inset * 2, h = S - inset * 2;

  // 日曆本體（白色圓角）
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, w, h, S * 0.08);
  ctx.fill();

  // 標頭紅帶
  ctx.fillStyle = '#ef4444';
  roundRect(ctx, x, y, w, h * 0.26, S * 0.08);
  ctx.fill();
  ctx.fillRect(x, y + h * 0.16, w, h * 0.10);

  // 掛環
  ctx.fillStyle = '#e2e8f0';
  const ringW = w * 0.08, ringH = h * 0.14;
  roundRect(ctx, x + w * 0.26, y - ringH * 0.45, ringW, ringH, ringW * 0.5); ctx.fill();
  roundRect(ctx, x + w * 0.66, y - ringH * 0.45, ringW, ringH, ringW * 0.5); ctx.fill();

  // 「調」字
  ctx.fillStyle = '#1d4ed8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(h * 0.5)}px JhengHeiBold`;
  ctx.fillText('調', x + w / 2, y + h * 0.63);

  return c;
}

function savePng(canvas, file) {
  writeFileSync(resolve(OUT, file), canvas.toBuffer('image/png'));
  console.log('  ✓', file);
}

console.log('生成 app icon：');
savePng(drawIcon(180), 'apple-touch-icon.png');
savePng(drawIcon(192), 'icon-192.png');
savePng(drawIcon(512), 'icon-512.png');
savePng(drawIcon(192, { maskable: true }), 'icon-192-maskable.png');
savePng(drawIcon(512, { maskable: true }), 'icon-512-maskable.png');

// favicon.ico（16/32/48 合成）
const icoBufs = [16, 32, 48].map(s => drawIcon(s).toBuffer('image/png'));
const ico = await pngToIco(icoBufs);
writeFileSync(resolve(OUT, 'favicon.ico'), ico);
console.log('  ✓ favicon.ico');

// favicon.svg（手寫向量，高 DPI 最清晰）
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1d4ed8"/>
  </linearGradient></defs>
  <rect width="100" height="100" rx="22" fill="url(#g)"/>
  <rect x="16" y="18" width="68" height="66" rx="8" fill="#fff"/>
  <path d="M16 26 a8 8 0 0 1 8-8 h52 a8 8 0 0 1 8 8 v9 H16 Z" fill="#ef4444"/>
  <rect x="30" y="12" width="8" height="14" rx="4" fill="#e2e8f0"/>
  <rect x="62" y="12" width="8" height="14" rx="4" fill="#e2e8f0"/>
  <text x="50" y="52" text-anchor="middle" dominant-baseline="central"
    font-family="'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif"
    font-weight="700" font-size="40" fill="#1d4ed8">調</text>
</svg>
`;
writeFileSync(resolve(OUT, 'favicon.svg'), svg);
console.log('  ✓ favicon.svg');
console.log('完成。');
