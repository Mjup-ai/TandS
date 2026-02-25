import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { appendActivity, getActivity, getPresence, listPersonas, touchPresence, upsertPersona } from './activityStore.js';
import { clearAuthCookie, issueAuthCookie, isAuthenticated, requireAuth } from './auth.js';
import { cancelTask, enqueueTask, ensureSchema, getQueueSummary, listDlq, listRunning, retryTask } from './queueStore.js';

async function postToDiscordWebhook(input: { username?: string; content: string }) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: input.username ?? 'Mission Control',
        content: input.content,
        allowed_mentions: { parse: [] },
      }),
    });
  } catch {
    // best-effort
  }
}

// Ensure Postgres schema exists (best effort)
ensureSchema().catch(() => void 0);

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

function sendError(res: Response, code: string, message: string, status = 400) {
  res.status(status).json({ code, message });
}

app.get('/', (_req, res) => {
  res.type('text/plain').send('Mission Control backend (mc-lite) is running. Try /api/health');
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'mission-control-backend-lite' });
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  res.json({ authenticated: isAuthenticated(req) });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const expected = process.env.MISSION_CONTROL_PASSWORD ?? '';
  if (!expected) return sendError(res, 'SERVER_ERROR', 'MISSION_CONTROL_PASSWORD が未設定です', 500);
  if (password !== expected) return sendError(res, 'UNAUTHORIZED', 'パスワードが違います', 401);
  issueAuthCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/mission/activity', requireAuth, async (req: Request, res: Response) => {
  const limit = Number(req.query.limit ?? 50);
  res.json({ items: await getActivity(Number.isFinite(limit) ? limit : 50) });
});

app.post('/api/mission/activity', requireAuth, async (req: Request, res: Response) => {
  const { persona, to, kind, ticket, text } = (req.body ?? {}) as {
    persona?: string;
    to?: string;
    kind?: 'info' | 'doing' | 'done' | 'blocked';
    ticket?: string;
    text?: string;
  };

  const safePersona = String(persona ?? 'moru');
  const safeTo = to ? String(to).slice(0, 30) : undefined;
  const safeKind = kind === 'doing' || kind === 'done' || kind === 'blocked' || kind === 'info' ? kind : 'info';
  let safeTicket = ticket ? String(ticket).slice(0, 50) : undefined;
  // Intake messages should always get a ticket (so they become threads).
  if (!safeTicket && safePersona === 'intake') {
    safeTicket = `T#${Math.floor(Date.now() / 1000)}`;
  }
  const safeText = String(text ?? '').slice(0, 4000);

  if (!safeText.trim()) return sendError(res, 'BAD_REQUEST', 'text is required', 400);

  const ev = await appendActivity({ persona: safePersona, to: safeTo, kind: safeKind, ticket: safeTicket, text: safeText });

  // Enqueue for 24h processing (best effort)
  // Avoid infinite loops: worker-generated activities should not re-enqueue.
  const isAuto = safeText.startsWith('[auto-worker]') || safeText.startsWith('[auto-bridge]');
  if (!isAuto) {
    await enqueueTask({
      kind: 'mission.activity',
      payload: { persona: safePersona, to: safeTo, kind: safeKind, ticket: safeTicket, text: safeText, activityId: ev.id },
      priority: safeKind === 'blocked' ? 10 : safeKind === 'doing' ? 50 : 100,
      actor: safePersona,
    }).catch(() => void 0);
  }

  // Auto-mirror to Discord (best effort)
  const who = safePersona;
  const toLine = safeTo ? ` → ${safeTo}` : '';
  const ticketLine = safeTicket ? `${safeTicket} ` : '';
  const head = `【${safeKind}】${ticketLine}${who}${toLine}`;
  const body = safeText.length > 1800 ? safeText.slice(0, 1800) + '…' : safeText;
  await postToDiscordWebhook({ username: 'Mission Control', content: `${head}\n${body}` });

  res.json({ ok: true, item: ev });
});

app.get('/api/mission/presence', requireAuth, async (_req: Request, res: Response) => {
  res.json({ presence: await getPresence() });
});

app.post('/api/mission/presence', requireAuth, async (req: Request, res: Response) => {
  const persona = String(req.body?.persona ?? 'moru');
  const row = await touchPresence(persona);
  res.json({ ok: true, ...row });
});

