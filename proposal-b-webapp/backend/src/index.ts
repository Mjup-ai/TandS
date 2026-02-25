import path from 'path';
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

    const row = await prisma.rawEmail.create({
      data: {
        messageId: mail.messageId ?? undefined,
        fromAddr,
        toAddr,
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
    const body = req.body as { subject?: string; from?: string; bodyText?: string };
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const fromAddr = typeof body.from === 'string' ? body.from.trim() : '';
    const bodyText = typeof body.bodyText === 'string' ? body.bodyText : '';

    if (!subject && !bodyText) {
      sendError(res, 'VALIDATION_ERROR', '件名または本文のいずれかは必須です。');
      return;
    }

    const row = await prisma.rawEmail.create({
      data: {
        fromAddr: fromAddr.slice(0, FROM_MAX) || '（未設定）',
        toAddr: null,
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
      select: {
        id: true,
        subject: true,
        fromAddr: true,
        toAddr: true,
        bodyText: true,
        receivedAt: true,
        classification: true,
        processingStatus: true,
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

    const where: any = {
      ...(priceMinGte != null ? { priceMin: { gte: priceMinGte } } : {}),
      ...(priceMaxLte != null ? { priceMax: { lte: priceMaxLte } } : {}),
      ...(flowDepth != null ? { supplyChainDepth: flowDepth } : {}),
      ...(senderDomain ? { senderDomain } : {}),
      ...(remote === 'true' ? { remoteOk: true } : remote === 'false' ? { remoteOk: false } : {}),
    };

    if (q) {
      where.OR = [
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
      ];
    }

    // 雇用形態は案件側の本文に含まれることもあるが、MVPでは条件欄検索で代替
    if (employment) {
      where.conditions = { contains: employment };
    }

    const [items, total] = await Promise.all([
      prisma.projectOffer.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        where,
        include: {
          project: { select: { id: true, canonicalName: true } },
          rawEmail: { select: { id: true, subject: true, fromAddr: true, bodyText: true, receivedAt: true } },
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

    if (remote) {
      // talent側は希望条件にしか出ないことが多いので、本文検索で代替
      if (remote === 'true') where.workLocationPreference = { contains: 'リモ' };
      if (remote === 'false') where.workLocationPreference = { contains: '常駐' };
    }

    if (q) {
      where.OR = [
        { workLocationPreference: { contains: q } },
        { startAvailableDate: { contains: q } },
        {
          rawEmail: {
            is: {
              OR: [{ subject: { contains: q } }, { bodyText: { contains: q } }, { fromAddr: { contains: q } }],
            },
          },
        },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.talentOffer.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        where,
        include: {
          talent: { select: { id: true } },
          rawEmail: { select: { id: true, subject: true, fromAddr: true, bodyText: true, receivedAt: true } },
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

/** マッチ一覧（案件×人材。スコア内訳・除外理由・推薦閾値） */
app.get('/api/matches', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const recommendedOnly = req.query.recommendedOnly === 'true';

    const [projectOffers, talentOffers] = await Promise.all([
      prisma.projectOffer.findMany({
        take: 100,
        orderBy: { createdAt: 'desc' },
        include: {
          project: { select: { id: true, canonicalName: true } },
          rawEmail: { select: { subject: true, bodyText: true, fromAddr: true } },
        },
      }),
      prisma.talentOffer.findMany({
        take: 100,
        orderBy: { createdAt: 'desc' },
        include: { rawEmail: { select: { subject: true, bodyText: true, fromAddr: true } } },
      }),
    ]);

    const matches: Array<{
      projectOfferId: string;
      talentOfferId: string;
      projectTitle: string;
      talentTitle: string;
      projectFromAddr: string | null;
      talentFromAddr: string | null;
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
        const exclusionReason = nationalityExclusion(poNat, toNat);
        if (exclusionReason) {
          matches.push({
            projectOfferId: po.id,
            talentOfferId: to.id,
            projectTitle: po.project?.canonicalName || po.rawEmail?.subject || '（案件）',
            talentTitle: to.rawEmail?.subject || '（人材）',
            projectFromAddr: po.rawEmail?.fromAddr ?? null,
            talentFromAddr: to.rawEmail?.fromAddr ?? null,
            projectBodyText: po.rawEmail?.bodyText ?? null,
            talentBodyText: to.rawEmail?.bodyText ?? null,
            score: 0,
            scoreBreakdown: { base: 0, keyword: 0, tech: 0, price: 0, location: 0, start: 0, remote: 0 },
            isRecommended: false,
            exclusionReason,
          });
          continue;
        }

        // Keyword/Tech similarity
        const pKw = extractKeywords(pText);
        const tKw = extractKeywords(tText);
        const common = [...pKw].filter((w) => tKw.has(w)).length;
        const union = new Set([...pKw, ...tKw]).size;
        const keywordScore = union > 0 ? Math.round(20 * (common / union)) : 5;

        const pTech = extractTechTokens(pText);
        const tTech = extractTechTokens(tText);
        const techCommon = [...pTech].filter((w) => tTech.has(w)).length;
        const techUnion = new Set([...pTech, ...tTech]).size;
        const techScore = techUnion > 0 ? Math.round(35 * (techCommon / techUnion)) : 0;

        // Price / location / start / remote
        const pPrice = extractPriceMan(pText);
        const tPrice = extractPriceMan(tText);
        const priceScore = overlapScore(pPrice.min, pPrice.max, tPrice.min, tPrice.max).score;

        const pLoc = extractLocationText(pText);
        const tLoc = extractLocationText(tText);
        const remoteFlagProject = extractRemoteOk(pText);
        const location = locationScore(pLoc, tLoc, remoteFlagProject, tText);

        const pStart = extractMonth(extractStartText(pText));
        const tStart = extractMonth(extractStartText(tText));
        const startScore = pStart && tStart && pStart === tStart ? 8 : pStart && tStart ? -2 : 0;

        const remoteScore =
          remoteFlagProject === true && /リモ|在宅|フルリモ|テレワ/.test(tText) ? 8 : remoteFlagProject === false && /フルリモ|在宅/.test(tText) ? -8 : 0;

        const base = 35;
        const scoreRaw = base + keywordScore + techScore + priceScore + location + startScore + remoteScore;
        const score = Math.max(0, Math.min(100, Math.round(scoreRaw)));
        const isRecommended = score >= SCORE_THRESHOLD;

        matches.push({
          projectOfferId: po.id,
          talentOfferId: to.id,
          projectTitle: po.project?.canonicalName || po.rawEmail?.subject || '（案件）',
          talentTitle: to.rawEmail?.subject || '（人材）',
          projectFromAddr: po.rawEmail?.fromAddr ?? null,
          talentFromAddr: to.rawEmail?.fromAddr ?? null,
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
        });
      }
    }

    let filtered = matches.sort((a, b) => b.score - a.score);
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

  const bodyTextRaw = pickTextPlain(payload) || '';
  const bodyText = bodyTextRaw.slice(0, BODY_MAX);
  const receivedAt = msg.data.internalDate ? new Date(Number(msg.data.internalDate)) : new Date();

  const created = await prisma.rawEmail.create({
    data: {
      messageId,
      receivedAt,
      fromAddr,
      toAddr,
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
      const ai = await aiExtractAndPersist(created.id).catch(() => null);

      if (cls === 'project') {
        const project = await prisma.project.create({ data: { canonicalName: (rawEmail.subject || '案件').slice(0, 200) } });
        const price = ai?.classification === 'project' ? { min: ai.fields.priceMin, max: ai.fields.priceMax } : extractPriceMan(sourceText);
        await prisma.projectOffer.create({
          data: {
            projectId: project.id,
            rawEmailId: rawEmail.id,
            senderDomain,
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

app.listen(PORT, () => {
  console.log(`Backend listening at http://localhost:${PORT}`);
  startGmailPolling();
});
