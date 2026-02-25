import type { MissionAccountDetail, MissionAccountSummary, MissionKpis } from '../types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

const USE_MOCK = (import.meta as any).env?.VITE_USE_MOCK === '1';

function mockKpis(): MissionKpis {
  return {
    totalAccounts: 3,
    accountsRed: 0,
    accountsYellow: 1,
    accountsGreen: 2,
    inactiveLearners: 4,
    submissionsCount: 12,
  };
}

function mockAccounts(): { items: MissionAccountSummary[] } {
  return {
    items: [
      { id: 't1', name: 'サンプル事業所A', status: 'green', lastContactAt: new Date().toISOString(), todos: ['週次レポ送付', '滞留者フォロー'] },
      { id: 't2', name: 'サンプル事業所B', status: 'yellow', lastContactAt: new Date(Date.now() - 3 * 86400000).toISOString(), todos: ['提出率改善', '窓口再設定'] },
      { id: 't3', name: 'サンプル事業所C', status: 'green', lastContactAt: new Date(Date.now() - 1 * 86400000).toISOString(), todos: ['月次レポ準備'] },
    ],
  };
}

function mockAccountDetail(id: string): MissionAccountDetail {
  const account: MissionAccountSummary = {
    id,
    name: id === 't2' ? 'サンプル事業所B' : id === 't3' ? 'サンプル事業所C' : 'サンプル事業所A',
    status: id === 't2' ? 'yellow' : 'green',
    lastContactAt: new Date().toISOString(),
    todos: ['週次サマリ送付'],
  };
  return {
    account,
    learners: [
      { id: 'l1', displayName: '利用者A', lastActivityAt: new Date(Date.now() - 2 * 86400000).toISOString(), submissions30d: 3 },
      { id: 'l2', displayName: '利用者B', lastActivityAt: new Date(Date.now() - 9 * 86400000).toISOString(), submissions30d: 0 },
      { id: 'l3', displayName: '利用者C', lastActivityAt: null, submissions30d: 1 },
    ],
  };
}

export async function authMe(): Promise<{ authenticated: boolean }> {
  if (USE_MOCK) return { authenticated: true };
  return json(await fetch('/api/auth/me'));
}

export async function authLogin(password: string): Promise<void> {
  if (USE_MOCK) return;
  await json(await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) }));
}

export async function authLogout(): Promise<void> {
  if (USE_MOCK) return;
  await json(await fetch('/api/auth/logout', { method: 'POST' }));
}

export async function getKpis(): Promise<MissionKpis> {
  if (USE_MOCK) return mockKpis();
  return json(await fetch('/api/mission/kpis'));
}

export async function listAccounts(): Promise<{ items: MissionAccountSummary[] }> {
  if (USE_MOCK) return mockAccounts();
  return json(await fetch('/api/mission/accounts'));
}

export async function getAccountDetail(id: string): Promise<MissionAccountDetail> {
  if (USE_MOCK) return mockAccountDetail(id);
  return json(await fetch(`/api/mission/accounts/${encodeURIComponent(id)}`));
}

