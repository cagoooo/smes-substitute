#!/usr/bin/env node
// 生成 1200×630 OG 社群預覽圖（繁中，本機微軟正黑體，不 tofu）。
import { writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'docs', 'og-preview.png');

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

const W = 1200, H = 630;
const c = createCanvas(W, H);
const ctx = c.getContext('2d');

// 背景漸層
const g = ctx.createLinearGradient(0, 0, W, H);
g.addColorStop(0, '#1e3a8a');
g.addColorStop(1, '#2563eb');
ctx.fillStyle = g;
ctx.fillRect(0, 0, W, H);

// 右側裝飾大日曆
function calendar(cx, cy, s) {
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, cx, cy, s, s * 0.94, s * 0.08); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.20;
  roundRect(ctx, cx, cy, s, s * 0.24, s * 0.08); ctx.fill();
  ctx.restore();
}
calendar(830, 150, 320);

// 標籤膠囊
ctx.fillStyle = 'rgba(255,255,255,0.16)';
roundRect(ctx, 80, 92, 300, 52, 26); ctx.fill();
ctx.fillStyle = '#dbeafe';
ctx.font = '26px JhengHeiBold';
ctx.textAlign = 'left';
ctx.textBaseline = 'middle';
ctx.fillText('桃園市龍潭區石門國民小學', 104, 119);

// 主標題（兩行）
ctx.fillStyle = '#ffffff';
ctx.font = '96px JhengHeiBold';
ctx.fillText('線上調代課系統', 80, 250);

// 副標
ctx.fillStyle = '#bfdbfe';
ctx.font = '38px JhengHei';
ctx.fillText('查課表 · 找人代課 · 節次調課', 82, 360);
ctx.fillText('教學組出單 · 兼代課鐘點結算', 82, 418);

// 網址膠囊
ctx.fillStyle = '#ffffff';
roundRect(ctx, 80, 500, 610, 62, 31); ctx.fill();
ctx.fillStyle = '#1d4ed8';
ctx.font = '28px JhengHeiBold';
ctx.fillText('cagoooo.github.io/smes-substitute →', 108, 532);

writeFileSync(OUT, c.toBuffer('image/png'));
console.log('✨ OG 圖已生成：', OUT);
