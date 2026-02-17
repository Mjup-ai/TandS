import express, { Request, Response } from 'express';
import multer from 'multer';
import { simpleParser } from 'mailparser';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT ?? 4000;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

app.use(express.json({ limit: '1mb' }));

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

/** 分類を更新（案件/人材）。案件なら Project+ProjectOffer、人材なら Talent+TalentOffer を自動作成 */
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
      await prisma.projectOffer.create({
        data: { projectId: project.id, rawEmailId: id, extractedAt: new Date() },
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
      await prisma.talentOffer.create({
        data: { talentId: talent.id, rawEmailId: id, extractedAt: new Date() },
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

/** 案件一覧（ProjectOffer + 元メール） */
app.get('/api/project-offers', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, PAGE_SIZE_MAX);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const [items, total] = await Promise.all([
      prisma.projectOffer.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          project: { select: { id: true, canonicalName: true } },
          rawEmail: { select: { id: true, subject: true, fromAddr: true, bodyText: true, receivedAt: true } },
        },
      }),
      prisma.projectOffer.count(),
    ]);
    res.json({ items, total });
  } catch (e) {
    console.error('GET /api/project-offers', e);
    sendError(res, 'SERVER_ERROR', String(e), 500);
  }
});

/** 人材一覧（TalentOffer + 元メール） */
app.get('/api/talent-offers', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, PAGE_SIZE_MAX);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const [items, total] = await Promise.all([
      prisma.talentOffer.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          talent: { select: { id: true } },
          rawEmail: { select: { id: true, subject: true, fromAddr: true, bodyText: true, receivedAt: true } },
        },
      }),
      prisma.talentOffer.count(),
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
  const words = normalized.split(/[^\w\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]+/).filter((w) => w.length >= 2);
  return new Set(words);
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
      score: number;
      scoreBreakdown: { keyword: number; base: number };
      isRecommended: boolean;
      exclusionReason: string | null;
    }> = [];

    for (const po of projectOffers) {
      for (const to of talentOffers) {
        const pBody = (po.rawEmail?.bodyText ?? '') + (po.rawEmail?.subject ?? '');
        const tBody = (to.rawEmail?.bodyText ?? '') + (to.rawEmail?.subject ?? '');
        const pKw = extractKeywords(pBody);
        const tKw = extractKeywords(tBody);
        const common = [...pKw].filter((w) => tKw.has(w)).length;
        const union = new Set([...pKw, ...tKw]).size;
        const keywordScore = union > 0 ? Math.round(30 * (common / union)) : 15;
        const baseScore = 40;
        const score = Math.min(100, baseScore + keywordScore + (pBody.length > 0 && tBody.length > 0 ? 20 : 0));
        const isRecommended = score >= SCORE_THRESHOLD;
        const exclusionReason: string | null = null; // Hard Filter は抽出データがないため未適用

        matches.push({
          projectOfferId: po.id,
          talentOfferId: to.id,
          projectTitle: po.project?.canonicalName || po.rawEmail?.subject || '（案件）',
          talentTitle: to.rawEmail?.subject || '（人材）',
          projectFromAddr: po.rawEmail?.fromAddr ?? null,
          talentFromAddr: to.rawEmail?.fromAddr ?? null,
          score,
          scoreBreakdown: { keyword: keywordScore, base: baseScore },
          isRecommended,
          exclusionReason,
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

app.listen(PORT, () => {
  console.log(`Backend listening at http://localhost:${PORT}`);
});
