import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { MISSION_CONTROL_COOKIE_NAME } from './config';

function getPassword(): string {
  return process.env.MISSION_CONTROL_PASSWORD ?? '';
}

function sign(value: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function issueAuthCookie(res: Response) {
  const password = getPassword();
  if (!password) throw new Error('MISSION_CONTROL_PASSWORD is not set');

  const value = JSON.stringify({ v: 1, ts: Date.now() });
  const sig = sign(value, password);
  const token = Buffer.from(value).toString('base64url') + '.' + sig;

  res.cookie(MISSION_CONTROL_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // set true behind HTTPS
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(MISSION_CONTROL_COOKIE_NAME, { path: '/' });
}

export function isAuthenticated(req: Request): boolean {
  const password = getPassword();
  if (!password) return false;

  const token = (req.cookies?.[MISSION_CONTROL_COOKIE_NAME] as string | undefined) ?? '';
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return false;

  let value = '';
  try {
    value = Buffer.from(b64, 'base64url').toString('utf8');
  } catch {
    return false;
  }

  const expected = sign(value, password);
  const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  if (!ok) return false;

  try {
    const parsed = JSON.parse(value);
    if (parsed?.v !== 1) return false;
    return true;
  } catch {
    return false;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!isAuthenticated(req)) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Login required' });
    return;
  }
  next();
}
