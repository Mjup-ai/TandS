import crypto from 'crypto';
import { ensureSchema, lockNextTask, markFailed, markSucceeded, type TaskRow } from './queueStore.js';

function env(name: string, fallback?: string) {
  const v = process.env[name];
  return v == null || v === '' ? fallback : v;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function sign(value: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function makeMcAuthCookie(password: string) {
  // Must match src/auth.ts
  const value = JSON.stringify({ v: 1, ts: Date.now() });
  const sig = sign(value, password);
  const token = Buffer.from(value).toString('base64url') + '.' + sig;
  return `mc_auth=${token}`;
}

async function postMcActivity(input: { baseUrl: string; password: string; persona: string; to?: string; kind: 'info' | 'doing' | 'done' | 'blocked'; ticket?: string; text: string }) {
  const url = new URL('/api/mission/activity', input.baseUrl).toString();
  const cookie = makeMcAuthCookie(input.password);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
    },
    body: JSON.stringify({
      persona: input.persona,
      to: input.to,
      kind: input.kind,
      ticket: input.ticket,
      text: input.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`postMcActivity failed: ${res.status} ${res.statusText} ${body}`);
  }
}

async function postDiscordWebhook(content: string) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  }).catch(() => void 0);
}

function summarizeTask(t: TaskRow) {
  const p = t.payload ?? {};
  const ticket = p.ticket ? `${p.ticket} ` : '';
  const from = p.persona ? String(p.persona) : 'unknown';
  const to = p.to ? ` → ${p.to}` : '';
  const first = String(p.text || '').split(/\r?\n/).find(Boolean) ?? '';
  return `${ticket}${from}${to} :: ${first}`;
}

function pickOwnerAndEta(text: string) {
  const t = (text || '').toLowerCase();
  if (/(ui|フロント|画面|office|mission control|オフィス|表示|レイアウト)/i.test(text)) return { owner: 'kumi', etaMin: 30 };
  if (/(db|sql|postgres|neon|queue|キュー|view|api|集計)/i.test(text)) return { owner: 'suu', etaMin: 30 };
  if (/(添削|課題|提出|fb|feedback)/i.test(text)) return { owner: 'kensaku', etaMin: 60 };
  if (/(line|問い合わせ|顧客|運用|週次|月次|赤黄緑|解約)/i.test(text)) return { owner: 'tsumugi', etaMin: 60 };
  return { owner: 'tsumugi', etaMin: 45 };
}

function needsApproval(text: string) {
  return /(請求|契約|クレーム|法務|法令|弁護士|自動送信|ルール変更)/.test(text || '');
}

function makePlanText(input: { ticket?: string; intakeText: string; owner: string; etaMin: number }) {
  const head = String(input.intakeText || '').split(/\r?\n/).find(Boolean) ?? '';
  const approval = needsApproval(input.intakeText) ? 'Yes（まーき承認）' : 'No';
  return [
    'KGI：MjupのAIサポート部隊として、Espict / Espict Stella のサポートを継続提供する。',
    '',
    `[Plan] ${input.ticket ?? ''}`.trim(),
    `要約：${head || '（本文参照）'}`,
    '',
    `Owner：${input.owner} / ETA：${input.etaMin}分`,
    `承認要否：${approval}`,
    '',
    '3ステップ：',
    '1) 事実確認（依頼の種類/期限/相手）',
    '2) 具体案作成（テンプレ/文面/修正案）',
    '3) 実行→報告（done/blocked）',
    '',
    'blocked条件：追加情報が必要なら Yes/No で質問して止める。',
  ].join('\n');
}

async function handleTask(t: TaskRow, ctx: { mcBaseUrl: string; mcPassword: string; workerId: string }) {
  if (t.kind === 'mission.activity') {
    const p = (t.payload ?? {}) as any;

    const ticket = typeof p.ticket === 'string' ? p.ticket : undefined;
    const from = typeof p.persona === 'string' ? p.persona : 'unknown';
    const to = typeof p.to === 'string' ? p.to : undefined;

    const first = String(p.text || '').split(/\r?\n/).find(Boolean) ?? '';

    // 1) Always acknowledge receipt into MC (so UI shows “someone picked it up”).
    const ackText = [
      '[auto-worker] 受領（自動）',
      ticket ? `対象: ${ticket}` : '',
      to ? `担当: ${to}` : '',
      first ? `内容: ${first}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    await postMcActivity({
      baseUrl: ctx.mcBaseUrl,
      password: ctx.mcPassword,
      persona: 'shiki',
      to: to ?? undefined,
      kind: 'doing',
      ticket,
      text: ackText,
    });

    // 2) Auto-plan for intake → shiki
    if (from === 'intake' && (to === 'shiki' || !to)) {
      const { owner, etaMin } = pickOwnerAndEta(String(p.text || ''));
      const planText = makePlanText({ ticket, intakeText: String(p.text || ''), owner, etaMin });
      await postMcActivity({
        baseUrl: ctx.mcBaseUrl,
        password: ctx.mcPassword,
        persona: 'shiki',
        to: owner,
        kind: 'info',
        ticket,
        text: planText,
      });
    }

    // 3) Optional: also ack into Discord #mission-control
    await postDiscordWebhook(`[auto-worker] 受領（自動）: ${summarizeTask(t)}`);

    return;
  }

  // Unknown kind: treat as failed (goes to retry/DLQ)
  throw new Error(`Unknown task kind: ${t.kind}`);
}

async function main() {
  const workerId = env('WORKER_ID', `worker-${Math.random().toString(36).slice(2, 8)}`)!;
  const mcBaseUrl = env('MISSION_CONTROL_BASE_URL', 'https://mc-lite.vercel.app')!;
  const mcPassword = env('MISSION_CONTROL_PASSWORD', 'MM123')!;

  const intervalMs = Number(env('POLL_INTERVAL_MS', '2500'));

  await ensureSchema();

  // loop
  for (;;) {
    const t = await lockNextTask({ workerId });
    if (!t) {
      await sleep(intervalMs);
      continue;
    }

    try {
      await handleTask(t, { mcBaseUrl, mcPassword, workerId });
      await markSucceeded({ taskId: t.id, workerId, detail: { ok: true } });
    } catch (e: any) {
      const err = e?.stack || String(e);
      await markFailed({ taskId: t.id, workerId, error: err });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
