#!/usr/bin/env node
/**
 * Mission Control intake monitor
 * - Posts a synthetic intake message to #mc-intake
 * - Waits a bit
 * - Queries mc-lite for a Plan for that ticket
 * - Alerts #moru-control if missing
 */

import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function env(name, fallback) {
  const v = process.env[name];
  return v == null || v === '' ? fallback : v;
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function makeMcAuthCookie(password) {
  const value = JSON.stringify({ v: 1, ts: Date.now() });
  const sig = sign(value, password);
  const token = Buffer.from(value).toString('base64url') + '.' + sig;
  return `mc_auth=${token}`;
}

async function clawSend({ target, message }) {
  const clawdbotBin = env('CLAWDBOT_BIN', 'clawdbot');
  const args = ['message', 'send', '--channel', 'discord', '--target', target, '--message', message];
  await execFileAsync(clawdbotBin, args, { maxBuffer: 2 * 1024 * 1024 });
}

async function fetchJson(url, cookie) {
  const res = await fetch(url, { headers: { cookie } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} ${body}`);
  }
  return res.json();
}

async function main() {
  const intakeChannelId = env('MC_INTAKE_CHANNEL_ID', '1476137938013393036');
  const controlChannelId = env('MC_CONTROL_CHANNEL_ID', '1468848280678039564');

  const mcBaseUrl = env('MISSION_CONTROL_BASE_URL', 'https://mc-lite.vercel.app');
  const mcPassword = env('MISSION_CONTROL_PASSWORD', '');
  if (!mcPassword) throw new Error('MISSION_CONTROL_PASSWORD is required');

  const cookie = makeMcAuthCookie(mcPassword);

  // 1) Post synthetic intake
  const nonce = Math.random().toString(36).slice(2, 8);
  const body = `監視ping ${new Date().toISOString()} nonce=${nonce}`;
  const msg = `【info】 mjup → shiki\nMONITOR: ${body}`;
  await clawSend({ target: `channel:${intakeChannelId}`, message: msg });

  // 2) Wait for bridge+worker to process
  const waitMs = Number(env('WAIT_MS', '12000'));
  await new Promise((r) => setTimeout(r, waitMs));

  // 3) Find the intake activity (by nonce)
  const act = await fetchJson(new URL('/api/mission/activity?limit=200', mcBaseUrl).toString(), cookie);
  const items = Array.isArray(act?.items) ? act.items : [];
  const intake = items.find((x) => x?.persona === 'intake' && String(x?.text || '').includes(`nonce=${nonce}`));

  if (!intake?.ticket) {
    await clawSend({
      target: `channel:${controlChannelId}`,
      message: `[ALERT] MC監視: intake反映が見つからない（nonce=${nonce}）。bridge停止の疑い。`,
    });
    return;
  }

  const ticket = String(intake.ticket);
  const plan = items.find((x) => x?.persona === 'shiki' && x?.ticket === ticket && String(x?.text || '').includes('[Plan]'));

  if (!plan) {
    await clawSend({
      target: `channel:${controlChannelId}`,
      message: `[ALERT] MC監視: Plan未生成（ticket=${ticket}）。worker停止/不整合の疑い。`,
    });
    return;
  }

  // Optional OK signal (disabled by default to avoid noise)
  if (env('POST_OK', '0') === '1') {
    await clawSend({
      target: `channel:${controlChannelId}`,
      message: `[OK] MC監視: ticket=${ticket} Plan生成まで確認。`,
    });
  }
}

main().catch(async (e) => {
  const controlChannelId = env('MC_CONTROL_CHANNEL_ID', '1468848280678039564');
  try {
    await clawSend({ target: `channel:${controlChannelId}`, message: `[ALERT] MC監視: monitor自体が例外で落ちた: ${String(e?.message || e)}` });
  } catch {
    // ignore
  }
  process.exit(2);
});
