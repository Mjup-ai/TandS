#!/usr/bin/env node
/**
 * Discord → Mission Control (mc-lite) bridge
 *
 * Polls a Discord channel using the local `clawdbot message read` CLI,
 * forwards new messages into mc-lite activity store as persona=shiki,
 * and posts an acknowledgement back to Discord.
 *
 * This is intentionally minimal, file-stateful, and "best effort".
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);

const DEFAULT_CHANNEL_ID = '1476003697623568466';
const DEFAULT_STATE_PATH = path.resolve(process.cwd(), 'state.json');

function env(name, fallback) {
  const v = process.env[name];
  return v == null || v === '' ? fallback : v;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function makeMcAuthCookie(password) {
  // Must match mc-lite/src/auth.ts
  const value = JSON.stringify({ v: 1, ts: Date.now() });
  const sig = sign(value, password);
  const token = base64url(value) + '.' + sig;
  return `mc_auth=${token}`;
}

async function loadState(statePath) {
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      lastSeenId: typeof parsed?.lastSeenId === 'string' ? parsed.lastSeenId : undefined,
    };
  } catch {
    return { lastSeenId: undefined };
  }
}

async function saveState(statePath, state) {
  const tmp = `${statePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, statePath);
}

async function clawRead({ target, after, limit }) {
  const args = ['message', 'read', '--channel', 'discord', '--target', target, '--json'];
  if (limit != null) args.push('--limit', String(limit));
  if (after) args.push('--after', after);

  const clawdbotBin = env('CLAWDBOT_BIN', 'clawdbot');
  const { stdout } = await execFileAsync(clawdbotBin, args, {
    maxBuffer: 10 * 1024 * 1024,
  });

  const parsed = JSON.parse(stdout);
  const root = parsed?.payload ?? parsed;
  // Tool output shape variants:
  // - { ok, messages: [...] }
  // - { items: [...] }
  // - { payload: { ok, messages: [...] } }
  const items = Array.isArray(root?.messages)
    ? root.messages
    : Array.isArray(root?.items)
      ? root.items
      : Array.isArray(root)
        ? root
        : [];
  return items;
}

async function clawSend({ target, message }) {
  const args = ['message', 'send', '--channel', 'discord', '--target', target, '--message', message];
  const clawdbotBin = env('CLAWDBOT_BIN', 'clawdbot');
  await execFileAsync(clawdbotBin, args, { maxBuffer: 2 * 1024 * 1024 });
}

function isBridgeAck(msg, ackPrefix) {
  const text = typeof msg?.text === 'string' ? msg.text : (typeof msg?.content === 'string' ? msg.content : '');
  return text.startsWith(ackPrefix);
}

function getMsgId(msg) {
  return typeof msg?.id === 'string' ? msg.id : (typeof msg?.messageId === 'string' ? msg.messageId : undefined);
}

function getMsgText(msg) {
  return typeof msg?.text === 'string' ? msg.text : (typeof msg?.content === 'string' ? msg.content : '');
}

function getAuthorLabel(msg) {
  const name =
    (typeof msg?.author === 'string' ? msg.author : undefined) ||
    (typeof msg?.authorName === 'string' ? msg.authorName : undefined) ||
    (typeof msg?.username === 'string' ? msg.username : undefined) ||
    (typeof msg?.author?.username === 'string' ? msg.author.username : undefined) ||
    'unknown';
  return name;
}

function getWebhookId(msg) {
  return typeof msg?.webhook_id === 'string' ? msg.webhook_id : (typeof msg?.webhookId === 'string' ? msg.webhookId : undefined);
}

function parseMirroredHeader(text) {
  // Expected: 【info】T#294 mjup → shiki
  const line = String(text || '').split(/\r?\n/)[0] || '';
  const m = line.match(/^【([^】]+)】\s*(T#\d+)?\s*([a-z0-9_-]+)\s*(?:→\s*([a-z0-9_-]+))?/i);
  if (!m) return null;
  return {
    kind: m[1]?.trim() || 'info',
    ticket: m[2] || undefined,
    from: (m[3] || '').toLowerCase(),
    to: m[4] ? m[4].toLowerCase() : undefined,
  };
}

function getPermalinkHint(msg) {
  // We may not have a permalink in the CLI output. Keep best-effort metadata only.
  const ts = typeof msg?.ts === 'string' ? msg.ts : (typeof msg?.timestamp === 'string' ? msg.timestamp : undefined);
  return ts ? `ts=${ts}` : undefined;
}

async function postMcActivity({ baseUrl, password, persona, text, kind = 'info', to, ticket }) {
  const url = new URL('/api/mission/activity', baseUrl).toString();
  const cookie = makeMcAuthCookie(password);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
    },
    body: JSON.stringify({ persona, kind, to, ticket, text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`mc-lite POST /api/mission/activity failed: ${res.status} ${res.statusText} ${body}`);
  }

  return res.json().catch(() => ({}));
}

async function main() {
  const discordChannelId = env('DISCORD_CHANNEL_ID', DEFAULT_CHANNEL_ID);
  const discordTarget = env('DISCORD_TARGET', `channel:${discordChannelId}`);
  const statePath = env('BRIDGE_STATE_PATH', DEFAULT_STATE_PATH);

  const mcBaseUrl = env('MISSION_CONTROL_BASE_URL', 'http://127.0.0.1:3000');
  const mcPassword = env('MISSION_CONTROL_PASSWORD', '');
  if (!mcPassword) {
    console.error('MISSION_CONTROL_PASSWORD is required (must match mc-lite)');
    process.exit(2);
  }

  const persona = env('MC_PERSONA', 'shiki');
  const pollIntervalMs = Number(env('POLL_INTERVAL_MS', '15000'));
  const limit = Number(env('READ_LIMIT', '50'));

  const ackPrefix = env('ACK_PREFIX', '[auto-bridge]');
  const includeAck = env('POST_ACK', '1') !== '0';
  const ignoreAuthors = new Set(
    env('IGNORE_AUTHORS', 'Mission Control,Spidey Bot').split(',').map((s) => s.trim()).filter(Boolean),
  );
  const ignoreWebhookMessages = env('IGNORE_WEBHOOK_MESSAGES', '1') !== '0';
  const requireTo = env('REQUIRE_TO', '1') !== '0';

  const mode = process.argv.includes('--backfill') ? 'backfill' : 'tail';
  const backfillN = (() => {
    const i = process.argv.indexOf('--backfill');
    if (i !== -1 && process.argv[i + 1] && /^\d+$/.test(process.argv[i + 1])) return Number(process.argv[i + 1]);
    return 20;
  })();

  await fs.mkdir(path.dirname(statePath), { recursive: true }).catch(() => {});
  const state = await loadState(statePath);

  // On first run (tail mode), do NOT replay history. Start from latest message id.
  if (!state.lastSeenId && mode === 'tail') {
    const latest = await clawRead({ target: discordTarget, limit: 1 });
    const last = latest?.[0];
    const lastId = last ? getMsgId(last) : undefined;
    if (lastId) {
      state.lastSeenId = lastId;
      await saveState(statePath, state);
      console.log(`[bridge] initialized lastSeenId=${lastId}`);
    }
  }

  console.log(
    `[bridge] running: discordTarget=${discordTarget} mcBaseUrl=${mcBaseUrl} persona=${persona} state=${statePath} interval=${pollIntervalMs}ms`,
  );

  let backoffMs = 1000;

  for (;;) {
    try {
      const after = state.lastSeenId;
      const readLimit = mode === 'backfill' && !after ? backfillN : limit;

      const msgs = await clawRead({ target: discordTarget, after, limit: readLimit });
      // Expect chronological? Many APIs return newest-first; we normalize to oldest-first.
      const ordered = [...msgs].sort((a, b) => {
        const ai = BigInt(getMsgId(a) ?? '0');
        const bi = BigInt(getMsgId(b) ?? '0');
        return ai < bi ? -1 : ai > bi ? 1 : 0;
      });

      for (const msg of ordered) {
        const id = getMsgId(msg);
        if (!id) continue;

        // Skip our own acknowledgements to avoid a loop.
        if (isBridgeAck(msg, ackPrefix)) {
          state.lastSeenId = id;
          continue;
        }

        const text = getMsgText(msg);
        if (!text.trim()) {
          state.lastSeenId = id;
          continue;
        }

        const author = getAuthorLabel(msg);
        const webhookId = getWebhookId(msg);
        const hint = getPermalinkHint(msg);

        if (ignoreAuthors.has(author)) {
          state.lastSeenId = id;
          continue;
        }
        if (ignoreWebhookMessages && webhookId) {
          state.lastSeenId = id;
          continue;
        }

        const header = parseMirroredHeader(text);
        if (requireTo && !header?.to) {
          state.lastSeenId = id;
          continue;
        }

        const mcTextLines = [
          `Discord→MC forwarded (automated)`,
          `from: ${author}`,
          `source: ${discordTarget}${hint ? ` (${hint})` : ''}`, 
          header?.to ? `to: ${header.to}` : '',
          header?.ticket ? `ticket: ${header.ticket}` : '',
          '',
          text,
        ].filter(Boolean);

        await postMcActivity({
          baseUrl: mcBaseUrl,
          password: mcPassword,
          persona,
          to: header?.to,
          ticket: header?.ticket,
          kind: 'info',
          text: mcTextLines.join('\n').slice(0, 4000),
        });

        if (includeAck) {
          const who = header?.to ?? persona;
          const ticket = header?.ticket ? `${header.ticket} ` : '';
          const ack = `${ackPrefix} ${ticket}${who} 受領（自動）: 返事/実行ブリッジ稼働中。msgId=${id}`;
          await clawSend({ target: discordTarget, message: ack });
          await sleep(750); // light rate-limit
        }

        state.lastSeenId = id;
        await saveState(statePath, state);
      }

      // Reset backoff on success.
      backoffMs = 1000;
      await sleep(pollIntervalMs);
    } catch (err) {
      console.error('[bridge] error:', err?.stack || String(err));
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 5 * 60 * 1000);
    }
  }
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exit(1);
});
