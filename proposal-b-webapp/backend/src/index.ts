import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load backend/.env locally (do not commit secrets). Works for both `npm run dev` and `npm run start`.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { simpleParser } from 'mailparser';
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import OpenAI from 'openai';
import { clearAuthCookie, issueAuthCookie, isAuthenticated } from './missionControl/auth';
import { createMissionControlRouter } from './missionControl/routes';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT ?? 4000;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? `http://127.0.0.1:${PORT}/api/google/oauth2/callback`;
const GMAIL_IMPORT_ACCOUNT = process.env.GMAIL_IMPORT_ACCOUNT ?? '';
const GMAIL_IMPORT_POLL_SEC = Number(process.env.GMAIL_IMPORT_POLL_SEC ?? 60);
const GMAIL_IMPORT_LOOKBACK_DAYS = Number(process.env.GMAIL_IMPORT_LOOKBACK_DAYS ?? 7);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
const SALES_OWNER_ALIASES = process.env.SALES_OWNER_ALIASES ?? '';
const AGGREGATION_MAILBOXES = process.env.AGGREGATION_MAILBOXES ?? '';
const SALES_OWNER_CONFIG_PATH = path.resolve(process.cwd(), 'config', 'salesOwners.json');

function getOpenAI() {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY が未設定です');
  return new OpenAI({ apiKey: OPENAI_API_KEY });
}

function getOAuthClient() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET が未設定です');
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];


const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? '';
if (FRONTEND_ORIGIN) {
  app.use(
    cors({
      origin: FRONTEND_ORIGIN,
      credentials: true,
    })
  );
}


/** 共通エラー形式（プロ視点：運用・保守性） */
function sendError(res: Response, code: string, message: string, status = 400) {
  res.status(status).json({ code, message });
}

/** 入力バリデーション（プロ視点：セキュリティ） */
const SUBJECT_MAX = 500;
const FROM_MAX = 500;
const BODY_MAX = 50000;
const PAGE_SIZE_MAX = 100;

const SCORE_THRESHOLD = 70;

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'ses-match-backend' });
});

