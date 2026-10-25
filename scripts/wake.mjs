#!/usr/bin/env node
/**
 * wake.mjs —— WorkBuddy 云端托管服务心跳唤醒器（零依赖）
 *
 * 打法：GET {ENDPOINT}/health（公网无鉴权端点），确认 ok===true，
 * 并把当前 tickCount 与上一次记录的基线做比较，输出到 GitHub Actions 的 Job Summary。
 *
 * 退出码：
 *   0  服务存活（tickCount 未增长只算提示，不算失败——冷启动时一轮还没跑完）
 *   1  连不上 / 非 200 / ok 不为 true（Actions 会标红并给你发失败通知）
 *
 * 环境变量：
 *   WBMON_ENDPOINT  服务地址，默认见 DEFAULT_ENDPOINT
 *   WAKE_TRIES      最多尝试次数，默认 4
 *   WAKE_GAP_MS     两次尝试间隔毫秒，默认 15000
 *   WAKE_TIMEOUT_MS 单次请求超时毫秒，默认 45000
 *   WAKE_STATE      状态文件路径，默认 ./.wake-state.json
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_ENDPOINT = 'https://wb-cloud-worker-10850.app.workbuddy.host';
const ENDPOINT = String(process.env.WBMON_ENDPOINT || DEFAULT_ENDPOINT).trim().replace(/\/+$/, '');
const TRIES = Math.max(1, Number(process.env.WAKE_TRIES || 4));
const GAP_MS = Math.max(0, Number(process.env.WAKE_GAP_MS || 15000));
const TIMEOUT_MS = Math.max(1000, Number(process.env.WAKE_TIMEOUT_MS || 45000));
const STATE_PATH = process.env.WAKE_STATE || path.join(process.cwd(), '.wake-state.json');
const SUMMARY = process.env.GITHUB_STEP_SUMMARY || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadState() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

function saveState(s) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 1));
  } catch (e) {
    console.error('[wake] 状态写入失败：' + e.message);
  }
}

async function hit() {
  const url = ENDPOINT + '/health';
  const started = Date.now();
  try {
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'wbmon-waker/1.0 (+github-actions)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: r.status === 200 && !!json && json.ok === true, status: r.status, json, raw: text.slice(0, 600), ms: Date.now() - started };
  } catch (e) {
    return { ok: false, status: -1, json: null, raw: String((e && e.message) || e), ms: Date.now() - started };
  }
}

function emit(md) {
  if (SUMMARY) {
    try { fs.appendFileSync(SUMMARY, md + '\n'); } catch {}
  }
}

const stamp = () =>
  new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ') + ' (UTC+8)';

async function main() {
  const prev = loadState();
  const prevTick = Number.isFinite(prev.tickCount) ? prev.tickCount : null;

  console.log(`[wake] 目标 ${ENDPOINT}/health，最多 ${TRIES} 次尝试`);
  let res = null;
  for (let i = 1; i <= TRIES; i++) {
    res = await hit();
    if (res.ok) {
      console.log(`[wake] 第 ${i} 次尝试成功（HTTP ${res.status}，${res.ms}ms）`);
      break;
    }
    console.log(`[wake] 第 ${i} 次尝试失败（HTTP ${res.status}，${res.ms}ms）：${res.raw.slice(0, 160)}`);
    if (i < TRIES && GAP_MS) await sleep(GAP_MS);
  }

  const d = (res && res.json) || {};
  const tick = Number.isFinite(d.tickCount) ? d.tickCount : null;

  // tick 变化判定
  let tickNote = '';
  let tickState = 'unknown';
  if (tick != null && prevTick != null) {
    if (tick > prevTick) { tickState = 'advanced'; tickNote = `较上次 +${tick - prevTick}（${prevTick} → ${tick}）`; }
    else if (tick === prevTick) { tickState = 'same'; tickNote = `与上次相同（${tick}），可能是冷启动后这一轮还没跑完`; }
    else { tickState = 'reset'; tickNote = `比上次更小（${prevTick} → ${tick}），服务状态被重置过`; }
  } else if (tick != null) {
    tickState = 'first';
    tickNote = `首次记录基线 ${tick}`;
  }

  const alive = !!(res && res.ok);
  const staleH = d.staleHours;
  const staleBad = typeof staleH === 'number' && staleH > 26;
  const alerts = Array.isArray(d.alerts) ? d.alerts : [];

  // ---------- 控制台 ----------
  if (alive) {
    console.log(`[wake] ✅ 存活 | tickCount=${tick} | uptime=${d.uptimeMinutes}min | 令牌剩 ${d.tokenDaysMin} 天 | staleHours=${staleH}`);
    if (tickNote) console.log(`[wake] tick：${tickNote}`);
    if (alerts.length) console.log(`[wake] ⚠️ 告警：${alerts.join(', ')}`);
  } else {
    console.error('[wake] ❌ 唤醒失败：' + ((res && res.raw) || '无返回'));
  }

  // ---------- Job Summary ----------
  const rows = [
    ['结果', alive ? '✅ 存活' : '❌ 失败'],
    ['时间', stamp()],
    ['地址', ENDPOINT + '/health'],
    ['HTTP', res ? String(res.status) : '-'],
    ['耗时', res ? res.ms + 'ms' : '-'],
    ['tickCount', tick == null ? '-' : String(tick)],
    ['tick 对比', tickNote || '-'],
    ['运行时长', d.uptimeMinutes == null ? '-' : d.uptimeMinutes + ' 分钟'],
    ['上次 tick', d.lastTickAt || '-'],
    ['staleHours', staleH == null ? '-' : String(staleH)],
    ['令牌剩余', d.tokenDaysMin == null ? '-' : d.tokenDaysMin + ' 天'],
    ['告警', alerts.length ? alerts.join(', ') : '无'],
  ];
  emit(`## ${alive ? '🌤 唤醒成功' : '🚨 唤醒失败'}`);
  emit('');
  emit('| 项 | 值 |');
  emit('| --- | --- |');
  for (const [k, v] of rows) emit(`| ${k} | ${v} |`);
  if (!alive) {
    emit('');
    emit('原始返回：');
    emit('```');
    emit(String((res && res.raw) || '（空）'));
    emit('```');
  }
  if (staleBad) {
    emit('');
    emit(`> ⚠️ staleHours=${staleH}，超过 26 小时没有成功 tick，业务链路可能已停摆。`);
  }

  saveState({
    endpoint: ENDPOINT,
    tickCount: tick != null ? tick : prevTick,
    lastOkAt: d.lastOkAt || prev.lastOkAt || null,
    checkedAt: new Date().toISOString(),
    alive,
  });

  // 只要服务能自证 ok=true 就算成功；tick 不涨 / 有告警只做提示，不误报红
  process.exit(alive ? 0 : 1);
}

main().catch((e) => {
  console.error('[wake] 未捕获异常：' + (e && e.stack || e));
  process.exit(1);
});
