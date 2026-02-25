import fs from 'fs';
import path from 'path';
import { kv } from '@vercel/kv';

export type ActivityKind = 'info' | 'doing' | 'done' | 'blocked';

export type ActivityEvent = {
  id: string;
  ts: string; // ISO
  persona: string;
  to?: string;
  kind: ActivityKind;
  ticket?: string;
  text: string;
};

export type PresenceMap = Record<string, { lastSeenAt: string }>; // persona -> lastSeen

export type PersonaProfile = {
  key: string; // canonical (lowercase)
  displayName?: string;
  animal?: string; // emoji for now
  createdAt: string;
  lastSeenAt?: string;
  pinned?: boolean;
  order?: number;
};

export type PersonasMap = Record<string, PersonaProfile>;

// ----------------------------
// Storage backend selection
// ----------------------------

function hasKvEnv() {
  // @vercel/kv reads env internally; this is just a cheap “intent” check.
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// Fallback for local dev / no-KV environments.
const STORE_PATH = process.env.STORE_PATH
  ? path.resolve(process.env.STORE_PATH)
  : path.resolve(process.env.TMPDIR || '/tmp', 'mission-control-activity.json');

type Store = {
  activity: ActivityEvent[];
  presence: PresenceMap;
  personas: PersonasMap;
};

const KEY_ACTIVITY = 'mc:activity';
const KEY_PRESENCE = 'mc:presence';
const KEY_PERSONAS = 'mc:personas';

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function defaultProfile(key: string): PersonaProfile {
  // Defaults can be overridden via POST /api/mission/personas
  const now = new Date().toISOString();
  if (key === 'shiki') return { key, displayName: 'シキ', animal: '🐺', createdAt: now, pinned: true, order: 10 };
  if (key === 'kumi') return { key, displayName: 'クミ', animal: '🐱', createdAt: now, pinned: true, order: 20 };
  if (key === 'moru') return { key, displayName: 'もる', animal: '🦊', createdAt: now, pinned: true, order: 30 };
  if (key === 'mjup') return { key, displayName: 'まーき', animal: '🦉', createdAt: now, pinned: true, order: 40 };

  // Known AI employees (not pinned by default)
  if (key === 'tsumugi') return { key, displayName: 'ツムギ', animal: '🦝', createdAt: now, pinned: false, order: 110 };
  if (key === 'kensaku') return { key, displayName: 'ケンサク', animal: '🦉', createdAt: now, pinned: false, order: 120 };
  if (key === 'hajime') return { key, displayName: 'ハジメ', animal: '🦊', createdAt: now, pinned: false, order: 130 };
  if (key === 'suu') return { key, displayName: 'スウ', animal: '🐙', createdAt: now, pinned: false, order: 140 };
  if (key === 'kumi') return { key, displayName: 'クミ', animal: '🐱', createdAt: now, pinned: false, order: 150 };
  if (key === 'kotone') return { key, displayName: 'コトネ', animal: '🦜', createdAt: now, pinned: false, order: 160 };
  if (key === 'kaname') return { key, displayName: 'カナメ', animal: '🐻', createdAt: now, pinned: false, order: 170 };
  if (key === 'nozomi') return { key, displayName: 'ノゾミ', animal: '🦄', createdAt: now, pinned: false, order: 180 };
  if (key === 'hiraku') return { key, displayName: 'ヒラク', animal: '🦦', createdAt: now, pinned: false, order: 190 };

  return { key, createdAt: now };
}

function ensurePersonaLocal(store: Store, keyRaw: string, patch?: Partial<PersonaProfile>) {
  const key = (keyRaw || 'moru').toLowerCase();
  if (!store.personas[key]) store.personas[key] = defaultProfile(key);
  if (patch) store.personas[key] = { ...store.personas[key], ...patch, key };
  return store.personas[key];
}

function readStoreLocal(): Store {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      activity: Array.isArray(parsed.activity) ? parsed.activity : [],
      presence: parsed.presence && typeof parsed.presence === 'object' ? parsed.presence : {},
      personas: parsed.personas && typeof parsed.personas === 'object' ? parsed.personas : {},
    };
  } catch {
    return { activity: [], presence: {}, personas: {} };
  }
}