app.post('/api/mission/discord-webhook', requireAuth, async (req: Request, res: Response) => {
  const persona = typeof req.body?.persona === 'string' ? req.body.persona : 'moru';
  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  if (!content.trim()) return sendError(res, 'BAD_REQUEST', 'content is required', 400);
  await postToDiscordWebhook({ username: persona, content });
  res.json({ ok: true });
});

app.get('/api/queue/summary', requireAuth, async (_req: Request, res: Response) => {
  res.json({ ok: true, ...(await getQueueSummary()) });
});

app.get('/api/queue/running', requireAuth, async (req: Request, res: Response) => {
  const limit = Number(req.query.limit ?? 20);
  res.json({ ok: true, items: await listRunning(Number.isFinite(limit) ? limit : 20) });
});

app.get('/api/queue/dlq', requireAuth, async (req: Request, res: Response) => {
  const limit = Number(req.query.limit ?? 20);
  res.json({ ok: true, items: await listDlq(Number.isFinite(limit) ? limit : 20) });
});

app.post('/api/queue/retry/:id', requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!id) return sendError(res, 'BAD_REQUEST', 'id is required', 400);
  await retryTask(id, 'mjup');
  res.json({ ok: true });
});

app.post('/api/queue/cancel/:id', requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!id) return sendError(res, 'BAD_REQUEST', 'id is required', 400);
  await cancelTask(id, 'mjup');
  res.json({ ok: true });
});

app.get('/api/mission/personas', requireAuth, async (_req: Request, res: Response) => {
  res.json({ items: await listPersonas() });
});

app.post('/api/mission/personas', requireAuth, async (req: Request, res: Response) => {
  const key = String(req.body?.key ?? '').toLowerCase();
  const displayName = req.body?.displayName != null ? String(req.body.displayName).slice(0, 30) : undefined;
  const animal = req.body?.animal != null ? String(req.body.animal).slice(0, 10) : undefined;
  const pinned = req.body?.pinned != null ? Boolean(req.body.pinned) : undefined;
  const order = req.body?.order != null ? Number(req.body.order) : undefined;

  if (!key) return sendError(res, 'BAD_REQUEST', 'key is required', 400);

  try {
    const item = await upsertPersona(key, {
      ...(displayName !== undefined ? { displayName } : {}),
      ...(animal !== undefined ? { animal } : {}),
      ...(pinned !== undefined ? { pinned } : {}),
      ...(Number.isFinite(order) ? { order } : {}),
    });
    res.json({ ok: true, item });
  } catch (e) {
    sendError(res, 'BAD_REQUEST', String(e), 400);
  }
});

app.get('/api/mission/threads', requireAuth, async (req: Request, res: Response) => {
  const limit = Number(req.query.limit ?? 50);
  const items = (await getActivity(500)).filter((a) => Boolean(a.ticket));

  const map = new Map<
    string,
    { ticket: string; lastTs: string; lastText: string; lastPersona: string; lastKind: string; messages: number }
  >();

  for (const a of items) {
    const t = String(a.ticket);
    const cur = map.get(t);
    if (!cur) {
      map.set(t, {
        ticket: t,
        lastTs: a.ts,
        lastText: a.text,
        lastPersona: a.persona,
        lastKind: a.kind,
        messages: 1,
      });
    } else {
      cur.messages += 1;
      if (a.ts > cur.lastTs) {
        cur.lastTs = a.ts;
        cur.lastText = a.text;
        cur.lastPersona = a.persona;
        cur.lastKind = a.kind;
      }
    }
  }

  const list = Array.from(map.values())
    .sort((a, b) => (a.lastTs < b.lastTs ? 1 : -1))
    .slice(0, Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 50);

  res.json({ items: list });
});

app.get('/api/mission/threads/:ticket', requireAuth, async (req: Request, res: Response) => {
  const ticket = String(req.params.ticket ?? '');
  const limit = Number(req.query.limit ?? 100);
  if (!ticket) return sendError(res, 'BAD_REQUEST', 'ticket is required', 400);

  const msgs = (await getActivity(500))
    .filter((a) => String(a.ticket ?? '') === ticket)
    .slice(0, Number.isFinite(limit) ? Math.max(1, Math.min(500, limit)) : 100)
    .reverse();

  res.json({ ticket, items: msgs });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`[mc-lite] listening on :${port}`);
});
