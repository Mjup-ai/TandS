import fs from 'fs';
import path from 'path';

export type ActivityKind = 'info' | 'doing' | 'done' | 'blocked';

export type ActivityEvent = {
  id: string;
  ts: string; // ISO
  persona: string;
  to?: string; // optional recipient persona (for routing/visibility)
  kind: ActivityKind;
  ticket?: string;
  text: string;
};

export type PresenceMap = Record<string, { lastSeenAt: string }>; // persona -> lastSeen

const STORE_PATH = path.resolve(process.cwd(), '../../..', 'memory', 'mission-control-activity.json');

type Store = {
  activity: ActivityEvent[];
  presence: PresenceMap;
};

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readStore(): Store {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      activity: Array.isArray(parsed.activity) ? parsed.activity : [],
      presence: parsed.presence && typeof parsed.presence === 'object' ? parsed.presence : {},
    };
  } catch {
    return { activity: [], presence: {} };
  }
}

function writeStore(store: Store) {
  ensureDir(STORE_PATH);
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function appendActivity(input: Omit<ActivityEvent, 'id' | 'ts'>) {
  const store = readStore();
  const now = new Date().toISOString();
  const ev: ActivityEvent = { id: uid(), ts: now, ...input };
  store.activity.unshift(ev);
  store.activity = store.activity.slice(0, 200);

  const key = (input.persona || 'moru').toLowerCase();
  store.presence[key] = { lastSeenAt: now };

  writeStore(store);
  return ev;
}

export function touchPresence(persona: string) {
  const store = readStore();
  const now = new Date().toISOString();
  const key = (persona || 'moru').toLowerCase();
  store.presence[key] = { lastSeenAt: now };
  writeStore(store);
  return store.presence[key];
}

export function getActivity(limit = 50) {
  const store = readStore();
  return store.activity.slice(0, Math.max(1, Math.min(200, limit)));
}

export function getPresence() {
  const store = readStore();
  return store.presence;
}