/** Mission Control Auth (single password) */
app.get('/api/auth/me', (req: Request, res: Response) => {
  res.json({ authenticated: isAuthenticated(req) });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  try {
    const body = req.body as { password?: string };
    const password = typeof body.password === 'string' ? body.password : '';
    const expected = process.env.MISSION_CONTROL_PASSWORD ?? '';
    if (!expected) return sendError(res, 'SERVER_ERROR', 'MISSION_CONTROL_PASSWORD が未設定です', 500);
    if (password !== expected) return sendError(res, 'UNAUTHORIZED', 'パスワードが違います', 401);

    issueAuthCookie(res);
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/auth/login', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

/** Mission Control APIs */
app.use('/api/mission', createMissionControlRouter());

/** Google OAuth：連携開始（ブラウザで同意→callback） */
app.get('/api/google/oauth2/start', async (req: Request, res: Response) => {
  try {
    const account = typeof req.query.account === 'string' ? req.query.account : GMAIL_IMPORT_ACCOUNT;
    if (!account) {
      return sendError(res, 'VALIDATION_ERROR', 'account（連携するGmailアドレス）を指定してください。');
    }
    const oauth2 = getOAuthClient();
    const state = Buffer.from(JSON.stringify({ account, ts: Date.now() })).toString('base64url');
    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES,
      state,
      include_granted_scopes: true,
    });
    res.redirect(url);
  } catch (e) {
    console.error('GET /api/google/oauth2/start', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** Google OAuth：callback */
app.get('/api/google/oauth2/callback', async (req: Request, res: Response) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code) {
      return sendError(res, 'VALIDATION_ERROR', 'code がありません。');
    }

    const oauth2 = getOAuthClient();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
    const me = await oauth2Api.userinfo.get();
    const email = me.data.email;
    if (!email) {
      return sendError(res, 'SERVER_ERROR', 'ユーザーのemail取得に失敗しました。', 500);
    }

    // stateに指定アカウントがあればチェック（違っても保存はするがログに残す）
    let requestedAccount: string | null = null;
    try {
      if (state) {
        const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
        requestedAccount = decoded.account ?? null;
      }
    } catch {
      requestedAccount = null;
    }
    if (requestedAccount && requestedAccount !== email) {
      console.warn('OAuth account mismatch', { requestedAccount, email });
    }

    await prisma.googleAuth.upsert({
      where: { email },
      update: {
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? null,
        expiryDateMs: tokens.expiry_date ? BigInt(tokens.expiry_date) : null,
        scope: tokens.scope ?? null,
        tokenType: tokens.token_type ?? null,
        lastSyncedAt: null,
      },
      create: {
        email,
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? null,
        expiryDateMs: tokens.expiry_date ? BigInt(tokens.expiry_date) : null,
        scope: tokens.scope ?? null,
        tokenType: tokens.token_type ?? null,
      },
    });

    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(
      `<h2>Connected</h2><p>${email} を連携しました。</p><p>このタブは閉じてOKです。</p>`
    );
  } catch (e) {
    console.error('GET /api/google/oauth2/callback', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** Gmail：手動取り込み（デバッグ用） */
app.post('/api/gmail/import-now', async (_req: Request, res: Response) => {
  try {
    await gmailImportOnce();
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/gmail/import-now', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** 件数サマリ（ヘッダー表示用） */
app.get('/api/stats', async (_req: Request, res: Response) => {
  try {
    const [rawEmails, projectOffers, talentOffers] = await Promise.all([
      prisma.rawEmail.count(),
      prisma.projectOffer.count(),
      prisma.talentOffer.count(),
    ]);
    res.json({ rawEmails, projectOffers, talentOffers });
  } catch (e) {
    console.error('GET /api/stats', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** 設定（閾値など） */
app.get('/api/config', (_req: Request, res: Response) => {
  res.json({ scoreThreshold: SCORE_THRESHOLD });
});

/** 受信一覧：ページネーション対応（プロ視点：パフォーマンス） */
app.get('/api/raw-emails', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, PAGE_SIZE_MAX);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const [list, total] = await Promise.all([
      prisma.rawEmail.findMany({
        take: limit,
        skip: offset,
        orderBy: { receivedAt: 'desc' },
        select: {
          id: true,
          subject: true,
          fromAddr: true,
          toAddr: true,
          salesOwnerEmail: true,
          salesOwnerName: true,
          bodyText: true,
          receivedAt: true,
          classification: true,
          processingStatus: true,
        },
      }),
      prisma.rawEmail.count(),
    ]);
    res.json({ items: list, total });
  } catch (e) {
    console.error('GET /api/raw-emails', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** .eml ファイル1件を取り込んで RawEmail に保存（届くメールのサンプル用） */
app.post('/api/raw-emails/import-eml', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file || !file.buffer) {
      sendError(res, 'VALIDATION_ERROR', 'ファイルを選択してください。');
      return;
    }
    const mail = await simpleParser(file.buffer);
    const fromAddr = mail.from?.text?.slice(0, FROM_MAX) ?? mail.from?.value?.[0]?.address ?? '（未設定）';
    const subjectRaw = mail.subject;
    const subject = (typeof subjectRaw === 'string' ? subjectRaw : '').slice(0, SUBJECT_MAX);
    const textOrHtml = mail.text ?? mail.html ?? '';
    const bodyText = (typeof textOrHtml === 'string' ? textOrHtml : '').slice(0, BODY_MAX);
    const receivedAt = mail.date ? new Date(mail.date) : new Date();

    const toAddr =
      mail.to == null
        ? null
        : Array.isArray(mail.to)
          ? mail.to.map((a) => a.text).join(', ')
          : mail.to.text;
    const ccAddr =
      mail.cc == null
        ? null
        : Array.isArray(mail.cc)
          ? mail.cc.map((a) => a.text).join(', ')
          : mail.cc.text;
    const deliveredToAddr = String(mail.headers.get('delivered-to') ?? mail.headers.get('x-forwarded-to') ?? '') || null;
    const originalRecipient = String(mail.headers.get('x-original-to') ?? mail.headers.get('x-original-recipient') ?? '') || null;
    const salesOwner = deriveSalesOwner({ toAddr, ccAddr, deliveredToAddr, originalRecipient });

    const row = await prisma.rawEmail.create({
      data: {
        messageId: mail.messageId ?? undefined,
        fromAddr,
        toAddr,
        ccAddr,
        deliveredToAddr,
        originalRecipient,
        salesOwnerEmail: salesOwner.salesOwnerEmail ?? undefined,
        salesOwnerName: salesOwner.salesOwnerName ?? undefined,
        subject,
        bodyText,
        receivedAt,
        processingStatus: 'pending',
      },
    });
    res.status(201).json(row);
  } catch (e) {
    console.error('POST /api/raw-emails/import-eml', e);
    sendError(res, 'SERVER_ERROR', '.eml の解析に失敗しました。' + String(e), 500);
  }
});

/** メール1件追加：バリデーションあり（プロ視点：セキュリティ・UX） */
app.post('/api/raw-emails', async (req: Request, res: Response) => {
  try {
    const body = req.body as { subject?: string; from?: string; to?: string; salesOwnerEmail?: string; bodyText?: string };
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const fromAddr = typeof body.from === 'string' ? body.from.trim() : '';
    const toAddr = typeof body.to === 'string' ? body.to.trim() : '';
    const bodyText = typeof body.bodyText === 'string' ? body.bodyText : '';
    const explicitSalesOwnerEmail = canonicalizeEmail(typeof body.salesOwnerEmail === 'string' ? body.salesOwnerEmail : '');
    const salesOwner = explicitSalesOwnerEmail
      ? {
          salesOwnerEmail: explicitSalesOwnerEmail,
          salesOwnerName: SALES_OWNER_NAME_BY_EMAIL.get(explicitSalesOwnerEmail) ?? defaultSalesOwnerName(explicitSalesOwnerEmail),
        }
      : deriveSalesOwner({ toAddr });

    if (!subject && !bodyText) {
      sendError(res, 'VALIDATION_ERROR', '件名または本文のいずれかは必須です。');
      return;
    }

    const row = await prisma.rawEmail.create({
      data: {
        fromAddr: fromAddr.slice(0, FROM_MAX) || '（未設定）',
        toAddr: toAddr || null,
        salesOwnerEmail: salesOwner.salesOwnerEmail ?? undefined,
        salesOwnerName: salesOwner.salesOwnerName ?? undefined,
        subject: subject.slice(0, SUBJECT_MAX),
        bodyText: bodyText.slice(0, BODY_MAX),
        receivedAt: new Date(),
        processingStatus: 'pending',
      },
    });
    res.status(201).json(row);
  } catch (e) {
    console.error('POST /api/raw-emails', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/**
 * 簡易抽出（MVP1）：本文/件名から代表的な項目を正規表現で拾う。
 * - 目的：Qoala風UIの「抽出カラム」がまず埋まること（AI抽出は後で上書き可能）
 */
function getSenderDomain(fromAddr: string): string | null {
  const m = fromAddr.match(/@([^>\s]+)/);
  if (!m) return null;
  const dom = m[1].toLowerCase().replace(/[^a-z0-9._-]/g, '');
  return dom || null;
}

function canonicalizeEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return match?.[0] ?? null;
}

function extractEmails(value: string | null | undefined): string[] {
  if (!value) return [];
  const matches = value.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const match of matches) {
    const email = canonicalizeEmail(match);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

function parseSalesOwnerAliases(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const chunk of raw.split(';')) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const [namePart, emailsPart] = trimmed.split(':');
    const name = (emailsPart ? namePart : '').trim();
    const emails = (emailsPart ?? namePart)
      .split(',')
      .map((v) => canonicalizeEmail(v))
      .filter((v): v is string => Boolean(v));
    for (const email of emails) {
      map.set(email, name || email.split('@')[0]);
    }
  }
  return map;
}

function loadSalesOwnerConfigFile(configPath: string) {
  if (!fs.existsSync(configPath)) {
    return { owners: new Map<string, string>(), aggregationMailboxes: new Set<string>() };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      owners?: Array<{ name?: string; emails?: string[] }>;
      aggregationMailboxes?: string[];
    };

    const owners = new Map<string, string>();
    for (const owner of raw.owners ?? []) {
      const name = String(owner.name ?? '').trim();
      for (const emailRaw of owner.emails ?? []) {
        const email = canonicalizeEmail(emailRaw);
        if (!email) continue;
        owners.set(email, name || email.split('@')[0]);
      }
    }

    const aggregationMailboxes = new Set(
      (raw.aggregationMailboxes ?? [])
        .map((value) => canonicalizeEmail(value))
        .filter((value): value is string => Boolean(value))
    );

    return { owners, aggregationMailboxes };
  } catch (error) {
    console.warn('[sales-owner-config] failed to load', error);
    return { owners: new Map<string, string>(), aggregationMailboxes: new Set<string>() };
  }
}

const SALES_OWNER_CONFIG = loadSalesOwnerConfigFile(SALES_OWNER_CONFIG_PATH);
const SALES_OWNER_NAME_BY_EMAIL = new Map<string, string>([
  ...SALES_OWNER_CONFIG.owners.entries(),
  ...parseSalesOwnerAliases(SALES_OWNER_ALIASES).entries(),
]);
const AGGREGATION_MAILBOX_SET = new Set<string>([
  ...SALES_OWNER_CONFIG.aggregationMailboxes.values(),
  ...AGGREGATION_MAILBOXES.split(',')
    .map((value) => canonicalizeEmail(value))
    .filter((value): value is string => Boolean(value)),
]);

function defaultSalesOwnerName(email: string): string {
  return email.split('@')[0]?.replace(/[._-]+/g, ' ') || email;
}

function deriveSalesOwner(input: {
  toAddr?: string | null;
  ccAddr?: string | null;
  deliveredToAddr?: string | null;
  originalRecipient?: string | null;
}) {
  const candidates = [
    ...extractEmails(input.originalRecipient),
    ...extractEmails(input.deliveredToAddr),
    ...extractEmails(input.toAddr),
    ...extractEmails(input.ccAddr),
  ];

  const picked = candidates.find((email) => !AGGREGATION_MAILBOX_SET.has(email)) ?? candidates[0] ?? null;
  if (!picked) {
    return { salesOwnerEmail: null, salesOwnerName: null };
  }

  return {
    salesOwnerEmail: picked,
    salesOwnerName: SALES_OWNER_NAME_BY_EMAIL.get(picked) ?? defaultSalesOwnerName(picked),
  };
}

function extractPriceMan(text: string): { min?: number; max?: number } {
  // 例: 80万〜90万 / 80-90万 / 80万以上
  const normalized = text.replace(/万円/g, '万').replace(/[\s　]/g, '');
  const range = normalized.match(/(\d{2,3})万(?:〜|～|\-|－|〜)(\d{2,3})万/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const minOnly = normalized.match(/(\d{2,3})万(?:以上|〜|～)?/);
  if (minOnly) return { min: Number(minOnly[1]) };
  return {};
}

function extractAge(text: string): number | null {
  const m = text.match(/(\d{2})歳/);
  if (!m) return null;
  const age = Number(m[1]);
  return Number.isFinite(age) ? age : null;
}

function extractSupplyChainDepth(text: string): number | null {
  const normalized = text.replace(/[\s　]/g, '');
  if (normalized.includes('エンド直') || normalized.includes('直請') || normalized.includes('直案件')) return 1;
  const m1 = normalized.match(/商流(\d)/);
  if (m1) return Number(m1[1]);
  const m2 = normalized.match(/(\d)次/);
  if (m2) return Number(m2[1]);
  return null;
}

function extractEmploymentTypeText(text: string): string | null {
  const normalized = text.replace(/[\s　]/g, '');
  if (normalized.includes('個人') || normalized.includes('フリーランス')) return '個人';
  if (normalized.includes('正社員') || normalized.includes('社員')) return '社員';
  if (normalized.includes('契約社員') || normalized.includes('契約')) return '契約';
  if (normalized.includes('業務委託')) return '業務委託';
  return null;
}

function extractRemoteOk(text: string): boolean | null {
  const normalized = text.replace(/[\s　]/g, '');
  if (normalized.includes('フルリモ') || normalized.includes('フルリモート')) return true;
  if (normalized.includes('リモート可') || normalized.includes('在宅可')) return true;
  if (normalized.includes('リモート不可') || normalized.includes('在宅不可') || normalized.includes('常駐')) return false;
  return null;
}

function extractStartText(text: string): string | null {
  const normalized = text.replace(/[\s　]/g, '');
  if (normalized.includes('即日') || normalized.includes('即')) return '即';
  const m = normalized.match(/(\d{1,2})月(?:\d{1,2}日)?(?:入場|開始|参画|稼働)/);
  if (m) return `${m[1]}月`;
  return null;
}

function extractLocationText(text: string): string | null {
  const normalized = text.replace(/[\s　]/g, ' ');
  const m = normalized.match(/(?:勤務地|場所|最寄|最寄駅)[:：]?\s*([^\n\r]{2,20})/);
  if (m) return m[1].trim();
  // 駅っぽい語
  const m2 = normalized.match(/([\u4e00-\u9faf]{2,6}駅)/);
  if (m2) return m2[1];
  return null;
}

function extractInterviewCount(text: string): number | null {
  const m = text.replace(/[\s　]/g, '').match(/面談(\d)回/);
  if (!m) return null;
  return Number(m[1]);
}

function extractNationality(text: string): string | null {
  const normalized = text.replace(/[\s　]/g, '');
  if (normalized.includes('国籍不問')) return '不問';
  const m = normalized.match(/国籍[:：]?([\u4e00-\u9faf]{2,6})/);
  if (m) return m[1];
  if (normalized.includes('外国籍')) return '外国籍';
  if (normalized.includes('日本人')) return '日本';
  return null;
}

type AiExtractResult =
  | {
      classification: 'project';
      confidence: number;
      fields: {
        priceMin?: number;
        priceMax?: number;
        supplyChainDepth?: number;
        interviewCount?: number;
        workLocation?: string;
        remoteOk?: boolean;
        startPeriod?: string;
        nationalityRequirement?: string;
      };
      json: any;
    }
  | {
      classification: 'talent';
      confidence: number;
      fields: {
        hopePriceMin?: number;
        hopePriceMax?: number;
        age?: number;
        employmentTypeText?: string;
        workLocationPreference?: string;
        startAvailableDate?: string;
        nationalityText?: string;
      };
      json: any;
    };

async function aiExtractEmail(subject: string | null, bodyText: string | null) {
  const text = `${subject ?? ''}\n${bodyText ?? ''}`.slice(0, 12000);
  const client = getOpenAI();

  const schema = {
    name: 'ses_extract',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        classification: { type: 'string', enum: ['project', 'talent', 'unknown'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        project: {
          type: 'object',
          additionalProperties: false,
          properties: {
            priceMinMan: { type: ['number', 'null'] },
            priceMaxMan: { type: ['number', 'null'] },
            supplyChainDepth: { type: ['number', 'null'] },
            interviewCount: { type: ['number', 'null'] },
            workLocation: { type: ['string', 'null'] },
            remoteOk: { type: ['boolean', 'null'] },
            startPeriod: { type: ['string', 'null'] },
            nationalityRequirement: { type: ['string', 'null'] },
          },
        },
        talent: {
          type: 'object',
          additionalProperties: false,
          properties: {
            hopePriceMinMan: { type: ['number', 'null'] },
            hopePriceMaxMan: { type: ['number', 'null'] },
            age: { type: ['number', 'null'] },
            employmentTypeText: { type: ['string', 'null'] },
            workLocationPreference: { type: ['string', 'null'] },
            startAvailableDate: { type: ['string', 'null'] },
            nationalityText: { type: ['string', 'null'] },
          },
        },
      },
      required: ['classification', 'confidence'],
    },
  } as const;

  const resp = await client.responses.create({
    model: OPENAI_MODEL,
    input: [
      {
        role: 'system',
        content:
          'あなたはSESの案件/人材メールから項目を抽出するエンジンです。日本語メールから、単価は「万/月」の数値で抽出してください。曖昧ならnull。推測で埋めない。',
      },
      {
        role: 'user',
        content: `以下のメール本文から、案件(project)か人材(talent)か判定し、必要項目を抽出して下さい。\n\n---\n${text}\n---`,
      },
    ],
    // NOTE: openai npm の型追従が遅れる場合があるため、MVPでは any キャストで吸収
    response_format: { type: 'json_schema', json_schema: schema } as any,
  } as any);

  const out = resp.output_text ? JSON.parse(resp.output_text) : null;
  return out as any;
}

async function aiExtractAndPersist(rawEmailId: string): Promise<AiExtractResult | null> {
  if (!OPENAI_API_KEY) return null;
  const rawEmail = await prisma.rawEmail.findUnique({ where: { id: rawEmailId } });
  if (!rawEmail) return null;

  const out = await aiExtractEmail(rawEmail.subject, rawEmail.bodyText);
  const classification = out?.classification;
  const confidence = Number(out?.confidence ?? 0);

  await prisma.rawEmail.update({
    where: { id: rawEmailId },
    data: {
      aiModel: OPENAI_MODEL,
      aiJson: out ? JSON.stringify(out) : null,
      aiConfidence: Number.isFinite(confidence) ? confidence : null,
      aiExtractedAt: new Date(),
    },
  });

  if (classification === 'project') {
    return {
      classification: 'project',
      confidence,
      fields: {
        priceMin: out?.project?.priceMinMan ?? undefined,
        priceMax: out?.project?.priceMaxMan ?? undefined,
        supplyChainDepth: out?.project?.supplyChainDepth ?? undefined,
        interviewCount: out?.project?.interviewCount ?? undefined,
        workLocation: out?.project?.workLocation ?? undefined,
        remoteOk: out?.project?.remoteOk ?? undefined,
        startPeriod: out?.project?.startPeriod ?? undefined,
        nationalityRequirement: out?.project?.nationalityRequirement ?? undefined,
      },
      json: out,
    };
  }

  if (classification === 'talent') {
    return {
      classification: 'talent',
      confidence,
      fields: {
        hopePriceMin: out?.talent?.hopePriceMinMan ?? undefined,
        hopePriceMax: out?.talent?.hopePriceMaxMan ?? undefined,
        age: out?.talent?.age ?? undefined,
        employmentTypeText: out?.talent?.employmentTypeText ?? undefined,
        workLocationPreference: out?.talent?.workLocationPreference ?? undefined,
        startAvailableDate: out?.talent?.startAvailableDate ?? undefined,
        nationalityText: out?.talent?.nationalityText ?? undefined,
      },
      json: out,
    };
  }

  return null;
}

/** 受信メール詳細 */
app.get('/api/raw-emails/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const row = await prisma.rawEmail.findUnique({
      where: { id },
      include: {
        projectOffers: {
          select: {
            id: true,
            priceMin: true,
            priceMax: true,
            supplyChainDepth: true,
            interviewCount: true,
            workLocation: true,
            remoteOk: true,
            startPeriod: true,
            nationalityRequirement: true,
            salesOwnerEmail: true,
            salesOwnerName: true,
            project: { select: { canonicalName: true } },
          },
        },
        talentOffers: {
          select: {
            id: true,
            hopePriceMin: true,
            hopePriceMax: true,
            age: true,
            employmentTypeText: true,
            workLocationPreference: true,
            startAvailableDate: true,
            nationalityText: true,
            salesOwnerEmail: true,
            salesOwnerName: true,
            talent: { select: { canonicalName: true } },
          },
        },
      },
    });
    if (!row) return sendError(res, 'NOT_FOUND', '指定されたメールが見つかりません。', 404);
    res.json(row);
  } catch (e) {
    console.error('GET /api/raw-emails/:id', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** 分類を更新（案件/人材）。案件なら Project+ProjectOffer、人材なら Talent+TalentOffer を自動作成＋簡易抽出 */
app.patch('/api/raw-emails/:id/classification', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const body = req.body as { classification?: string };
    const classification = body.classification === 'talent' || body.classification === 'project' ? body.classification : null;
    if (!classification) {
      sendError(res, 'VALIDATION_ERROR', 'classification は talent または project を指定してください。');
      return;
    }

    const rawEmail = await prisma.rawEmail.findUnique({ where: { id } });
    if (!rawEmail) {
      sendError(res, 'NOT_FOUND', '指定されたメールが見つかりません。', 404);
      return;
    }

    const sourceText = `${rawEmail.subject ?? ''}\n${rawEmail.bodyText ?? ''}`;
    const senderDomain = getSenderDomain(rawEmail.fromAddr);
    const salesOwnerEmail = rawEmail.salesOwnerEmail;
    const salesOwnerName = rawEmail.salesOwnerName;
    const ai = await aiExtractAndPersist(id).catch(() => null);

    if (classification === 'project') {
      const existing = await prisma.projectOffer.findFirst({ where: { rawEmailId: id } });
      if (existing) {
        const row = await prisma.rawEmail.update({
          where: { id },
          data: { classification, processingStatus: 'extracted' },
        });
        return res.json(row);
      }

      const project = await prisma.project.create({
        data: { canonicalName: (rawEmail.subject || '案件').slice(0, 200) },
      });

      const price = ai?.classification === 'project' ? { min: ai.fields.priceMin, max: ai.fields.priceMax } : extractPriceMan(sourceText);
      const supplyDepth = ai?.classification === 'project' ? (ai.fields.supplyChainDepth ?? null) : extractSupplyChainDepth(sourceText);
      const interviewCount = ai?.classification === 'project' ? (ai.fields.interviewCount ?? null) : extractInterviewCount(sourceText);
      const workLocation = ai?.classification === 'project' ? (ai.fields.workLocation ?? null) : extractLocationText(sourceText);
      const remoteOk = ai?.classification === 'project' ? (ai.fields.remoteOk ?? null) : extractRemoteOk(sourceText);
      const startPeriod = ai?.classification === 'project' ? (ai.fields.startPeriod ?? null) : extractStartText(sourceText);
      const nationalityRequirement = ai?.classification === 'project' ? (ai.fields.nationalityRequirement ?? null) : extractNationality(sourceText);

      await prisma.projectOffer.create({
        data: {
          projectId: project.id,
          rawEmailId: id,
          senderDomain,
          salesOwnerEmail: salesOwnerEmail ?? undefined,
          salesOwnerName: salesOwnerName ?? undefined,
          priceMin: price.min,
          priceMax: price.max,
          supplyChainDepth: supplyDepth ?? undefined,
          interviewCount: interviewCount ?? undefined,
          workLocation: workLocation ?? undefined,
          remoteOk: remoteOk ?? undefined,
          startPeriod: startPeriod ?? undefined,
          nationalityRequirement: nationalityRequirement ?? undefined,
          extractedAt: new Date(),
        },
      });
    } else {
      const existing = await prisma.talentOffer.findFirst({ where: { rawEmailId: id } });
      if (existing) {
        const row = await prisma.rawEmail.update({
          where: { id },
          data: { classification, processingStatus: 'extracted' },
        });
        return res.json(row);
      }

      const talent = await prisma.talent.create({ data: {} });

      const price = ai?.classification === 'talent' ? { min: ai.fields.hopePriceMin, max: ai.fields.hopePriceMax } : extractPriceMan(sourceText);
      const age = ai?.classification === 'talent' ? (ai.fields.age ?? null) : extractAge(sourceText);
      const employmentTypeText = ai?.classification === 'talent' ? (ai.fields.employmentTypeText ?? null) : extractEmploymentTypeText(sourceText);
      const workLocationPreference = ai?.classification === 'talent' ? (ai.fields.workLocationPreference ?? null) : extractLocationText(sourceText);
      const startAvailableDate = ai?.classification === 'talent' ? (ai.fields.startAvailableDate ?? null) : extractStartText(sourceText);
      const nationalityText = ai?.classification === 'talent' ? (ai.fields.nationalityText ?? null) : extractNationality(sourceText);

      await prisma.talentOffer.create({
        data: {
          talentId: talent.id,
          rawEmailId: id,
          senderDomain,
          salesOwnerEmail: salesOwnerEmail ?? undefined,
          salesOwnerName: salesOwnerName ?? undefined,
          hopePriceMin: price.min,
          hopePriceMax: price.max,
          age: age ?? undefined,
          employmentTypeText: employmentTypeText ?? undefined,
          workLocationPreference: workLocationPreference ?? undefined,
          startAvailableDate: startAvailableDate ?? undefined,
          nationalityText: nationalityText ?? undefined,
          extractedAt: new Date(),
        },
      });
    }

    const row = await prisma.rawEmail.update({
      where: { id },
      data: { classification, processingStatus: 'extracted' },
    });
    res.json(row);
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2025') {
      sendError(res, 'NOT_FOUND', '指定されたメールが見つかりません。', 404);
      return;
    }
    console.error('PATCH /api/raw-emails/:id/classification', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** 案件一覧（ProjectOffer + 元メール）: Qoala寄せの左検索パネル用に軽い絞り込み対応 */
app.get('/api/project-offers', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, PAGE_SIZE_MAX);
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const priceMinGte = req.query.priceMinGte ? Number(req.query.priceMinGte) : null;
    const priceMaxLte = req.query.priceMaxLte ? Number(req.query.priceMaxLte) : null;
    const flowDepth = req.query.flowDepth ? Number(req.query.flowDepth) : null;
    const employment = typeof req.query.employment === 'string' ? req.query.employment : null;
    const remote = typeof req.query.remote === 'string' ? req.query.remote : null; // 'true'|'false'
    const senderDomain = typeof req.query.senderDomain === 'string' ? req.query.senderDomain : null;
    const salesOwner = typeof req.query.salesOwner === 'string' ? req.query.salesOwner.trim() : null;

    const where: any = {
      ...(priceMinGte != null ? { priceMin: { gte: priceMinGte } } : {}),
      ...(priceMaxLte != null ? { priceMax: { lte: priceMaxLte } } : {}),
      ...(flowDepth != null ? { supplyChainDepth: flowDepth } : {}),
      ...(senderDomain ? { senderDomain } : {}),
      ...(remote === 'true' ? { remoteOk: true } : remote === 'false' ? { remoteOk: false } : {}),
    };
    const andFilters: any[] = [];

    if (salesOwner) {
      andFilters.push({
        OR: [{ salesOwnerEmail: { contains: salesOwner } }, { salesOwnerName: { contains: salesOwner } }],
      });
    }

    if (q) {
      andFilters.push({
        OR: [
          { workLocation: { contains: q } },
          { startPeriod: { contains: q } },
          { conditions: { contains: q } },
          {
            rawEmail: {
              is: {
                OR: [{ subject: { contains: q } }, { bodyText: { contains: q } }, { fromAddr: { contains: q } }],
              },
            },
          },
        ],
      });
    }

    // 雇用形態は案件側の本文に含まれることもあるが、MVPでは条件欄検索で代替
    if (employment) {
      where.conditions = { contains: employment };
    }

    if (andFilters.length) {
      where.AND = andFilters;
    }

    const [items, total] = await Promise.all([
      prisma.projectOffer.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        where,
        include: {
          project: { select: { id: true, canonicalName: true } },
          rawEmail: { select: { id: true, subject: true, fromAddr: true, toAddr: true, salesOwnerEmail: true, salesOwnerName: true, bodyText: true, receivedAt: true } },
        },
      }),
      prisma.projectOffer.count({ where }),
    ]);
    res.json({ items, total });
  } catch (e) {
    console.error('GET /api/project-offers', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

app.patch('/api/project-offers/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const body = (req.body ?? {}) as {
      priceMin?: number | null;
      priceMax?: number | null;
      startPeriod?: string | null;
      workLocation?: string | null;
      remoteOk?: boolean | null;
      supplyChainDepth?: number | null;
      interviewCount?: number | null;
    };

    const row = await prisma.projectOffer.update({
      where: { id },
      data: {
        priceMin: typeof body.priceMin === 'number' ? body.priceMin : body.priceMin === null ? null : undefined,
        priceMax: typeof body.priceMax === 'number' ? body.priceMax : body.priceMax === null ? null : undefined,
        startPeriod: typeof body.startPeriod === 'string' ? body.startPeriod.trim() || null : body.startPeriod === null ? null : undefined,
        workLocation: typeof body.workLocation === 'string' ? body.workLocation.trim() || null : body.workLocation === null ? null : undefined,
        remoteOk: typeof body.remoteOk === 'boolean' ? body.remoteOk : body.remoteOk === null ? null : undefined,
        supplyChainDepth: typeof body.supplyChainDepth === 'number' ? body.supplyChainDepth : body.supplyChainDepth === null ? null : undefined,
        interviewCount: typeof body.interviewCount === 'number' ? body.interviewCount : body.interviewCount === null ? null : undefined,
      },
    });

    res.json({ ok: true, item: row });
  } catch (e) {
    console.error('PATCH /api/project-offers/:id', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** 人材一覧（TalentOffer + 元メール）: 左検索パネル用に軽い絞り込み対応 */
app.get('/api/talent-offers', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, PAGE_SIZE_MAX);
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const priceMinGte = req.query.priceMinGte ? Number(req.query.priceMinGte) : null;
    const priceMaxLte = req.query.priceMaxLte ? Number(req.query.priceMaxLte) : null;
    const ageMin = req.query.ageMin ? Number(req.query.ageMin) : null;
    const ageMax = req.query.ageMax ? Number(req.query.ageMax) : null;
    const employment = typeof req.query.employment === 'string' ? req.query.employment : null;
    const remote = typeof req.query.remote === 'string' ? req.query.remote : null;
    const senderDomain = typeof req.query.senderDomain === 'string' ? req.query.senderDomain : null;
    const salesOwner = typeof req.query.salesOwner === 'string' ? req.query.salesOwner.trim() : null;

    const where: any = {
      ...(priceMinGte != null ? { hopePriceMin: { gte: priceMinGte } } : {}),
      ...(priceMaxLte != null ? { hopePriceMax: { lte: priceMaxLte } } : {}),
      ...(ageMin != null || ageMax != null
        ? {
            age: {
              ...(ageMin != null ? { gte: ageMin } : {}),
              ...(ageMax != null ? { lte: ageMax } : {}),
            },
          }
        : {}),
      ...(employment ? { employmentTypeText: employment } : {}),
      ...(senderDomain ? { senderDomain } : {}),
    };
    const andFilters: any[] = [];

    if (salesOwner) {
      andFilters.push({
        OR: [{ salesOwnerEmail: { contains: salesOwner } }, { salesOwnerName: { contains: salesOwner } }],
      });
    }

    if (remote) {
      // talent側は希望条件にしか出ないことが多いので、本文検索で代替
      if (remote === 'true') where.workLocationPreference = { contains: 'リモ' };
      if (remote === 'false') where.workLocationPreference = { contains: '常駐' };
    }

    if (q) {
      andFilters.push({
        OR: [
          { workLocationPreference: { contains: q } },
          { startAvailableDate: { contains: q } },
          {
            rawEmail: {
              is: {
                OR: [{ subject: { contains: q } }, { bodyText: { contains: q } }, { fromAddr: { contains: q } }],
              },
            },
          },
        ],
      });
    }

    if (andFilters.length) {
      where.AND = andFilters;
    }

    const [items, total] = await Promise.all([
      prisma.talentOffer.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        where,
        include: {
          talent: { select: { id: true } },
          rawEmail: { select: { id: true, subject: true, fromAddr: true, toAddr: true, salesOwnerEmail: true, salesOwnerName: true, bodyText: true, receivedAt: true } },
        },
      }),
      prisma.talentOffer.count({ where }),
    ]);
    res.json({ items, total });
  } catch (e) {
    console.error('GET /api/talent-offers', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

app.patch('/api/talent-offers/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const body = (req.body ?? {}) as {
      hopePriceMin?: number | null;
      hopePriceMax?: number | null;
      startAvailableDate?: string | null;
      workLocationPreference?: string | null;
      employmentTypeText?: string | null;
      age?: number | null;
    };

    const row = await prisma.talentOffer.update({
      where: { id },
      data: {
        hopePriceMin: typeof body.hopePriceMin === 'number' ? body.hopePriceMin : body.hopePriceMin === null ? null : undefined,
        hopePriceMax: typeof body.hopePriceMax === 'number' ? body.hopePriceMax : body.hopePriceMax === null ? null : undefined,
        startAvailableDate:
          typeof body.startAvailableDate === 'string' ? body.startAvailableDate.trim() || null : body.startAvailableDate === null ? null : undefined,
        workLocationPreference:
          typeof body.workLocationPreference === 'string'
            ? body.workLocationPreference.trim() || null
            : body.workLocationPreference === null
              ? null
              : undefined,
        employmentTypeText:
          typeof body.employmentTypeText === 'string' ? body.employmentTypeText.trim() || null : body.employmentTypeText === null ? null : undefined,
        age: typeof body.age === 'number' ? body.age : body.age === null ? null : undefined,
      },
    });

    res.json({ ok: true, item: row });
  } catch (e) {
    console.error('PATCH /api/talent-offers/:id', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** 本文からキーワードらしき語を抽出（スコア簡易計算用） */
function extractKeywords(text: string | null): Set<string> {
  if (!text) return new Set();
  const normalized = text.replace(/[　\s]+/g, ' ').toLowerCase();
  const words = normalized
    .split(/[^\w\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]+/)
    .filter((w) => w.length >= 2 && w.length <= 24);
  return new Set(words);
}

const TECH_TERMS = [
  'react',
  'next',
  'vue',
  'angular',
  'typescript',
  'javascript',
  'node',
  'java',
  'kotlin',
  'spring',
  'c#',
  '.net',
  'python',
  'go',
  'php',
  'laravel',
  'ruby',
  'rails',
  'aws',
  'gcp',
  'azure',
  'terraform',
  'kubernetes',
  'docker',
  'postgres',
  'mysql',
  'oracle',
  'redis',
  'linux',
  'sap',
  'pmo',
  'pm',
];

function extractTechTokens(text: string | null): Set<string> {
  if (!text) return new Set();
  const t = text.toLowerCase();
  const found = new Set<string>();
  for (const term of TECH_TERMS) {
    if (t.includes(term)) found.add(term);
  }
  // 日本語の代表ワード
  if (t.includes('基本設計')) found.add('基本設計');
  if (t.includes('要件定義')) found.add('要件定義');
  if (t.includes('詳細設計')) found.add('詳細設計');
  if (t.includes('運用保守')) found.add('運用保守');
  if (t.includes('構築')) found.add('構築');
  return found;
}

function extractMonth(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d{1,2})\s*月/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 12) return null;
  return n;
}

function overlapScore(
  pMin: number | null | undefined,
  pMax: number | null | undefined,
  tMin: number | null | undefined,
  tMax: number | null | undefined
): { score: number; reason?: string } {
  if (pMin == null || pMax == null || tMin == null || tMax == null) return { score: 0 };
  const left = Math.max(pMin, tMin);
  const right = Math.min(pMax, tMax);
  if (right >= left) return { score: 20 };
  const gap = left - right; // 万
  if (gap <= 5) return { score: 10, reason: '単価ズレ小' };
  if (gap <= 10) return { score: 0, reason: '単価ズレ中' };
  return { score: -15, reason: '単価ズレ大' };
}

function locationScore(projectLoc: string | null, talentLoc: string | null, projectRemoteOk: boolean | null, talentText: string): number {
  const t = talentText;
  if (projectRemoteOk === true && /リモ|在宅|フルリモ|テレワ/.test(t)) return 10;
  if (!projectLoc || !talentLoc) return 0;
  const p = projectLoc.replace(/[\s　]/g, '');
  const tt = talentLoc.replace(/[\s　]/g, '');
  if (p && tt && (p.includes(tt) || tt.includes(p))) return 10;
  const pStation = p.match(/[\u4e00-\u9faf]{2,8}駅/)?.[0];
  const tStation = tt.match(/[\u4e00-\u9faf]{2,8}駅/)?.[0];
  if (pStation && tStation && pStation === tStation) return 10;
  return -5;
}

function nationalityExclusion(projectNat: string | null, talentNat: string | null): string | null {
  if (!projectNat) return null;
  if (projectNat === '不問') return null;
  if (projectNat === '日本' && talentNat && /外国籍/.test(talentNat)) return '国籍条件（日本）';
  return null;
}

function startPeriodExclusion(projectMonth: number | null, talentMonth: number | null): string | null {
  if (!projectMonth || !talentMonth) return null;
  return Math.abs(projectMonth - talentMonth) > 1 ? '参画可能時期が案件開始時期と合いません' : null;
}

function remoteOnlyExclusion(projectRemoteOk: boolean | null, talentText: string): string | null {
  if (projectRemoteOk !== false) return null;
  return /(フルリモ|リモートのみ|在宅のみ)/.test(talentText) ? '勤務形態が一致しません（常駐寄り案件）' : null;
}

function employmentExclusion(projectText: string, talentEmploymentType: string | null, talentText: string): string | null {
  if (!/(個人不可|フリーランス不可)/.test(projectText)) return null;
  if (talentEmploymentType === '個人' || /(個人|フリーランス)/.test(talentText)) {
    return '雇用形態が一致しません（個人不可）';
  }
  return null;
}

function requiredSkillExclusion(projectSkills: Set<string>, talentSkills: Set<string>): string | null {
  if (projectSkills.size === 0) return null;
  const common = [...projectSkills].filter((skill) => talentSkills.has(skill));
  if (common.length > 0) return null;
  const first = [...projectSkills][0];
  return `必須スキル ${first} が不足しています`;
}

function buildMatchNarrative(input: {
  techScore: number;
  keywordScore: number;
  priceScore: number;
  locationScore: number;
  startScore: number;
  remoteScore: number;
  pStart: number | null;
  tStart: number | null;
  pLoc: string | null;
  tLoc: string | null;
  projectRemoteOk: boolean | null;
}) {
  const reasons: string[] = [];
  if (input.techScore >= 20) reasons.push('技術キーワードの一致度が高い');
  if (input.keywordScore >= 8) reasons.push('案件本文と人材本文の文脈が近い');
  if (input.priceScore >= 10) reasons.push('単価帯が収まりやすい');
  if (input.locationScore >= 8) reasons.push('勤務地や最寄の相性がよい');
  if (input.startScore >= 8) reasons.push('開始時期が合っている');
  if (input.remoteScore >= 8) reasons.push('働き方の希望が合っている');

  const attentionPoint =
    input.priceScore === 0
      ? '単価条件は詳細確認が必要'
      : input.projectRemoteOk == null
        ? '勤務形態は案件側の詳細確認が必要'
        : input.locationScore <= 0
          ? '勤務地や最寄条件の擦り合わせが必要'
          : '大きな懸念は少ないが、条件の最終確認は必要';

  const questions: string[] = [];
  if (input.pStart == null || input.tStart == null) questions.push('参画開始時期を双方で確認したい');
  if (!input.pLoc || !input.tLoc) questions.push('勤務地・最寄駅の許容範囲を確認したい');
  if (input.projectRemoteOk == null) questions.push('リモート可否と出社頻度を確認したい');
  if (questions.length < 2) questions.push('面談前に必須スキルの実務範囲を確認したい');
  if (questions.length < 3) questions.push('単価と商流条件のすり合わせ可否を確認したい');

  return {
    recommendationReasons: reasons.slice(0, 3),
    attentionPoint,
    confirmationQuestions: questions.slice(0, 3),
  };
}

function jaccardScore<T>(a: Set<T>, b: Set<T>, maxScore: number): number {
  if (a.size === 0 || b.size === 0) return 0;
  const common = [...a].filter((value) => b.has(value)).length;
  const union = new Set([...a, ...b]).size;
  if (union === 0) return 0;
  return Math.round((common / union) * maxScore);
}

/** 案件の重複候補（営業横断の名寄せ候補） */
app.get('/api/project-dedupe-candidates', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const salesOwner = typeof req.query.salesOwner === 'string' ? req.query.salesOwner.trim().toLowerCase() : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

    const offers = await prisma.projectOffer.findMany({
      take: 120,
      orderBy: { createdAt: 'desc' },
      include: {
        project: { select: { id: true, canonicalName: true } },
        rawEmail: {
          select: {
            id: true,
            subject: true,
            bodyText: true,
            fromAddr: true,
            toAddr: true,
            salesOwnerEmail: true,
            salesOwnerName: true,
            receivedAt: true,
          },
        },
      },
    });

    const candidates: Array<{
      left: any;
      right: any;
      score: number;
      reasons: string[];
    }> = [];

    for (let i = 0; i < offers.length; i += 1) {
      for (let j = i + 1; j < offers.length; j += 1) {
        const left = offers[i];
        const right = offers[j];
        if (left.id === right.id) continue;
        if (left.rawEmailId && right.rawEmailId && left.rawEmailId === right.rawEmailId) continue;

        const leftText = `${left.rawEmail?.subject ?? ''}\n${left.rawEmail?.bodyText ?? ''}`;
        const rightText = `${right.rawEmail?.subject ?? ''}\n${right.rawEmail?.bodyText ?? ''}`;

        if (q) {
          const haystack = `${leftText}\n${rightText}`.toLowerCase();
          if (!haystack.includes(q)) continue;
        }

        const leftOwner = (left.salesOwnerName ?? left.salesOwnerEmail ?? left.rawEmail?.salesOwnerName ?? left.rawEmail?.salesOwnerEmail ?? '').toLowerCase();
        const rightOwner = (right.salesOwnerName ?? right.salesOwnerEmail ?? right.rawEmail?.salesOwnerName ?? right.rawEmail?.salesOwnerEmail ?? '').toLowerCase();
        if (salesOwner && !leftOwner.includes(salesOwner) && !rightOwner.includes(salesOwner)) continue;

        const keywordScore = jaccardScore(extractKeywords(leftText), extractKeywords(rightText), 45);
        const techScore = jaccardScore(extractTechTokens(leftText), extractTechTokens(rightText), 20);
        const location = locationScore(left.workLocation ?? extractLocationText(leftText), right.workLocation ?? extractLocationText(rightText), left.remoteOk ?? null, rightText);
        const startLeft = extractMonth(left.startPeriod ?? extractStartText(leftText));
        const startRight = extractMonth(right.startPeriod ?? extractStartText(rightText));
        const startScore = startLeft && startRight && startLeft === startRight ? 10 : 0;
        const price = overlapScore(left.priceMin, left.priceMax, right.priceMin, right.priceMax);
        const senderScore = left.senderDomain && right.senderDomain && left.senderDomain === right.senderDomain ? 10 : 0;
        const score = Math.max(0, keywordScore + techScore + Math.max(0, location) + startScore + Math.max(0, price.score / 2) + senderScore);

        if (score < 55) continue;

        const reasons: string[] = [];
        if (keywordScore >= 20) reasons.push('本文・件名のキーワードが近い');
        if (techScore >= 10) reasons.push('技術キーワードが近い');
        if (Math.max(0, location) >= 10) reasons.push('勤務地/最寄が近い');
        if (startScore > 0) reasons.push('開始時期が一致');
        if (Math.max(0, price.score / 2) >= 5) reasons.push('単価帯が近い');
        if (senderScore > 0) reasons.push('送信元ドメインが一致');
        if (leftOwner && rightOwner && leftOwner !== rightOwner) reasons.push('担当営業が異なる');

        candidates.push({
          left,
          right,
          score,
          reasons,
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    res.json({ items: candidates.slice(0, limit) });
  } catch (e) {
    console.error('GET /api/project-dedupe-candidates', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

app.post('/api/project-dedupe-merge', async (req: Request, res: Response) => {
  try {
    const { keepOfferId, mergeOfferId } = (req.body ?? {}) as { keepOfferId?: string; mergeOfferId?: string };
    if (!keepOfferId || !mergeOfferId) {
      return sendError(res, 'VALIDATION_ERROR', 'keepOfferId と mergeOfferId は必須です。');
    }

    const [keepOffer, mergeOffer] = await Promise.all([
      prisma.projectOffer.findUnique({ where: { id: String(keepOfferId) }, select: { id: true, projectId: true } }),
      prisma.projectOffer.findUnique({ where: { id: String(mergeOfferId) }, select: { id: true, projectId: true } }),
    ]);

    if (!keepOffer || !mergeOffer) {
      return sendError(res, 'NOT_FOUND', '対象の案件オファーが見つかりません。', 404);
    }

    if (keepOffer.projectId !== mergeOffer.projectId) {
      await prisma.projectOffer.update({
        where: { id: mergeOffer.id },
        data: { projectId: keepOffer.projectId },
      });

      await prisma.activity.create({
        data: {
          userId: 'mjup',
          action: 'project_dedupe_merge',
          targetType: 'project_offer',
          targetId: keepOffer.id,
          payload: JSON.stringify({
            keepOfferId: keepOffer.id,
            mergeOfferId: mergeOffer.id,
            fromProjectId: mergeOffer.projectId,
            toProjectId: keepOffer.projectId,
          }),
        },
      });

      const remaining = await prisma.projectOffer.count({ where: { projectId: mergeOffer.projectId } });
      if (remaining === 0) {
        await prisma.project.delete({ where: { id: mergeOffer.projectId } }).catch(() => void 0);
      }
    }

    res.json({ ok: true, keepOfferId: keepOffer.id, mergeOfferId: mergeOffer.id, projectId: keepOffer.projectId });
  } catch (e) {
    console.error('POST /api/project-dedupe-merge', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

app.get('/api/project-dedupe-history', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const rows = await prisma.activity.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      where: { action: 'project_dedupe_merge' },
    });

    const items = await Promise.all(
      rows.map(async (row) => {
        const payload = row.payload ? JSON.parse(row.payload) : null;
        const [keepOffer, mergeOffer] = await Promise.all([
          payload?.keepOfferId
            ? prisma.projectOffer.findUnique({
                where: { id: payload.keepOfferId },
                include: {
                  project: { select: { canonicalName: true } },
                  rawEmail: { select: { subject: true, salesOwnerName: true, salesOwnerEmail: true, receivedAt: true } },
                },
              })
            : null,
          payload?.mergeOfferId
            ? prisma.projectOffer.findUnique({
                where: { id: payload.mergeOfferId },
                include: {
                  project: { select: { canonicalName: true } },
                  rawEmail: { select: { subject: true, salesOwnerName: true, salesOwnerEmail: true, receivedAt: true } },
                },
              })
            : null,
        ]);

        return {
          id: row.id,
          createdAt: row.createdAt,
          userId: row.userId,
          payload,
          keepOffer,
          mergeOffer,
        };
      })
    );

    res.json({
      items,
    });
  } catch (e) {
    console.error('GET /api/project-dedupe-history', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** 人材の重複候補（営業横断の名寄せ候補） */
app.get('/api/talent-dedupe-candidates', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const salesOwner = typeof req.query.salesOwner === 'string' ? req.query.salesOwner.trim().toLowerCase() : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

    const offers = await prisma.talentOffer.findMany({
      take: 120,
      orderBy: { createdAt: 'desc' },
      include: {
        talent: { select: { id: true } },
        rawEmail: {
          select: {
            id: true,
            subject: true,
            bodyText: true,
            fromAddr: true,
            toAddr: true,
            salesOwnerEmail: true,
            salesOwnerName: true,
            receivedAt: true,
          },
        },
      },
    });

    const candidates: Array<{
      left: any;
      right: any;
      score: number;
      reasons: string[];
    }> = [];

    for (let i = 0; i < offers.length; i += 1) {
      for (let j = i + 1; j < offers.length; j += 1) {
        const left = offers[i];
        const right = offers[j];
        if (left.id === right.id) continue;
        if (left.rawEmailId && right.rawEmailId && left.rawEmailId === right.rawEmailId) continue;

        const leftText = `${left.rawEmail?.subject ?? ''}\n${left.rawEmail?.bodyText ?? ''}`;
        const rightText = `${right.rawEmail?.subject ?? ''}\n${right.rawEmail?.bodyText ?? ''}`;

        if (q) {
          const haystack = `${leftText}\n${rightText}`.toLowerCase();
          if (!haystack.includes(q)) continue;
        }

        const leftOwner = (left.salesOwnerName ?? left.salesOwnerEmail ?? left.rawEmail?.salesOwnerName ?? left.rawEmail?.salesOwnerEmail ?? '').toLowerCase();
        const rightOwner = (right.salesOwnerName ?? right.salesOwnerEmail ?? right.rawEmail?.salesOwnerName ?? right.rawEmail?.salesOwnerEmail ?? '').toLowerCase();
        if (salesOwner && !leftOwner.includes(salesOwner) && !rightOwner.includes(salesOwner)) continue;

        const keywordScore = jaccardScore(extractKeywords(leftText), extractKeywords(rightText), 35);
        const techScore = jaccardScore(extractTechTokens(leftText), extractTechTokens(rightText), 25);
        const location = locationScore(left.workLocationPreference ?? extractLocationText(leftText), right.workLocationPreference ?? extractLocationText(rightText), null, rightText);
        const startLeft = extractMonth(left.startAvailableDate ?? extractStartText(leftText));
        const startRight = extractMonth(right.startAvailableDate ?? extractStartText(rightText));
        const startScore = startLeft && startRight && startLeft === startRight ? 10 : 0;
        const price = overlapScore(left.hopePriceMin, left.hopePriceMax, right.hopePriceMin, right.hopePriceMax);
        const senderScore = left.senderDomain && right.senderDomain && left.senderDomain === right.senderDomain ? 5 : 0;
        const ageScore =
          left.age != null && right.age != null
            ? Math.abs(left.age - right.age) <= 1
              ? 15
              : Math.abs(left.age - right.age) <= 3
                ? 8
                : 0
            : 0;
        const score = Math.max(0, keywordScore + techScore + Math.max(0, location) + startScore + Math.max(0, price.score / 2) + ageScore + senderScore);

        if (score < 50) continue;

        const reasons: string[] = [];
        if (keywordScore >= 15) reasons.push('本文・件名のキーワードが近い');
        if (techScore >= 10) reasons.push('技術キーワードが近い');
        if (Math.max(0, location) >= 10) reasons.push('勤務地希望/最寄が近い');
        if (startScore > 0) reasons.push('参画可能時期が一致');
        if (Math.max(0, price.score / 2) >= 5) reasons.push('希望単価帯が近い');
        if (ageScore >= 8) reasons.push('年齢が近い');
        if (senderScore > 0) reasons.push('送信元ドメインが一致');
        if (leftOwner && rightOwner && leftOwner !== rightOwner) reasons.push('担当営業が異なる');

        candidates.push({
          left,
          right,
          score,
          reasons,
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    res.json({ items: candidates.slice(0, limit) });
  } catch (e) {
    console.error('GET /api/talent-dedupe-candidates', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

app.post('/api/talent-dedupe-merge', async (req: Request, res: Response) => {
  try {
    const { keepOfferId, mergeOfferId } = (req.body ?? {}) as { keepOfferId?: string; mergeOfferId?: string };
    if (!keepOfferId || !mergeOfferId) {
      return sendError(res, 'VALIDATION_ERROR', 'keepOfferId と mergeOfferId は必須です。');
    }

    const [keepOffer, mergeOffer] = await Promise.all([
      prisma.talentOffer.findUnique({ where: { id: String(keepOfferId) }, select: { id: true, talentId: true } }),
      prisma.talentOffer.findUnique({ where: { id: String(mergeOfferId) }, select: { id: true, talentId: true } }),
    ]);

    if (!keepOffer || !mergeOffer) {
      return sendError(res, 'NOT_FOUND', '対象の人材オファーが見つかりません。', 404);
    }

    if (keepOffer.talentId !== mergeOffer.talentId) {
      await prisma.talentOffer.update({
        where: { id: mergeOffer.id },
        data: { talentId: keepOffer.talentId },
      });

      await prisma.activity.create({
        data: {
          userId: 'mjup',
          action: 'talent_dedupe_merge',
          targetType: 'talent_offer',
          targetId: keepOffer.id,
          payload: JSON.stringify({
            keepOfferId: keepOffer.id,
            mergeOfferId: mergeOffer.id,
            fromTalentId: mergeOffer.talentId,
            toTalentId: keepOffer.talentId,
          }),
        },
      });

      const remaining = await prisma.talentOffer.count({ where: { talentId: mergeOffer.talentId } });
      if (remaining === 0) {
        await prisma.talent.delete({ where: { id: mergeOffer.talentId } }).catch(() => void 0);
      }
    }

    res.json({ ok: true, keepOfferId: keepOffer.id, mergeOfferId: mergeOffer.id, talentId: keepOffer.talentId });
  } catch (e) {
    console.error('POST /api/talent-dedupe-merge', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

app.get('/api/talent-dedupe-history', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const rows = await prisma.activity.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      where: { action: 'talent_dedupe_merge' },
    });

    const items = await Promise.all(
      rows.map(async (row) => {
        const payload = row.payload ? JSON.parse(row.payload) : null;
        const [keepOffer, mergeOffer] = await Promise.all([
          payload?.keepOfferId
            ? prisma.talentOffer.findUnique({
                where: { id: payload.keepOfferId },
                include: {
                  rawEmail: { select: { subject: true, salesOwnerName: true, salesOwnerEmail: true, receivedAt: true } },
                },
              })
            : null,
          payload?.mergeOfferId
            ? prisma.talentOffer.findUnique({
                where: { id: payload.mergeOfferId },
                include: {
                  rawEmail: { select: { subject: true, salesOwnerName: true, salesOwnerEmail: true, receivedAt: true } },
                },
              })
            : null,
        ]);

        return {
          id: row.id,
          createdAt: row.createdAt,
          userId: row.userId,
          payload,
          keepOffer,
          mergeOffer,
        };
      })
    );

    res.json({
      items,
    });
  } catch (e) {
    console.error('GET /api/talent-dedupe-history', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** マッチ一覧（案件×人材。スコア内訳・除外理由・推薦閾値） */
app.get('/api/matches', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const recommendedOnly = req.query.recommendedOnly === 'true';
    const projectSalesOwner = typeof req.query.projectSalesOwner === 'string' ? req.query.projectSalesOwner.trim().toLowerCase() : '';
    const talentSalesOwner = typeof req.query.talentSalesOwner === 'string' ? req.query.talentSalesOwner.trim().toLowerCase() : '';

    const [projectOffers, talentOffers] = await Promise.all([
      prisma.projectOffer.findMany({
        take: 100,
        orderBy: { createdAt: 'desc' },
        include: {
          project: { select: { id: true, canonicalName: true } },
          rawEmail: { select: { subject: true, bodyText: true, fromAddr: true, salesOwnerEmail: true, salesOwnerName: true } },
        },
      }),
      prisma.talentOffer.findMany({
        take: 100,
        orderBy: { createdAt: 'desc' },
        include: { rawEmail: { select: { subject: true, bodyText: true, fromAddr: true, salesOwnerEmail: true, salesOwnerName: true } } },
      }),
    ]);

    const matches: Array<{
      projectOfferId: string;
      talentOfferId: string;
      projectTitle: string;
      talentTitle: string;
      projectFromAddr: string | null;
      talentFromAddr: string | null;
      projectSalesOwnerEmail: string | null;
      projectSalesOwnerName: string | null;
      talentSalesOwnerEmail: string | null;
      talentSalesOwnerName: string | null;
      projectBodyText: string | null;
      talentBodyText: string | null;
      score: number;
      scoreBreakdown: {
        base: number;
        keyword: number;
        tech: number;
        price: number;
        location: number;
        start: number;
        remote: number;
      };
      isRecommended: boolean;
      exclusionReason: string | null;
      recommendationReasons: string[];
      attentionPoint: string | null;
      confirmationQuestions: string[];
    }> = [];

    for (const po of projectOffers) {
      for (const to of talentOffers) {
        const pText = `${po.rawEmail?.subject ?? ''}\n${po.rawEmail?.bodyText ?? ''}`;
        const tText = `${to.rawEmail?.subject ?? ''}\n${to.rawEmail?.bodyText ?? ''}`;

        // 分類ミスのガード（取り込み初期は混ざりやすいので弾く）
        if (/案件/.test(to.rawEmail?.subject ?? '') || /案件/.test(to.rawEmail?.bodyText ?? '')) {
          continue;
        }
        if (/人材|要員|スキルシート/.test(po.rawEmail?.subject ?? '') || /人材|要員|スキルシート/.test(po.rawEmail?.bodyText ?? '')) {
          continue;
        }

        // Hard exclusions (MVP)：国籍だけ先に効かせる（本文抽出）
        const poNat = extractNationality(pText);
        const toNat = extractNationality(tText);
        const pTech = extractTechTokens(pText);
        const tTech = extractTechTokens(tText);
        const pPrice = extractPriceMan(pText);
        const tPrice = extractPriceMan(tText);
        const pLoc = extractLocationText(pText);
        const tLoc = extractLocationText(tText);
        const remoteFlagProject = extractRemoteOk(pText);
        const pStart = extractMonth(extractStartText(pText));
        const tStart = extractMonth(extractStartText(tText));

        const exclusionReason =
          nationalityExclusion(poNat, toNat) ??
          (pPrice.max != null && tPrice.min != null && pPrice.max < tPrice.min ? '希望単価が案件上限を上回っています' : null) ??
          startPeriodExclusion(pStart, tStart) ??
          remoteOnlyExclusion(remoteFlagProject, tText) ??
          employmentExclusion(pText, to.employmentTypeText ?? extractEmploymentTypeText(tText), tText) ??
          requiredSkillExclusion(pTech, tTech);
        if (exclusionReason) {
          matches.push({
            projectOfferId: po.id,
            talentOfferId: to.id,
            projectTitle: po.project?.canonicalName || po.rawEmail?.subject || '（案件）',
            talentTitle: to.rawEmail?.subject || '（人材）',
            projectFromAddr: po.rawEmail?.fromAddr ?? null,
            talentFromAddr: to.rawEmail?.fromAddr ?? null,
            projectSalesOwnerEmail: po.salesOwnerEmail ?? po.rawEmail?.salesOwnerEmail ?? null,
            projectSalesOwnerName: po.salesOwnerName ?? po.rawEmail?.salesOwnerName ?? null,
            talentSalesOwnerEmail: to.salesOwnerEmail ?? to.rawEmail?.salesOwnerEmail ?? null,
            talentSalesOwnerName: to.salesOwnerName ?? to.rawEmail?.salesOwnerName ?? null,
            projectBodyText: po.rawEmail?.bodyText ?? null,
            talentBodyText: to.rawEmail?.bodyText ?? null,
            score: 0,
            scoreBreakdown: { base: 0, keyword: 0, tech: 0, price: 0, location: 0, start: 0, remote: 0 },
            isRecommended: false,
            exclusionReason,
            recommendationReasons: [],
            attentionPoint: null,
            confirmationQuestions: [],
          });
          continue;
        }

        // Keyword/Tech similarity
        const pKw = extractKeywords(pText);
        const tKw = extractKeywords(tText);
        const common = [...pKw].filter((w) => tKw.has(w)).length;
        const union = new Set([...pKw, ...tKw]).size;
        const keywordScore = union > 0 ? Math.round(15 * (common / union)) : 0;

        const techCommon = [...pTech].filter((w) => tTech.has(w)).length;
        const techUnion = new Set([...pTech, ...tTech]).size;
        const techScore = techUnion > 0 ? Math.round(45 * (techCommon / techUnion)) : 0;

        // Price / location / start / remote
        const priceScore = Math.max(0, overlapScore(pPrice.min, pPrice.max, tPrice.min, tPrice.max).score);

        const location = locationScore(pLoc, tLoc, remoteFlagProject, tText);
        const startScore = pStart && tStart && pStart === tStart ? 10 : pStart && tStart ? 4 : 0;
        const remoteScore = remoteFlagProject === true && /リモ|在宅|フルリモ|テレワ/.test(tText) ? 10 : remoteFlagProject === false ? 5 : 0;

        const base = 15;
        const scoreRaw = base + keywordScore + techScore + priceScore + location + startScore + remoteScore;
        const score = Math.max(0, Math.min(100, Math.round(scoreRaw)));
        const isRecommended = score >= SCORE_THRESHOLD;
        const narrative = buildMatchNarrative({
          techScore,
          keywordScore,
          priceScore,
          locationScore: location,
          startScore,
          remoteScore,
          pStart,
          tStart,
          pLoc,
          tLoc,
          projectRemoteOk: remoteFlagProject,
        });

        matches.push({
          projectOfferId: po.id,
          talentOfferId: to.id,
          projectTitle: po.project?.canonicalName || po.rawEmail?.subject || '（案件）',
          talentTitle: to.rawEmail?.subject || '（人材）',
          projectFromAddr: po.rawEmail?.fromAddr ?? null,
          talentFromAddr: to.rawEmail?.fromAddr ?? null,
          projectSalesOwnerEmail: po.salesOwnerEmail ?? po.rawEmail?.salesOwnerEmail ?? null,
          projectSalesOwnerName: po.salesOwnerName ?? po.rawEmail?.salesOwnerName ?? null,
          talentSalesOwnerEmail: to.salesOwnerEmail ?? to.rawEmail?.salesOwnerEmail ?? null,
          talentSalesOwnerName: to.salesOwnerName ?? to.rawEmail?.salesOwnerName ?? null,
          projectBodyText: po.rawEmail?.bodyText ?? null,
          talentBodyText: to.rawEmail?.bodyText ?? null,
          score,
          scoreBreakdown: {
            base,
            keyword: keywordScore,
            tech: techScore,
            price: priceScore,
            location,
            start: startScore,
            remote: remoteScore,
          },
          isRecommended,
          exclusionReason: null,
          recommendationReasons: narrative.recommendationReasons,
          attentionPoint: narrative.attentionPoint,
          confirmationQuestions: narrative.confirmationQuestions,
        });
      }
    }

    let filtered = matches.sort((a, b) => b.score - a.score);
    if (projectSalesOwner) {
      filtered = filtered.filter((m) =>
        `${m.projectSalesOwnerName ?? ''} ${m.projectSalesOwnerEmail ?? ''}`.toLowerCase().includes(projectSalesOwner)
      );
    }
    if (talentSalesOwner) {
      filtered = filtered.filter((m) =>
        `${m.talentSalesOwnerName ?? ''} ${m.talentSalesOwnerEmail ?? ''}`.toLowerCase().includes(talentSalesOwner)
      );
    }
    if (recommendedOnly) filtered = filtered.filter((m) => m.isRecommended);
    res.json({
      items: filtered.slice(0, limit),
      total: filtered.length,
      scoreThreshold: SCORE_THRESHOLD,
    });
  } catch (e) {
    console.error('GET /api/matches', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

function decodeBase64Url(data: string): string {
  const pad = '='.repeat((4 - (data.length % 4)) % 4);
  const b64 = (data + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf-8');
}

function pickTextPlain(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  // multipart
  if (Array.isArray(payload.parts)) {
    for (const p of payload.parts) {
      const t = pickTextPlain(p);
      if (t) return t;
    }
  }
  // fallback to snippet-like
  return '';
}

function headerValue(headers: any[] | undefined, name: string): string {
  if (!headers) return '';
  const h = headers.find((x) => (x.name || '').toLowerCase() === name.toLowerCase());
  return (h?.value as string) || '';
}

function autoClassifyFromText(text: string): 'project' | 'talent' | null {
  const t = text;
  // 両方出るケースは「案件」優先（案件メールに「要員」「人材」ワードが混ざることがある）
  const looksProject = /\[?案件\]?|募集|要件|勤務地|面談\d回|単価\s*[:：]|商流|最寄|駅/.test(t);
  const looksTalent = /\[?人材\]?|スキルシート|要員情報|要員\b|希望単価|経歴|年齢\s*[:：]|稼働|参画|スキル\s*[:：]/.test(t);
  if (looksProject) return 'project';
  if (looksTalent) return 'talent';
  return null;
}

async function importGmailMessage(gmail: any, gid: string) {
  const messageId = `gmail:${gid}`;
  const exists = await prisma.rawEmail.findFirst({ where: { messageId } });
  if (exists) return;

  const msg = await gmail.users.messages.get({ userId: 'me', id: gid, format: 'full' });
  const payload: any = msg.data.payload;
  const headers: any[] = payload?.headers ?? [];
  const subject = headerValue(headers, 'Subject').slice(0, SUBJECT_MAX);
  const fromAddr = headerValue(headers, 'From').slice(0, FROM_MAX) || '（未設定）';
  const toAddr = headerValue(headers, 'To').slice(0, FROM_MAX) || null;
  const ccAddr = headerValue(headers, 'Cc').slice(0, FROM_MAX) || null;
  const deliveredToAddr = headerValue(headers, 'Delivered-To').slice(0, FROM_MAX) || null;
  const originalRecipient = (headerValue(headers, 'X-Original-To') || headerValue(headers, 'X-Original-Recipient')).slice(0, FROM_MAX) || null;
  const salesOwner = deriveSalesOwner({ toAddr, ccAddr, deliveredToAddr, originalRecipient });

  const bodyTextRaw = pickTextPlain(payload) || '';
  const bodyText = bodyTextRaw.slice(0, BODY_MAX);
  const receivedAt = msg.data.internalDate ? new Date(Number(msg.data.internalDate)) : new Date();

  const created = await prisma.rawEmail.create({
    data: {
      messageId,
      receivedAt,
      fromAddr,
      toAddr,
      ccAddr,
      deliveredToAddr,
      originalRecipient,
      salesOwnerEmail: salesOwner.salesOwnerEmail ?? undefined,
      salesOwnerName: salesOwner.salesOwnerName ?? undefined,
      subject,
      bodyText,
      processingStatus: 'pending',
    },
  });

  // 自動分類（MVP）：当たればそのままOffer作成まで
  let cls = autoClassifyFromText(`${subject}\n${bodyText}`);
  // AIで分類も補強（最初からガッツリAI）
  if (!cls && OPENAI_API_KEY) {
    const ai = await aiExtractAndPersist(created.id).catch(() => null);
    if (ai?.classification) cls = ai.classification;
  }

  if (cls) {
    await prisma.rawEmail.update({ where: { id: created.id }, data: { classification: cls } });

    const rawEmail = await prisma.rawEmail.findUnique({ where: { id: created.id } });
    if (rawEmail) {
      const sourceText = `${rawEmail.subject ?? ''}\n${rawEmail.bodyText ?? ''}`;
      const senderDomain = getSenderDomain(rawEmail.fromAddr);
      const salesOwnerEmail = rawEmail.salesOwnerEmail;
      const salesOwnerName = rawEmail.salesOwnerName;
      const ai = await aiExtractAndPersist(created.id).catch(() => null);

      if (cls === 'project') {
        const project = await prisma.project.create({ data: { canonicalName: (rawEmail.subject || '案件').slice(0, 200) } });
        const price = ai?.classification === 'project' ? { min: ai.fields.priceMin, max: ai.fields.priceMax } : extractPriceMan(sourceText);
        await prisma.projectOffer.create({
          data: {
            projectId: project.id,
            rawEmailId: rawEmail.id,
            senderDomain,
            salesOwnerEmail: salesOwnerEmail ?? undefined,
            salesOwnerName: salesOwnerName ?? undefined,
            priceMin: price.min,
            priceMax: price.max,
            supplyChainDepth: ai?.classification === 'project' ? (ai.fields.supplyChainDepth ?? undefined) : extractSupplyChainDepth(sourceText) ?? undefined,
            interviewCount: ai?.classification === 'project' ? (ai.fields.interviewCount ?? undefined) : extractInterviewCount(sourceText) ?? undefined,
            workLocation: ai?.classification === 'project' ? (ai.fields.workLocation ?? undefined) : extractLocationText(sourceText) ?? undefined,
            remoteOk: ai?.classification === 'project' ? (ai.fields.remoteOk ?? undefined) : extractRemoteOk(sourceText) ?? undefined,
            startPeriod: ai?.classification === 'project' ? (ai.fields.startPeriod ?? undefined) : extractStartText(sourceText) ?? undefined,
            nationalityRequirement: ai?.classification === 'project' ? (ai.fields.nationalityRequirement ?? undefined) : extractNationality(sourceText) ?? undefined,
            extractedAt: new Date(),
          },
        });
      } else {
        const talent = await prisma.talent.create({ data: {} });
        const price = ai?.classification === 'talent' ? { min: ai.fields.hopePriceMin, max: ai.fields.hopePriceMax } : extractPriceMan(sourceText);
        await prisma.talentOffer.create({
          data: {
            talentId: talent.id,
            rawEmailId: rawEmail.id,
            senderDomain,
            salesOwnerEmail: salesOwnerEmail ?? undefined,
            salesOwnerName: salesOwnerName ?? undefined,
            hopePriceMin: price.min,
            hopePriceMax: price.max,
            age: ai?.classification === 'talent' ? (ai.fields.age ?? undefined) : extractAge(sourceText) ?? undefined,
            employmentTypeText: ai?.classification === 'talent' ? (ai.fields.employmentTypeText ?? undefined) : extractEmploymentTypeText(sourceText) ?? undefined,
            workLocationPreference: ai?.classification === 'talent' ? (ai.fields.workLocationPreference ?? undefined) : extractLocationText(sourceText) ?? undefined,
            startAvailableDate: ai?.classification === 'talent' ? (ai.fields.startAvailableDate ?? undefined) : extractStartText(sourceText) ?? undefined,
            nationalityText: ai?.classification === 'talent' ? (ai.fields.nationalityText ?? undefined) : extractNationality(sourceText) ?? undefined,
            extractedAt: new Date(),
          },
        });
      }

      await prisma.rawEmail.update({ where: { id: rawEmail.id }, data: { processingStatus: 'extracted' } });
    }
  }
}

async function gmailImportOnce() {
  if (!GMAIL_IMPORT_ACCOUNT) return;

  const authRow = await prisma.googleAuth.findUnique({ where: { email: GMAIL_IMPORT_ACCOUNT } });
  if (!authRow || !authRow.refreshToken) {
    console.warn('[gmail] not connected yet. open /api/google/oauth2/start?account=...');
    return;
  }

  const oauth2 = getOAuthClient();
  oauth2.setCredentials({
    refresh_token: authRow.refreshToken,
    access_token: authRow.accessToken ?? undefined,
    expiry_date: authRow.expiryDateMs ? Number(authRow.expiryDateMs) : undefined,
  });

  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  // 初回はプロフィールのhistoryIdを取得して、直近分を取り込んだ後にカーソルをセット
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const currentHistoryId = profile.data.historyId ?? null;

  if (!authRow.lastHistoryId) {
    console.log('[gmail] initial sync (lookback)');
    const q = `newer_than:${GMAIL_IMPORT_LOOKBACK_DAYS}d`;
    const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: 50 });
    const msgIds = (list.data.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
    for (const gid of msgIds) {
      await importGmailMessage(gmail, gid);
    }

    await prisma.googleAuth.update({
      where: { email: GMAIL_IMPORT_ACCOUNT },
      data: {
        lastHistoryId: currentHistoryId,
        lastSyncedAt: new Date(),
      },
    });
    return;
  }

  // 差分同期（取りこぼし防止）：history.list
  try {
    let pageToken: string | undefined = undefined;
    let newestHistoryId: string | null = null;
    const startHistoryId = authRow.lastHistoryId;

    do {
      const h: any = await gmail.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: ['messageAdded'],
        pageToken,
        maxResults: 100,
      });

      if (h.data.historyId) newestHistoryId = h.data.historyId;
      const history = h.data.history ?? [];
      for (const item of history) {
        const added = item.messagesAdded ?? [];
        for (const ma of added) {
          const gid = ma.message?.id;
          if (gid) await importGmailMessage(gmail, gid);
        }
      }

      pageToken = h.data.nextPageToken ?? undefined;
    } while (pageToken);

    await prisma.googleAuth.update({
      where: { email: GMAIL_IMPORT_ACCOUNT },
      data: {
        lastHistoryId: newestHistoryId ?? authRow.lastHistoryId,
        lastSyncedAt: new Date(),
      },
    });
  } catch (e: any) {
    // startHistoryId が古すぎる場合は 404 が返る
    const msg = String(e?.message ?? e);
    if (msg.includes('Requested entity was not found') || msg.includes('404')) {
      console.warn('[gmail] historyId too old -> resync lookback');
      const q = `newer_than:${GMAIL_IMPORT_LOOKBACK_DAYS}d`;
      const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: 50 });
      const msgIds = (list.data.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
      for (const gid of msgIds) {
        await importGmailMessage(gmail, gid);
      }
      await prisma.googleAuth.update({
        where: { email: GMAIL_IMPORT_ACCOUNT },
        data: { lastHistoryId: currentHistoryId, lastSyncedAt: new Date() },
      });
      return;
    }
    throw e;
  }
}

function startGmailPolling() {
  if (!GMAIL_IMPORT_ACCOUNT) {
    console.log('[gmail] GMAIL_IMPORT_ACCOUNT is empty. (skip polling)');
    return;
  }
  if (!Number.isFinite(GMAIL_IMPORT_POLL_SEC) || GMAIL_IMPORT_POLL_SEC < 10) {
    console.log('[gmail] GMAIL_IMPORT_POLL_SEC invalid. (skip polling)');
    return;
  }

  console.log(`[gmail] polling enabled. account=${GMAIL_IMPORT_ACCOUNT} interval=${GMAIL_IMPORT_POLL_SEC}s lookback=${GMAIL_IMPORT_LOOKBACK_DAYS}d`);

  const run = async () => {
    try {
      await gmailImportOnce();
    } catch (e) {
      console.error('[gmail] import error', e);
    }
  };

  run();
  setInterval(run, GMAIL_IMPORT_POLL_SEC * 1000);
}

// ========== 追加エンドポイント ==========

/** AI分類のみ: POST /api/raw-emails/:id/classify */
app.post('/api/raw-emails/:id/classify', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const rawEmail = await prisma.rawEmail.findUnique({ where: { id } });
    if (!rawEmail) return sendError(res, 'NOT_FOUND', '指定されたメールが見つかりません。', 404);

    const text = `${rawEmail.subject ?? ''}\n${rawEmail.bodyText ?? ''}`.slice(0, 12000);

    // まずルールベースで判定
    let classification = autoClassifyFromText(text);

    // ルールベースで判定できなければAI判定
    if (!classification && OPENAI_API_KEY) {
      const client = getOpenAI();
      const resp = await client.responses.create({
        model: OPENAI_MODEL,
        input: [
          {
            role: 'system',
            content: 'あなたはSESメールの分類エンジンです。メールを「project」（案件募集）、「talent」（人材提案）、「other」（どちらでもない）に分類してください。JSON形式で返答してください。',
          },
          {
            role: 'user',
            content: `以下のメールを分類してください。\n\n---\n${text}\n---`,
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'classify_email',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                classification: { type: 'string', enum: ['project', 'talent', 'other'] },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                reason: { type: 'string' },
              },
              required: ['classification', 'confidence'],
            },
          },
        } as any,
      } as any);

      const out = resp.output_text ? JSON.parse(resp.output_text) : null;
      if (out?.classification === 'project' || out?.classification === 'talent') {
        classification = out.classification;
      }
    }

    const row = await prisma.rawEmail.update({
      where: { id },
      data: { classification: classification ?? 'other' },
    });

    res.json(row);
  } catch (e) {
    console.error('POST /api/raw-emails/:id/classify', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** AI抽出: POST /api/raw-emails/:id/extract */
app.post('/api/raw-emails/:id/extract', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const rawEmail = await prisma.rawEmail.findUnique({ where: { id } });
    if (!rawEmail) return sendError(res, 'NOT_FOUND', '指定されたメールが見つかりません。', 404);

    // 分類がなければまず分類する
    let classification = rawEmail.classification;
    if (!classification || classification === 'other') {
      const text = `${rawEmail.subject ?? ''}\n${rawEmail.bodyText ?? ''}`;
      classification = autoClassifyFromText(text);

      if (!classification && OPENAI_API_KEY) {
        const ai = await aiExtractAndPersist(id).catch(() => null);
        classification = ai?.classification ?? null;
      }

      if (!classification) {
        return sendError(res, 'CLASSIFY_FAILED', 'メールの分類ができませんでした。手動で分類してください。');
      }

      await prisma.rawEmail.update({ where: { id }, data: { classification } });
    }

    const text = `${rawEmail.subject ?? ''}\n${rawEmail.bodyText ?? ''}`.slice(0, 12000);
    const senderDomain = getSenderDomain(rawEmail.fromAddr);
    const salesOwnerEmail = rawEmail.salesOwnerEmail;
    const salesOwnerName = rawEmail.salesOwnerName;

    if (classification === 'project') {
      // 既存のProjectOfferがあればスキップ
      const existing = await prisma.projectOffer.findFirst({ where: { rawEmailId: id } });
      if (existing) {
        const row = await prisma.rawEmail.update({
          where: { id },
          data: { processingStatus: 'extracted' },
        });
        return res.json({ rawEmail: row, projectOffer: existing });
      }

      // AI抽出
      let extractedFields: any = {};
      if (OPENAI_API_KEY) {
        const projectPrompt = `あなたはSESの案件メールから項目を抽出するエンジンです。日本語メールから、固定スキーマに従って情報を抽出してください。

ルール:
- 推測禁止。本文に書かれていない値は null とする。
- 各項目について、根拠となった本文の1行（または短い抜粋）を *Evidence に書く。
- 確信度を 0〜1 で *Confidence に付与する。曖昧な場合は低くする。
- スキルは正規化ID（辞書の code）で返す。辞書にない表記は raw の文言をメモし、skillId は null とする。
- 単価は「万/月」の数値で抽出してください。`;

        const client = getOpenAI();
        const resp = await client.responses.create({
          model: OPENAI_MODEL,
          input: [
            { role: 'system', content: projectPrompt },
            {
              role: 'user',
              content: `以下のメール本文から案件の情報を抽出してください。\n\n件名: ${rawEmail.subject ?? ''}\n本文:\n${rawEmail.bodyText ?? ''}`,
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'project_extract',
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  priceMin: { type: ['number', 'null'] },
                  priceMinEvidence: { type: ['string', 'null'] },
                  priceMinConfidence: { type: ['number', 'null'] },
                  priceMax: { type: ['number', 'null'] },
                  priceMaxEvidence: { type: ['string', 'null'] },
                  priceMaxConfidence: { type: ['number', 'null'] },
                  requiredSkillIds: { type: 'array', items: { type: 'string' } },
                  requiredSkillsEvidence: { type: ['string', 'null'] },
                  requiredSkillsConfidence: { type: ['number', 'null'] },
                  optionalSkillIds: { type: 'array', items: { type: 'string' } },
                  optionalSkillsEvidence: { type: ['string', 'null'] },
                  optionalSkillsConfidence: { type: ['number', 'null'] },
                  workLocation: { type: ['string', 'null'] },
                  workLocationEvidence: { type: ['string', 'null'] },
                  workLocationConfidence: { type: ['number', 'null'] },
                  remoteOk: { type: ['boolean', 'null'] },
                  remoteOkEvidence: { type: ['string', 'null'] },
                  remoteOkConfidence: { type: ['number', 'null'] },
                  availability: { type: ['string', 'null'] },
                  startPeriod: { type: ['string', 'null'] },
                  startPeriodEvidence: { type: ['string', 'null'] },
                  startPeriodConfidence: { type: ['number', 'null'] },
                  duration: { type: ['string', 'null'] },
                  nationalityRequirement: { type: ['string', 'null'] },
                  supplyChainDepth: { type: ['number', 'null'] },
                  interviewCount: { type: ['number', 'null'] },
                },
                required: [],
              },
            },
          } as any,
        } as any);
        extractedFields = resp.output_text ? JSON.parse(resp.output_text) : {};
      } else {
        // フォールバック: 正規表現抽出
        const price = extractPriceMan(text);
        extractedFields = {
          priceMin: price.min ?? null,
          priceMax: price.max ?? null,
          workLocation: extractLocationText(text),
          remoteOk: extractRemoteOk(text),
          startPeriod: extractStartText(text),
          nationalityRequirement: extractNationality(text),
          supplyChainDepth: extractSupplyChainDepth(text),
          interviewCount: extractInterviewCount(text),
        };
      }

      const project = await prisma.project.create({
        data: { canonicalName: (rawEmail.subject || '案件').slice(0, 200) },
      });

      const projectOffer = await prisma.projectOffer.create({
        data: {
          projectId: project.id,
          rawEmailId: id,
          senderDomain,
          salesOwnerEmail: salesOwnerEmail ?? undefined,
          salesOwnerName: salesOwnerName ?? undefined,
          priceMin: extractedFields.priceMin ?? undefined,
          priceMax: extractedFields.priceMax ?? undefined,
          requiredSkillIds: extractedFields.requiredSkillIds ? JSON.stringify(extractedFields.requiredSkillIds) : undefined,
          optionalSkillIds: extractedFields.optionalSkillIds ? JSON.stringify(extractedFields.optionalSkillIds) : undefined,
          workLocation: extractedFields.workLocation ?? undefined,
          remoteOk: extractedFields.remoteOk ?? undefined,
          availability: extractedFields.availability ?? undefined,
          startPeriod: extractedFields.startPeriod ?? undefined,
          duration: extractedFields.duration ?? undefined,
          nationalityRequirement: extractedFields.nationalityRequirement ?? undefined,
          supplyChainDepth: extractedFields.supplyChainDepth ?? undefined,
          interviewCount: extractedFields.interviewCount ?? undefined,
          confidenceFlags: OPENAI_API_KEY ? JSON.stringify(extractedFields) : undefined,
          extractedAt: new Date(),
        },
      });

      await prisma.rawEmail.update({
        where: { id },
        data: {
          processingStatus: 'extracted',
          aiModel: OPENAI_API_KEY ? OPENAI_MODEL : null,
          aiJson: OPENAI_API_KEY ? JSON.stringify(extractedFields) : null,
          aiExtractedAt: new Date(),
        },
      });

      res.json({ rawEmail: { id, classification, processingStatus: 'extracted' }, projectOffer });
    } else if (classification === 'talent') {
      // 既存のTalentOfferがあればスキップ
      const existing = await prisma.talentOffer.findFirst({ where: { rawEmailId: id } });
      if (existing) {
        const row = await prisma.rawEmail.update({
          where: { id },
          data: { processingStatus: 'extracted' },
        });
        return res.json({ rawEmail: row, talentOffer: existing });
      }

      let extractedFields: any = {};
      if (OPENAI_API_KEY) {
        const talentPrompt = `あなたはSESの人材メールから項目を抽出するエンジンです。日本語メールから、固定スキーマに従って情報を抽出してください。

ルール:
- 推測禁止。本文に書かれていない値は null とする。
- 各項目について、根拠となった本文の1行（または短い抜粋）を *Evidence に書く。
- 確信度を 0〜1 で *Confidence に付与する。曖昧な場合は低くする。
- スキルは正規化ID（辞書の code）で返す。辞書にない表記は raw の文言をメモし、skillId は null とする。
- スキルシートがURLや添付で言及されていれば反映する。
- 単価は「万/月」の数値で抽出してください。`;

        const client = getOpenAI();
        const resp = await client.responses.create({
          model: OPENAI_MODEL,
          input: [
            { role: 'system', content: talentPrompt },
            {
              role: 'user',
              content: `以下のメール本文から人材の情報を抽出してください。\n\n件名: ${rawEmail.subject ?? ''}\n本文:\n${rawEmail.bodyText ?? ''}`,
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'talent_extract',
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  hopePriceMin: { type: ['number', 'null'] },
                  hopePriceMinEvidence: { type: ['string', 'null'] },
                  hopePriceMinConfidence: { type: ['number', 'null'] },
                  hopePriceMax: { type: ['number', 'null'] },
                  hopePriceMaxEvidence: { type: ['string', 'null'] },
                  hopePriceMaxConfidence: { type: ['number', 'null'] },
                  age: { type: ['number', 'null'] },
                  ageEvidence: { type: ['string', 'null'] },
                  ageConfidence: { type: ['number', 'null'] },
                  employmentTypeId: { type: ['string', 'null'] },
                  employmentTypeEvidence: { type: ['string', 'null'] },
                  employmentTypeConfidence: { type: ['number', 'null'] },
                  nearestStationId: { type: ['string', 'null'] },
                  workLocationPreference: { type: ['string', 'null'] },
                  workLocationEvidence: { type: ['string', 'null'] },
                  workLocationConfidence: { type: ['number', 'null'] },
                  skills: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        skillId: { type: 'string' },
                        years: { type: ['number', 'null'] },
                        lastUsed: { type: ['string', 'null'] },
                        evidence: { type: ['string', 'null'] },
                        confidence: { type: ['number', 'null'] },
                      },
                      required: ['skillId'],
                    },
                  },
                  availability: { type: ['string', 'null'] },
                  availabilityEvidence: { type: ['string', 'null'] },
                  availabilityConfidence: { type: ['number', 'null'] },
                  startAvailableDate: { type: ['string', 'null'] },
                  startAvailableEvidence: { type: ['string', 'null'] },
                  startAvailableConfidence: { type: ['number', 'null'] },
                  nationalityText: { type: ['string', 'null'] },
                  skillSheetUrl: { type: ['string', 'null'] },
                },
                required: [],
              },
            },
          } as any,
        } as any);
        extractedFields = resp.output_text ? JSON.parse(resp.output_text) : {};
      } else {
        const price = extractPriceMan(text);
        extractedFields = {
          hopePriceMin: price.min ?? null,
          hopePriceMax: price.max ?? null,
          age: extractAge(text),
          employmentTypeId: extractEmploymentTypeText(text),
          workLocationPreference: extractLocationText(text),
          startAvailableDate: extractStartText(text),
          nationalityText: extractNationality(text),
        };
      }

      const talent = await prisma.talent.create({ data: {} });

      const skillsWithYears = extractedFields.skills
        ? JSON.stringify(extractedFields.skills.map((s: any) => ({ skillId: s.skillId, years: s.years ?? null })))
        : undefined;

      const talentOffer = await prisma.talentOffer.create({
        data: {
          talentId: talent.id,
          rawEmailId: id,
          senderDomain,
          salesOwnerEmail: salesOwnerEmail ?? undefined,
          salesOwnerName: salesOwnerName ?? undefined,
          hopePriceMin: extractedFields.hopePriceMin ?? undefined,
          hopePriceMax: extractedFields.hopePriceMax ?? undefined,
          age: extractedFields.age ?? undefined,
          employmentTypeText: extractedFields.employmentTypeId ?? undefined,
          workLocationPreference: extractedFields.workLocationPreference ?? undefined,
          skillIdsWithYears: skillsWithYears,
          availability: extractedFields.availability ?? undefined,
          startAvailableDate: extractedFields.startAvailableDate ?? undefined,
          nationalityText: extractedFields.nationalityText ?? undefined,
          skillSheetUrl: extractedFields.skillSheetUrl ?? undefined,
          confidenceFlags: OPENAI_API_KEY ? JSON.stringify(extractedFields) : undefined,
          extractedAt: new Date(),
        },
      });

      await prisma.rawEmail.update({
        where: { id },
        data: {
          processingStatus: 'extracted',
          aiModel: OPENAI_API_KEY ? OPENAI_MODEL : null,
          aiJson: OPENAI_API_KEY ? JSON.stringify(extractedFields) : null,
          aiExtractedAt: new Date(),
        },
      });

      res.json({ rawEmail: { id, classification, processingStatus: 'extracted' }, talentOffer });
    } else {
      return sendError(res, 'CLASSIFY_FAILED', `分類結果が「${classification}」のため抽出できません。`);
    }
  } catch (e) {
    console.error('POST /api/raw-emails/:id/extract', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** 一括処理: POST /api/raw-emails/process-all */
app.post('/api/raw-emails/process-all', async (_req: Request, res: Response) => {
  try {
    const unprocessed = await prisma.rawEmail.findMany({
      where: { processingStatus: 'pending' },
      orderBy: { receivedAt: 'desc' },
      take: 100,
    });

    const results: Array<{ id: string; classification: string | null; status: string; error?: string }> = [];

    for (const rawEmail of unprocessed) {
      try {
        const text = `${rawEmail.subject ?? ''}\n${rawEmail.bodyText ?? ''}`;
        let classification = autoClassifyFromText(text);

        // AI分類
        if (!classification && OPENAI_API_KEY) {
          const ai = await aiExtractAndPersist(rawEmail.id).catch(() => null);
          classification = ai?.classification ?? null;
        }

        if (!classification) {
          await prisma.rawEmail.update({
            where: { id: rawEmail.id },
            data: { classification: 'other', processingStatus: 'skipped' },
          });
          results.push({ id: rawEmail.id, classification: 'other', status: 'skipped' });
          continue;
        }

        // 分類を保存
        await prisma.rawEmail.update({
          where: { id: rawEmail.id },
          data: { classification },
        });

        // 抽出 (既存のclassificationエンドポイントと同じロジックを再利用)
        const senderDomain = getSenderDomain(rawEmail.fromAddr);
        const salesOwnerEmail = rawEmail.salesOwnerEmail;
        const salesOwnerName = rawEmail.salesOwnerName;
        const sourceText = text;
        const ai = await aiExtractAndPersist(rawEmail.id).catch(() => null);

        if (classification === 'project') {
          const existingOffer = await prisma.projectOffer.findFirst({ where: { rawEmailId: rawEmail.id } });
          if (!existingOffer) {
            const project = await prisma.project.create({ data: { canonicalName: (rawEmail.subject || '案件').slice(0, 200) } });
            const price = ai?.classification === 'project' ? { min: ai.fields.priceMin, max: ai.fields.priceMax } : extractPriceMan(sourceText);
            await prisma.projectOffer.create({
              data: {
                projectId: project.id,
                rawEmailId: rawEmail.id,
                senderDomain,
                salesOwnerEmail: salesOwnerEmail ?? undefined,
                salesOwnerName: salesOwnerName ?? undefined,
                priceMin: price.min,
                priceMax: price.max,
                supplyChainDepth: ai?.classification === 'project' ? (ai.fields.supplyChainDepth ?? undefined) : extractSupplyChainDepth(sourceText) ?? undefined,
                interviewCount: ai?.classification === 'project' ? (ai.fields.interviewCount ?? undefined) : extractInterviewCount(sourceText) ?? undefined,
                workLocation: ai?.classification === 'project' ? (ai.fields.workLocation ?? undefined) : extractLocationText(sourceText) ?? undefined,
                remoteOk: ai?.classification === 'project' ? (ai.fields.remoteOk ?? undefined) : extractRemoteOk(sourceText) ?? undefined,
                startPeriod: ai?.classification === 'project' ? (ai.fields.startPeriod ?? undefined) : extractStartText(sourceText) ?? undefined,
                nationalityRequirement: ai?.classification === 'project' ? (ai.fields.nationalityRequirement ?? undefined) : extractNationality(sourceText) ?? undefined,
                extractedAt: new Date(),
              },
            });
          }
        } else {
          const existingOffer = await prisma.talentOffer.findFirst({ where: { rawEmailId: rawEmail.id } });
          if (!existingOffer) {
            const talent = await prisma.talent.create({ data: {} });
            const price = ai?.classification === 'talent' ? { min: ai.fields.hopePriceMin, max: ai.fields.hopePriceMax } : extractPriceMan(sourceText);
            await prisma.talentOffer.create({
              data: {
                talentId: talent.id,
                rawEmailId: rawEmail.id,
                senderDomain,
                salesOwnerEmail: salesOwnerEmail ?? undefined,
                salesOwnerName: salesOwnerName ?? undefined,
                hopePriceMin: price.min,
                hopePriceMax: price.max,
                age: ai?.classification === 'talent' ? (ai.fields.age ?? undefined) : extractAge(sourceText) ?? undefined,
                employmentTypeText: ai?.classification === 'talent' ? (ai.fields.employmentTypeText ?? undefined) : extractEmploymentTypeText(sourceText) ?? undefined,
                workLocationPreference: ai?.classification === 'talent' ? (ai.fields.workLocationPreference ?? undefined) : extractLocationText(sourceText) ?? undefined,
                startAvailableDate: ai?.classification === 'talent' ? (ai.fields.startAvailableDate ?? undefined) : extractStartText(sourceText) ?? undefined,
                nationalityText: ai?.classification === 'talent' ? (ai.fields.nationalityText ?? undefined) : extractNationality(sourceText) ?? undefined,
                extractedAt: new Date(),
              },
            });
          }
        }

        await prisma.rawEmail.update({
          where: { id: rawEmail.id },
          data: { processingStatus: 'extracted' },
        });
        results.push({ id: rawEmail.id, classification, status: 'extracted' });
      } catch (e) {
        console.error(`process-all: failed for ${rawEmail.id}`, e);
        results.push({ id: rawEmail.id, classification: null, status: 'error', error: String(e) });
      }
    }

    res.json({ processed: results.length, results });
  } catch (e) {
    console.error('POST /api/raw-emails/process-all', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** Project一覧: GET /api/projects */
app.get('/api/projects', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, PAGE_SIZE_MAX);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const where: any = {};
    if (q) {
      where.canonicalName = { contains: q };
    }

    const [items, total] = await Promise.all([
      prisma.project.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        where,
        include: {
          offers: {
            select: {
              id: true,
              priceMin: true,
              priceMax: true,
              workLocation: true,
              remoteOk: true,
              startPeriod: true,
              salesOwnerEmail: true,
              salesOwnerName: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
          },
          company: { select: { id: true, name: true } },
          _count: { select: { offers: true } },
        },
      }),
      prisma.project.count({ where }),
    ]);
    res.json({ items, total });
  } catch (e) {
    console.error('GET /api/projects', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** Talent一覧: GET /api/talents */
app.get('/api/talents', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, PAGE_SIZE_MAX);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const where: any = {};
    if (q) {
      where.canonicalName = { contains: q };
    }

    const [items, total] = await Promise.all([
      prisma.talent.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        where,
        include: {
          offers: {
            select: {
              id: true,
              hopePriceMin: true,
              hopePriceMax: true,
              age: true,
              employmentTypeText: true,
              workLocationPreference: true,
              startAvailableDate: true,
              salesOwnerEmail: true,
              salesOwnerName: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
          },
          _count: { select: { offers: true } },
        },
      }),
      prisma.talent.count({ where }),
    ]);
    res.json({ items, total });
  } catch (e) {
    console.error('GET /api/talents', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** マッチ計算: POST /api/match */
app.post('/api/match', async (req: Request, res: Response) => {
  try {
    const body = req.body as { projectOfferId?: string; talentOfferId?: string; persist?: boolean };
    const { projectOfferId, talentOfferId } = body;
    const persist = body.persist === true;

    if (!projectOfferId && !talentOfferId) {
      return sendError(res, 'VALIDATION_ERROR', 'projectOfferId または talentOfferId のいずれかを指定してください。');
    }

    // 対象を取得
    let projectOffers: any[] = [];
    let talentOffers: any[] = [];

    if (projectOfferId) {
      const po = await prisma.projectOffer.findUnique({
        where: { id: projectOfferId },
        include: {
          project: { select: { id: true, canonicalName: true } },
          rawEmail: { select: { subject: true, bodyText: true, fromAddr: true, salesOwnerEmail: true, salesOwnerName: true } },
        },
      });
      if (!po) return sendError(res, 'NOT_FOUND', '指定された案件オファーが見つかりません。', 404);
      projectOffers = [po];

      // talentOfferIdが指定されていなければ全人材を対象にする
      if (!talentOfferId) {
        talentOffers = await prisma.talentOffer.findMany({
          take: 200,
          orderBy: { createdAt: 'desc' },
          include: { rawEmail: { select: { subject: true, bodyText: true, fromAddr: true, salesOwnerEmail: true, salesOwnerName: true } } },
        });
      }
    }

    if (talentOfferId) {
      const to = await prisma.talentOffer.findUnique({
        where: { id: talentOfferId },
        include: { rawEmail: { select: { subject: true, bodyText: true, fromAddr: true, salesOwnerEmail: true, salesOwnerName: true } } },
      });
      if (!to) return sendError(res, 'NOT_FOUND', '指定された人材オファーが見つかりません。', 404);
      talentOffers = [to];

      // projectOfferIdが指定されていなければ全案件を対象にする
      if (!projectOfferId) {
        projectOffers = await prisma.projectOffer.findMany({
          take: 200,
          orderBy: { createdAt: 'desc' },
          include: {
            project: { select: { id: true, canonicalName: true } },
            rawEmail: { select: { subject: true, bodyText: true, fromAddr: true, salesOwnerEmail: true, salesOwnerName: true } },
          },
        });
      }
    }

    const matches: Array<{
      projectOfferId: string;
      talentOfferId: string;
      projectTitle: string;
      talentTitle: string;
      score: number;
      scoreBreakdown: any;
      isRecommended: boolean;
      hardFilterFailed: boolean;
      exclusionReason: string | null;
      recommendationReasons: string[];
      attentionPoint: string | null;
      confirmationQuestions: string[];
    }> = [];

    for (const po of projectOffers) {
      for (const to of talentOffers) {
        const pText = `${po.rawEmail?.subject ?? ''}\n${po.rawEmail?.bodyText ?? ''}`;
        const tText = `${to.rawEmail?.subject ?? ''}\n${to.rawEmail?.bodyText ?? ''}`;

        const poNat = po.nationalityRequirement ?? extractNationality(pText);
        const toNat = to.nationalityText ?? extractNationality(tText);
        const pTech = extractTechTokens(pText);
        const tTech = extractTechTokens(tText);
        const pPrice = { min: po.priceMin ?? extractPriceMan(pText).min, max: po.priceMax ?? extractPriceMan(pText).max };
        const tPrice = { min: to.hopePriceMin ?? extractPriceMan(tText).min, max: to.hopePriceMax ?? extractPriceMan(tText).max };
        const pLoc = po.workLocation ?? extractLocationText(pText);
        const tLoc = to.workLocationPreference ?? extractLocationText(tText);
        const remoteFlagProject = po.remoteOk ?? extractRemoteOk(pText);
        const pStart = extractMonth(po.startPeriod ?? extractStartText(pText));
        const tStart = extractMonth(to.startAvailableDate ?? extractStartText(tText));

        // Hard Filter
        const exclusionReason =
          nationalityExclusion(poNat, toNat) ??
          (pPrice.max != null && tPrice.min != null && pPrice.max < tPrice.min ? '希望単価が案件上限を上回っています' : null) ??
          startPeriodExclusion(pStart, tStart) ??
          remoteOnlyExclusion(remoteFlagProject, tText) ??
          employmentExclusion(pText, to.employmentTypeText ?? extractEmploymentTypeText(tText), tText) ??
          requiredSkillExclusion(pTech, tTech);

        if (exclusionReason) {
          matches.push({
            projectOfferId: po.id,
            talentOfferId: to.id,
            projectTitle: po.project?.canonicalName || po.rawEmail?.subject || '（案件）',
            talentTitle: to.rawEmail?.subject || '（人材）',
            score: 0,
            scoreBreakdown: { base: 0, keyword: 0, tech: 0, price: 0, location: 0, start: 0, remote: 0 },
            isRecommended: false,
            hardFilterFailed: true,
            exclusionReason,
            recommendationReasons: [],
            attentionPoint: null,
            confirmationQuestions: [],
          });
          continue;
        }

        // Score
        const pKw = extractKeywords(pText);
        const tKw = extractKeywords(tText);
        const kwCommon = [...pKw].filter((w) => tKw.has(w)).length;
        const kwUnion = new Set([...pKw, ...tKw]).size;
        const keywordScore = kwUnion > 0 ? Math.round(15 * (kwCommon / kwUnion)) : 0;

        const techCommon = [...pTech].filter((w) => tTech.has(w)).length;
        const techUnion = new Set([...pTech, ...tTech]).size;
        const techScore = techUnion > 0 ? Math.round(45 * (techCommon / techUnion)) : 0;

        const priceScore = Math.max(0, overlapScore(pPrice.min, pPrice.max, tPrice.min, tPrice.max).score);
        const locScore = locationScore(pLoc, tLoc, remoteFlagProject, tText);
        const startScore = pStart && tStart && pStart === tStart ? 10 : pStart && tStart ? 4 : 0;
        const remoteScore = remoteFlagProject === true && /リモ|在宅|フルリモ|テレワ/.test(tText) ? 10 : remoteFlagProject === false ? 5 : 0;

        const base = 15;
        const scoreRaw = base + keywordScore + techScore + priceScore + locScore + startScore + remoteScore;
        const score = Math.max(0, Math.min(100, Math.round(scoreRaw)));
        const isRecommended = score >= SCORE_THRESHOLD;

        const narrative = buildMatchNarrative({
          techScore,
          keywordScore,
          priceScore,
          locationScore: locScore,
          startScore,
          remoteScore,
          pStart,
          tStart,
          pLoc,
          tLoc,
          projectRemoteOk: remoteFlagProject,
        });

        matches.push({
          projectOfferId: po.id,
          talentOfferId: to.id,
          projectTitle: po.project?.canonicalName || po.rawEmail?.subject || '（案件）',
          talentTitle: to.rawEmail?.subject || '（人材）',
          score,
          scoreBreakdown: { base, keyword: keywordScore, tech: techScore, price: priceScore, location: locScore, start: startScore, remote: remoteScore },
          isRecommended,
          hardFilterFailed: false,
          exclusionReason: null,
          recommendationReasons: narrative.recommendationReasons,
          attentionPoint: narrative.attentionPoint,
          confirmationQuestions: narrative.confirmationQuestions,
        });
      }
    }

    // スコア順にソート
    matches.sort((a, b) => b.score - a.score);

    // persistが指定された場合、Matchテーブルに保存
    if (persist) {
      for (const m of matches) {
        // 既存のマッチを検索
        const existing = await prisma.match.findFirst({
          where: { projectOfferId: m.projectOfferId, talentOfferId: m.talentOfferId },
        });

        if (existing) {
          await prisma.match.update({
            where: { id: existing.id },
            data: {
              score: m.score,
              scoreBreakdown: JSON.stringify(m.scoreBreakdown),
              isRecommended: m.isRecommended,
              hardFilterFailed: m.hardFilterFailed,
              exclusionReason: m.exclusionReason,
              recommendationReasons: m.recommendationReasons.length ? JSON.stringify(m.recommendationReasons) : null,
              attentionPoint: m.attentionPoint,
              confirmationQuestions: m.confirmationQuestions.length ? JSON.stringify(m.confirmationQuestions) : null,
            },
          });
        } else {
          await prisma.match.create({
            data: {
              projectOfferId: m.projectOfferId,
              talentOfferId: m.talentOfferId,
              score: m.score,
              scoreBreakdown: JSON.stringify(m.scoreBreakdown),
              isRecommended: m.isRecommended,
              hardFilterFailed: m.hardFilterFailed,
              exclusionReason: m.exclusionReason,
              recommendationReasons: m.recommendationReasons.length ? JSON.stringify(m.recommendationReasons) : null,
              attentionPoint: m.attentionPoint,
              confirmationQuestions: m.confirmationQuestions.length ? JSON.stringify(m.confirmationQuestions) : null,
            },
          });
        }
      }
    }

    res.json({
      items: matches,
      total: matches.length,
      scoreThreshold: SCORE_THRESHOLD,
    });
  } catch (e) {
    console.error('POST /api/match', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening at http://localhost:${PORT}`);
  startGmailPolling();
});
