export const MISSION_CONTROL_COOKIE_NAME = 'mc_auth';

export function getDataMode(): 'mock' | 'csv' | 'db' {
  const v = (process.env.DATA_MODE ?? 'mock').toLowerCase();
  if (v === 'csv' || v === 'db' || v === 'mock') return v;
  return 'mock';
}

export function getDiscordWebhookUrl(): string | null {
  // Optional. If set, Mission Control can post messages to Discord via webhook
  // (for persona-style usernames/avatars).
  const v = process.env.DISCORD_WEBHOOK_URL?.trim();
  return v && v.length > 0 ? v : null;
}
