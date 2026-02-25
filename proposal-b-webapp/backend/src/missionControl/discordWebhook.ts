import { getDiscordWebhookUrl } from './config';

export type PersonaKey =
  | 'shiki'
  | 'tsumugi'
  | 'kensaku'
  | 'hajime'
  | 'suu'
  | 'kumi'
  | 'kotone'
  | 'hiraku'
  | 'moru';

const PERSONAS: Record<PersonaKey, { username: string; avatarUrl?: string }> = {
  moru: { username: 'もる' },
  shiki: { username: 'シキ' },
  tsumugi: { username: 'ツムギ' },
  kensaku: { username: 'ケンサク' },
  hajime: { username: 'ハジメ' },
  suu: { username: 'スウ' },
  kumi: { username: 'クミ' },
  kotone: { username: 'コトネ' },
  hiraku: { username: 'ヒラク' },
};

export function getPersona(persona?: string) {
  const key = (persona ?? 'moru').toLowerCase() as PersonaKey;
  return PERSONAS[key] ?? PERSONAS.moru;
}

export async function postToDiscordWebhook(opts: {
  persona?: string;
  content: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = getDiscordWebhookUrl();
  if (!url) return { ok: false, error: 'DISCORD_WEBHOOK_URL is not set' };
  if (!opts.content || opts.content.trim().length === 0) return { ok: false, error: 'content is required' };

  const persona = getPersona(opts.persona);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: opts.content,
        username: persona.username,
        avatar_url: persona.avatarUrl,
        allowed_mentions: { parse: [] },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `webhook failed: ${res.status} ${res.statusText} ${text}`.slice(0, 500) };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown error' };
  }
}