export async function postDiscordWebhook(input: { persona: string; content: string }): Promise<{ ok: true }> {
  if (USE_MOCK) return { ok: true };
  return json(
    await fetch('/api/mission/discord-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
}

export async function getActivity(limit = 50): Promise<{ items: Array<{ id: string; ts: string; persona: string; to?: string; kind: string; ticket?: string; text: string }> }> {
  if (USE_MOCK) {
    return {
      items: [
        { id: 'a1', ts: new Date().toISOString(), persona: 'shiki', kind: 'info', text: 'heartbeat: no updates' },
        { id: 'a2', ts: new Date(Date.now() - 60000).toISOString(), persona: 'kumi', kind: 'done', text: 'Deployed frontend to Vercel' },
      ],
    };
  }
  return json(await fetch(`/api/mission/activity?limit=${encodeURIComponent(String(limit))}`));
}

export async function getPresence(): Promise<{ presence: Record<string, { lastSeenAt: string }> }> {
  if (USE_MOCK) {
    const now = new Date().toISOString();
    return { presence: { shiki: { lastSeenAt: now }, kumi: { lastSeenAt: now } } };
  }
  return json(await fetch('/api/mission/presence'));
}

export type PersonaProfile = {
  key: string;
  displayName?: string;
  animal?: string;
  createdAt: string;
  lastSeenAt?: string;
  pinned?: boolean;
  order?: number;
};

export async function getPersonas(): Promise<{ items: PersonaProfile[] }> {
  if (USE_MOCK) {
    const now = new Date().toISOString();
    return {
      items: [
        { key: 'shiki', displayName: 'シキ', animal: '🐺', createdAt: now, pinned: true, order: 10 },
        { key: 'kumi', displayName: 'クミ', animal: '🐱', createdAt: now, pinned: true, order: 20 },
        { key: 'moru', displayName: 'もる', animal: '🦊', createdAt: now, pinned: true, order: 30 },
        { key: 'mjup', displayName: 'まーき', animal: '🦉', createdAt: now, pinned: true, order: 40 },
      ],
    };
  }
  return json(await fetch('/api/mission/personas'));
}

export type ThreadSummary = {
  ticket: string;
  lastTs: string;
  lastText: string;
  lastPersona: string;
  lastKind: string;
  messages: number;
};

export type ThreadMessage = { id: string; ts: string; persona: string; to?: string; kind: string; ticket?: string; text: string };

export async function getThreads(limit = 50): Promise<{ items: ThreadSummary[] }> {
  if (USE_MOCK) {
    const now = new Date().toISOString();
    return {
      items: [
        { ticket: 'T#100', lastTs: now, lastText: 'Next: implement chat UI', lastPersona: 'shiki', lastKind: 'doing', messages: 6 },
        { ticket: 'T#099', lastTs: now, lastText: 'Done: deployed presence', lastPersona: 'kumi', lastKind: 'done', messages: 3 },
      ],
    };
  }
  return json(await fetch(`/api/mission/threads?limit=${encodeURIComponent(String(limit))}`));
}

export async function getThreadMessages(ticket: string, limit = 100): Promise<{ ticket: string; items: ThreadMessage[] }> {
  if (USE_MOCK) {
    const base = Date.now() - 5 * 60000;
    return {
      ticket,
      items: [
        { id: 'm1', ts: new Date(base).toISOString(), persona: 'shiki', kind: 'doing', ticket, text: 'Chat UIを最短で作る' },
        { id: 'm2', ts: new Date(base + 60000).toISOString(), persona: 'kumi', kind: 'info', ticket, text: '了解、左スレッド/右吹き出しでいく' },
        { id: 'm3', ts: new Date(base + 120000).toISOString(), persona: 'shiki', kind: 'info', ticket, text: 'OK、10秒更新でまず出す' },
      ],
    };
  }
  return json(await fetch(`/api/mission/threads/${encodeURIComponent(ticket)}?limit=${encodeURIComponent(String(limit))}`));
}

export async function getQueueSummary(): Promise<{ ok: true; counts: Record<string, number>; overdue: number }> {
  if (USE_MOCK) return { ok: true, counts: { queued: 2, running: 1, dlq: 0, succeeded: 10 }, overdue: 0 } as any;
  return json(await fetch('/api/queue/summary'));
}

export type QueueTask = {
  id: string;
  kind: string;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  locked_by?: string | null;
  locked_at?: string | null;
  updated_at?: string;
  payload: any;
};

export async function getQueueRunning(limit = 20): Promise<{ ok: true; items: QueueTask[] }> {
  if (USE_MOCK) return { ok: true, items: [] } as any;
  return json(await fetch(`/api/queue/running?limit=${encodeURIComponent(String(limit))}`));
}

export async function postActivity(input: {
  persona: string;
  to?: string;
  kind?: 'info' | 'doing' | 'done' | 'blocked';
  ticket?: string;
  text: string;
}): Promise<{ ok: true }> {
  if (USE_MOCK) return { ok: true } as any;
  return json(
    await fetch('/api/mission/activity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
}
