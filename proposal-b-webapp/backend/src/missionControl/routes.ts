import { Router, Request, Response } from 'express';
import { requireAuth } from './auth';
import { createMissionAdapter } from './dataAdapter';
import { postToDiscordWebhook } from './discordWebhook';
import { appendActivity, getActivity, getPresence, touchPresence } from './activityStore';

export function createMissionControlRouter() {
  const r = Router();
  const adapter = createMissionAdapter();

  r.get('/kpis', requireAuth, async (_req: Request, res: Response) => {
    const kpis = await adapter.getKpis();
    res.json(kpis);
  });

  r.get('/accounts', requireAuth, async (_req: Request, res: Response) => {
    const items = await adapter.listAccounts();
    res.json({ items });
  });

  r.get('/accounts/:id', requireAuth, async (req: Request, res: Response) => {
    const id = req.params.id;
    const detail = await adapter.getAccountDetail(id);
    if (!detail) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Account not found' });
      return;
    }
    res.json(detail);
  });

  // Optional: post message to Discord via webhook (persona-style username)
  // Also records the post into Mission Control activity feed.
  r.post('/discord-webhook', requireAuth, async (req: Request, res: Response) => {
    const { persona, content } = (req.body ?? {}) as { persona?: string; content?: string };
    const text = String(content ?? '');
    const result = await postToDiscordWebhook({ persona, content: text });
    if (!result.ok) {
      res.status(400).json({ code: 'WEBHOOK_ERROR', message: result.error });
      return;
    }
    appendActivity({ persona: String(persona ?? 'moru'), kind: 'info', text: text.slice(0, 2000) });
    res.json({ ok: true });
  });

  // Activity feed (read)
  r.get('/activity', requireAuth, async (req: Request, res: Response) => {
    const limit = Number(req.query.limit ?? 50);
    res.json({ items: getActivity(Number.isFinite(limit) ? limit : 50) });
  });

  // Activity feed (write) - used to mirror chat-like command logs (T# threads)
  r.post('/activity', requireAuth, async (req: Request, res: Response) => {
    const { persona, to, kind, ticket, text } = (req.body ?? {}) as {
      persona?: string;
      to?: string;
      kind?: 'info' | 'doing' | 'done' | 'blocked';
      ticket?: string;
      text?: string;
    };

    const safePersona = String(persona ?? 'moru');
    const safeKind = (kind === 'doing' || kind === 'done' || kind === 'blocked' || kind === 'info') ? kind : 'info';
    const safeTo = to ? String(to).slice(0, 30) : undefined;
    const safeTicket = ticket ? String(ticket).slice(0, 50) : undefined;
    const safeText = String(text ?? '').slice(0, 4000);

    if (!safeText.trim()) {
      res.status(400).json({ code: 'BAD_REQUEST', message: 'text is required' });
      return;
    }

    const ev = appendActivity({ persona: safePersona, to: safeTo, kind: safeKind, ticket: safeTicket, text: safeText });
    res.json({ ok: true, item: ev });
  });

  // Thread list (derived from activity events with ticket)
  r.get('/threads', requireAuth, async (req: Request, res: Response) => {
    const limit = Number(req.query.limit ?? 50);
    const items = getActivity(200)
      .filter((a) => Boolean(a.ticket))
      .slice(0, 200);

    const map = new Map<
      string,
      {
        ticket: string;
        lastTs: string;
        lastText: string;
        lastPersona: string;
        lastKind: string;
        messages: number;
      }
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

  // Thread messages
  r.get('/threads/:ticket', requireAuth, async (req: Request, res: Response) => {
    const ticket = String(req.params.ticket ?? '');
    if (!ticket) {
      res.status(400).json({ code: 'BAD_REQUEST', message: 'ticket is required' });
      return;
    }
    const limit = Number(req.query.limit ?? 100);
    const msgs = getActivity(200)
      .filter((a) => String(a.ticket ?? '') === ticket)
      .slice(0, Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 100)
      .reverse(); // oldest->newest for chat UI

    res.json({ ticket, items: msgs });
  });

  // Presence (read)
  r.get('/presence', requireAuth, async (_req: Request, res: Response) => {
    res.json({ presence: getPresence() });
  });

  // Presence (touch)
  r.post('/presence', requireAuth, async (req: Request, res: Response) => {
    const { persona } = (req.body ?? {}) as { persona?: string };
    const row = touchPresence(String(persona ?? 'moru'));
    res.json({ ok: true, ...row });
  });

  return r;
}