function writeStoreLocal(store: Store) {
  ensureDir(STORE_PATH);
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

async function getJson<T>(key: string, fallback: T): Promise<T> {
  const v = (await kv.get(key)) as any;
  if (!v) return fallback;
  return v as T;
}

async function setJson<T>(key: string, value: T) {
  await kv.set(key, value as any);
}

async function ensurePersonaKv(keyRaw: string, patch?: Partial<PersonaProfile>) {
  const key = (keyRaw || 'moru').toLowerCase();
  const personas = await getJson<PersonasMap>(KEY_PERSONAS, {});
  if (!personas[key]) personas[key] = defaultProfile(key);
  if (patch) personas[key] = { ...personas[key], ...patch, key };
  await setJson(KEY_PERSONAS, personas);
  return personas[key];
}

// ----------------------------
// Public API (async)
// ----------------------------

export async function appendActivity(input: Omit<ActivityEvent, 'id' | 'ts'>) {
  const now = new Date().toISOString();
  const ev: ActivityEvent = { id: uid(), ts: now, ...input };
  const personaKey = (input.persona || 'moru').toLowerCase();

  if (hasKvEnv()) {
    // activity list
    await kv.lpush(KEY_ACTIVITY, JSON.stringify(ev));
    await kv.ltrim(KEY_ACTIVITY, 0, 499);

    // presence map
    const presence = await getJson<PresenceMap>(KEY_PRESENCE, {});
    presence[personaKey] = { lastSeenAt: now };
    await setJson(KEY_PRESENCE, presence);

    // personas map
    await ensurePersonaKv(personaKey, { lastSeenAt: now });

    return ev;
  }

  // local fallback
  const store = readStoreLocal();
  store.activity.unshift(ev);
  store.activity = store.activity.slice(0, 500);
  store.presence[personaKey] = { lastSeenAt: now };
  ensurePersonaLocal(store, personaKey, { lastSeenAt: now });
  writeStoreLocal(store);
  return ev;
}

export async function touchPresence(persona: string) {
  const now = new Date().toISOString();
  const key = (persona || 'moru').toLowerCase();

  if (hasKvEnv()) {
    const presence = await getJson<PresenceMap>(KEY_PRESENCE, {});
    presence[key] = { lastSeenAt: now };
    await setJson(KEY_PRESENCE, presence);
    await ensurePersonaKv(key, { lastSeenAt: now });
    return presence[key];
  }

  const store = readStoreLocal();
  store.presence[key] = { lastSeenAt: now };
  ensurePersonaLocal(store, key, { lastSeenAt: now });
  writeStoreLocal(store);
  return store.presence[key];
}

export async function getActivity(limit = 50) {
  const lim = Math.max(1, Math.min(500, limit));

  if (hasKvEnv()) {
    const rows = (await kv.lrange(KEY_ACTIVITY, 0, lim - 1)) as any[];
    const items: ActivityEvent[] = [];
    for (const r of rows ?? []) {
      if (typeof r === 'string') {
        try {
          items.push(JSON.parse(r));
        } catch {
          // ignore
        }
      } else if (r && typeof r === 'object') {
        // in case it was stored as object
        items.push(r as ActivityEvent);
      }
    }
    return items;
  }

  const store = readStoreLocal();
  return store.activity.slice(0, lim);
}

export async function getPresence() {
  if (hasKvEnv()) {
    return await getJson<PresenceMap>(KEY_PRESENCE, {});
  }
  const store = readStoreLocal();
  return store.presence;
}

export async function listPersonas() {
  if (hasKvEnv()) {
    // ensure core team + known AI employees exist even when empty
    for (const k of ['shiki', 'kumi', 'moru', 'mjup', 'tsumugi', 'kensaku', 'hajime', 'suu', 'kotone', 'kaname', 'nozomi', 'hiraku']) {
      await ensurePersonaKv(k);
    }

    const personas = await getJson<PersonasMap>(KEY_PERSONAS, {});
    const list = Object.values(personas);
    list.sort((a, b) => {
      const ap = a.pinned ? 0 : 1;
      const bp = b.pinned ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const ao = a.order ?? 9999;
      const bo = b.order ?? 9999;
      if (ao !== bo) return ao - bo;
      return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
    });
    return list;
  }

  const store = readStoreLocal();
  for (const k of ['shiki', 'kumi', 'moru', 'mjup', 'tsumugi', 'kensaku', 'hajime', 'suu', 'kotone', 'kaname', 'nozomi', 'hiraku']) ensurePersonaLocal(store, k);
  writeStoreLocal(store);

  const list = Object.values(store.personas);
  list.sort((a, b) => {
    const ap = a.pinned ? 0 : 1;
    const bp = b.pinned ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const ao = a.order ?? 9999;
    const bo = b.order ?? 9999;
    if (ao !== bo) return ao - bo;
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
  });
  return list;
}

export async function upsertPersona(
  keyRaw: string,
  patch: Partial<Pick<PersonaProfile, 'displayName' | 'animal' | 'pinned' | 'order'>>
) {
  const key = (keyRaw || '').toLowerCase();
  if (!key) throw new Error('key is required');

  if (hasKvEnv()) {
    const p = await ensurePersonaKv(key, patch as any);
    return p;
  }

  const store = readStoreLocal();
  const p = ensurePersonaLocal(store, key, patch as any);
  writeStoreLocal(store);
  return p;
}
