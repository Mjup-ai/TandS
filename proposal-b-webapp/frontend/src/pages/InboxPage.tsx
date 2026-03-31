import { useEffect, useRef, useState } from 'react';
import LoadingBlock from '../components/LoadingBlock';
import MessageBar from '../components/MessageBar';
import { apiFetch } from '../lib/http';

interface RawEmail {
  id: string;
  subject: string | null;
  fromAddr: string;
  toAddr: string | null;
  salesOwnerEmail: string | null;
  salesOwnerName: string | null;
  receivedAt: string;
  classification: string | null;
  processingStatus: string;
}

interface ApiError {
  code: string;
  message: string;
}

interface RawEmailDetail extends RawEmail {
  ccAddr?: string | null;
  deliveredToAddr?: string | null;
  originalRecipient?: string | null;
  aiModel?: string | null;
  aiConfidence?: number | null;
  projectOffers?: Array<{
    id: string;
    priceMin?: number | null;
    priceMax?: number | null;
    supplyChainDepth?: number | null;
    interviewCount?: number | null;
    workLocation?: string | null;
    remoteOk?: boolean | null;
    startPeriod?: string | null;
    nationalityRequirement?: string | null;
    salesOwnerEmail?: string | null;
    salesOwnerName?: string | null;
    project?: { canonicalName?: string | null } | null;
  }>;
  talentOffers?: Array<{
    id: string;
    hopePriceMin?: number | null;
    hopePriceMax?: number | null;
    age?: number | null;
    employmentTypeText?: string | null;
    workLocationPreference?: string | null;
    startAvailableDate?: string | null;
    nationalityText?: string | null;
    salesOwnerEmail?: string | null;
    salesOwnerName?: string | null;
    talent?: { canonicalName?: string | null } | null;
  }>;
}

type ProjectOfferDraft = {
  priceMin: string;
  priceMax: string;
  startPeriod: string;
  workLocation: string;
  remoteOk: string;
  supplyChainDepth: string;
  interviewCount: string;
};

type TalentOfferDraft = {
  hopePriceMin: string;
  hopePriceMax: string;
  startAvailableDate: string;
  workLocationPreference: string;
  employmentTypeText: string;
  age: string;
};

const PAGE_SIZE = 20;

export default function InboxPage() {
  const [items, setItems] = useState<RawEmail[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [salesOwnerEmail, setSalesOwnerEmail] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [emlUploading, setEmlUploading] = useState(false);
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [detailMap, setDetailMap] = useState<Record<string, RawEmailDetail>>({});
  const [projectDrafts, setProjectDrafts] = useState<Record<string, ProjectOfferDraft>>({});
  const [talentDrafts, setTalentDrafts] = useState<Record<string, TalentOfferDraft>>({});
  const [savingOfferId, setSavingOfferId] = useState<string | null>(null);
  const [classifyingId, setClassifyingId] = useState<string | null>(null);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [processingAll, setProcessingAll] = useState(false);
  const [classifyingAll, setClassifyingAll] = useState(false);
  const emlInputRef = useRef<HTMLInputElement | null>(null);

  const handleEmlImport = () => {
    const file = emlInputRef.current?.files?.[0];
    if (!file) {
      setMessage({ type: 'error', text: 'ファイルを選択してください。' });
      return;
    }
    setMessage(null);
    setEmlUploading(true);
    const form = new FormData();
    form.append('file', file);
    apiFetch('/api/raw-emails/import-eml', { method: 'POST', body: form })
      .then((r) => r.json())
      .then((data) => {
        if (data.code) {
          setMessage({ type: 'error', text: (data as ApiError).message || '取り込みに失敗しました。' });
          return;
        }
        setMessage({ type: 'success', text: '1件取り込みました。' });
        if (emlInputRef.current) emlInputRef.current.value = '';
        load();
      })
      .catch(() => setMessage({ type: 'error', text: '通信エラーです。' }))
      .finally(() => setEmlUploading(false));
  };

  const triggerEmlSelect = () => {
    emlInputRef.current?.click();
  };

  const load = () => {
    setLoading(true);
    const offset = page * PAGE_SIZE;
    apiFetch(`/api/raw-emails?limit=${PAGE_SIZE}&offset=${offset}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.items) {
          setItems(data.items);
          setTotal(data.total ?? data.items.length);
        } else {
          setItems(Array.isArray(data) ? data : []);
          setTotal(Array.isArray(data) ? data.length : 0);
        }
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
        setMessage({ type: 'error', text: '一覧の取得に失敗しました。' });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [page]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const hasSubject = subject.trim().length > 0;
    const hasBody = bodyText.trim().length > 0;
    if (!hasSubject && !hasBody) {
      setMessage({ type: 'error', text: '件名または本文のどちらかは必須です。' });
      return;
    }
    setMessage(null);
    setSending(true);
    apiFetch('/api/raw-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, from, to, salesOwnerEmail, bodyText }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.code) {
          setMessage({ type: 'error', text: (data as ApiError).message || '追加に失敗しました。' });
          return;
        }
        setSubject('');
        setFrom('');
        setTo('');
        setSalesOwnerEmail('');
        setBodyText('');
        setMessage({ type: 'success', text: '1件追加しました。' });
        load();
      })
      .catch(() => setMessage({ type: 'error', text: '通信エラーです。' }))
      .finally(() => setSending(false));
  };

  const setClassification = (id: string, classification: 'talent' | 'project') => {
    setUpdatingId(id);
    setMessage(null);
    apiFetch(`/api/raw-emails/${id}/classification`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classification }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.code) {
          setMessage({ type: 'error', text: (data as ApiError).message || '分類の更新に失敗しました。' });
          return;
        }
        setMessage({ type: 'success', text: classification === 'talent' ? '人材として分類しました。' : '案件として分類しました。' });
        load();
      })
      .catch(() => setMessage({ type: 'error', text: '通信エラーです。' }))
      .finally(() => setUpdatingId(null));
  };

  const classifyEmail = (id: string) => {
    setClassifyingId(id);
    setMessage(null);
    apiFetch(`/api/raw-emails/${id}/classify`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.code) {
          setMessage({ type: 'error', text: (data as ApiError).message || 'AI分類に失敗しました。' });
          return;
        }
        setMessage({ type: 'success', text: 'AI分類が完了しました。' });
        load();
      })
      .catch(() => setMessage({ type: 'error', text: '通信エラーです。' }))
      .finally(() => setClassifyingId(null));
  };

  const extractEmail = (id: string) => {
    setExtractingId(id);
    setMessage(null);
    apiFetch(`/api/raw-emails/${id}/extract`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.code) {
          setMessage({ type: 'error', text: (data as ApiError).message || '抽出に失敗しました。' });
          return;
        }
        setMessage({ type: 'success', text: '情報抽出が完了しました。' });
        load();
        if (openDetailId === id) fetchDetail(id);
      })
      .catch(() => setMessage({ type: 'error', text: '通信エラーです。' }))
      .finally(() => setExtractingId(null));
  };

  const classifyAll = () => {
    setClassifyingAll(true);
    setMessage(null);
    apiFetch('/api/raw-emails/classify-all', { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.code) {
          setMessage({ type: 'error', text: (data as ApiError).message || '一括分類に失敗しました。' });
          return;
        }
        const results = data.results ?? [];
        const projectCount = results.filter((r: { classification: string }) => r.classification === 'project').length;
        const talentCount = results.filter((r: { classification: string }) => r.classification === 'talent').length;
        const otherCount = results.filter((r: { classification: string }) => r.classification === 'other').length;
        setMessage({ type: 'success', text: `一括分類完了: ${data.processed ?? 0}件（案件${projectCount} / 人材${talentCount} / その他${otherCount}）` });
        load();
      })
      .catch(() => setMessage({ type: 'error', text: '通信エラーです。' }))
      .finally(() => setClassifyingAll(false));
  };

  const processAll = () => {
    setProcessingAll(true);
    setMessage(null);
    apiFetch('/api/raw-emails/process-all', { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.code) {
          setMessage({ type: 'error', text: (data as ApiError).message || '一括処理に失敗しました。' });
          return;
        }
        const results = data.results ?? [];
        const extracted = results.filter((r: { status: string }) => r.status === 'extracted').length;
        const skipped = results.filter((r: { status: string }) => r.status === 'skipped').length;
        const errors = results.filter((r: { status: string }) => r.status === 'error').length;
        setMessage({ type: 'success', text: `一括処理完了: ${data.processed ?? 0}件（抽出${extracted} / スキップ${skipped}${errors > 0 ? ` / エラー${errors}` : ''}）` });
        load();
      })
      .catch(() => setMessage({ type: 'error', text: '通信エラーです。' }))
      .finally(() => setProcessingAll(false));
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchDetail = (id: string) => {
    apiFetch(`/api/raw-emails/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data?.id) return;
        setDetailMap((prev) => ({ ...prev, [id]: data as RawEmailDetail }));
        const detail = data as RawEmailDetail;
        setProjectDrafts((prev) => {
          const next = { ...prev };
          for (const offer of detail.projectOffers ?? []) {
            next[offer.id] = {
              priceMin: offer.priceMin != null ? String(offer.priceMin) : '',
              priceMax: offer.priceMax != null ? String(offer.priceMax) : '',
              startPeriod: offer.startPeriod ?? '',
              workLocation: offer.workLocation ?? '',
              remoteOk: offer.remoteOk == null ? '' : offer.remoteOk ? 'true' : 'false',
              supplyChainDepth: offer.supplyChainDepth != null ? String(offer.supplyChainDepth) : '',
              interviewCount: offer.interviewCount != null ? String(offer.interviewCount) : '',
            };
          }
          return next;
        });
        setTalentDrafts((prev) => {
          const next = { ...prev };
          for (const offer of detail.talentOffers ?? []) {
            next[offer.id] = {
              hopePriceMin: offer.hopePriceMin != null ? String(offer.hopePriceMin) : '',
              hopePriceMax: offer.hopePriceMax != null ? String(offer.hopePriceMax) : '',
              startAvailableDate: offer.startAvailableDate ?? '',
              workLocationPreference: offer.workLocationPreference ?? '',
              employmentTypeText: offer.employmentTypeText ?? '',
              age: offer.age != null ? String(offer.age) : '',
            };
          }
          return next;
        });
      })
      .catch(() => {
        setMessage({ type: 'error', text: '詳細の取得に失敗しました。' });
      });
  };

  const toggleDetail = (id: string) => {
    if (openDetailId === id) {
      setOpenDetailId(null);
      return;
    }

    setOpenDetailId(id);
    if (detailMap[id]) return;
    fetchDetail(id);
  };

  const saveProjectOffer = async (offerId: string) => {
    const draft = projectDrafts[offerId];
    if (!draft) return;
    setSavingOfferId(offerId);
    try {
      const res = await apiFetch(`/api/project-offers/${offerId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          priceMin: draft.priceMin ? Number(draft.priceMin) : null,
          priceMax: draft.priceMax ? Number(draft.priceMax) : null,
          startPeriod: draft.startPeriod || null,
          workLocation: draft.workLocation || null,
          remoteOk: draft.remoteOk === '' ? null : draft.remoteOk === 'true',
          supplyChainDepth: draft.supplyChainDepth ? Number(draft.supplyChainDepth) : null,
          interviewCount: draft.interviewCount ? Number(draft.interviewCount) : null,
        }),
      });
      if (!res.ok) throw new Error('save failed');
      setMessage({ type: 'success', text: '案件抽出結果を更新しました。' });
      if (openDetailId) fetchDetail(openDetailId);
    } catch {
      setMessage({ type: 'error', text: '案件抽出結果の更新に失敗しました。' });
    } finally {
      setSavingOfferId(null);
    }
  };

  const saveTalentOffer = async (offerId: string) => {
    const draft = talentDrafts[offerId];
    if (!draft) return;
    setSavingOfferId(offerId);
    try {
      const res = await apiFetch(`/api/talent-offers/${offerId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          hopePriceMin: draft.hopePriceMin ? Number(draft.hopePriceMin) : null,
          hopePriceMax: draft.hopePriceMax ? Number(draft.hopePriceMax) : null,
          startAvailableDate: draft.startAvailableDate || null,
          workLocationPreference: draft.workLocationPreference || null,
          employmentTypeText: draft.employmentTypeText || null,
          age: draft.age ? Number(draft.age) : null,
        }),
      });
      if (!res.ok) throw new Error('save failed');
      setMessage({ type: 'success', text: '人材抽出結果を更新しました。' });
      if (openDetailId) fetchDetail(openDetailId);
    } catch {
      setMessage({ type: 'error', text: '人材抽出結果の更新に失敗しました。' });
    } finally {
      setSavingOfferId(null);
    }
  };

  return (
    <div className="space-y-6">
      {message && (
        <MessageBar type={message.type} text={message.text} />
      )}

      <section className="card p-5">
        <h2 className="section-title">.eml ファイルを取り込む</h2>
        <p className="mt-1 text-sm text-slate-600">届くメールのサンプル（案件・人材フォルダの .eml）を選ぶと1件だけ取り込みます。</p>
        <input
          ref={emlInputRef}
          type="file"
          accept=".eml"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) handleEmlImport();
          }}
        />
        <button
          type="button"
          disabled={emlUploading}
          onClick={triggerEmlSelect}
          className="btn-secondary mt-3"
        >
          {emlUploading ? '取り込み中…' : '.eml を選択して取り込み'}
        </button>
      </section>

      <form onSubmit={handleAdd} className="card p-5">
        <h2 className="section-title">メールを1件追加（手入力）</h2>
        <p className="mt-1 text-sm text-slate-600">件名か本文のどちらかは必須です。</p>
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">件名</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400 focus:border-primary-500"
              placeholder="例：【人材】React 3年 希望単価75万"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">差出人</label>
            <input
              type="text"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400 focus:border-primary-500"
              placeholder="例：bp@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">宛先</label>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400 focus:border-primary-500"
              placeholder="例：eigyo-a@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">担当営業メール（任意）</label>
            <input
              type="text"
              value={salesOwnerEmail}
              onChange={(e) => setSalesOwnerEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400 focus:border-primary-500"
              placeholder="例：eigyo-a@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">本文</label>
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400 focus:border-primary-500"
              placeholder="例：React 3年、希望単価75万〜、3月入場可能です。"
            />
          </div>
        </div>
        <button type="submit" disabled={sending} className="btn-primary mt-5">
          {sending ? '追加中…' : '1件追加'}
        </button>
      </form>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">受信一覧（{total} 件）</h2>
            <p className="mt-0.5 text-sm text-slate-500">「人材」「案件」を選ぶとマッチングの台帳に振り分けられます。</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={classifyingAll || loading}
              onClick={classifyAll}
              className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              {classifyingAll ? '分類中…' : '未分類を一括分類'}
            </button>
            <button
              type="button"
              disabled={processingAll || loading}
              onClick={processAll}
              className="btn-primary"
            >
              {processingAll ? '処理中…' : '全件一括処理（分類+抽出）'}
            </button>
          </div>
        </div>
        {loading ? (
          <ul className="mt-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="card p-4 animate-pulse">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-slate-200" />
                    <div className="h-3 w-1/2 rounded bg-slate-100" />
                    <div className="flex gap-2 mt-2">
                      <div className="h-5 w-20 rounded bg-slate-100" />
                      <div className="h-5 w-16 rounded bg-slate-100" />
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <div className="h-8 w-16 rounded-lg bg-slate-100" />
                    <div className="h-8 w-12 rounded-lg bg-slate-100" />
                    <div className="h-8 w-12 rounded-lg bg-slate-100" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
          <div className="empty-state mt-4">
            <p className="font-medium text-slate-600">まだ1件もありません</p>
            <p className="mt-1 text-sm">上のフォームで「1件追加」するか、.eml を取り込んでください。</p>
          </div>
        ) : (
          <>
            <ul className="mt-4 space-y-3">
              {items.map((m) => (
                <li key={m.id} className={`card card-hover p-4 ${
                  m.classification === 'project' ? 'border-l-4 border-l-blue-400' :
                  m.classification === 'talent' ? 'border-l-4 border-l-emerald-400' :
                  m.classification === 'other' ? 'border-l-4 border-l-slate-300' : ''
                }`}>
                  {(() => {
                    const detail = detailMap[m.id];
                    return (
                      <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-800">{m.subject || '（件名なし）'}</p>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {m.fromAddr} · {new Date(m.receivedAt).toLocaleString('ja-JP')}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {m.salesOwnerName || m.salesOwnerEmail ? (
                          <span className="rounded-md bg-sky-100 px-2 py-0.5 font-medium text-sky-800">
                            担当営業: {m.salesOwnerName || m.salesOwnerEmail}
                          </span>
                        ) : null}
                        {m.toAddr ? (
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                            宛先: {m.toAddr}
                          </span>
                        ) : null}
                      </div>
                      {/* bodyText is loaded on-demand in detail view for performance */}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {m.classification ? (
                          <span
                            className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${
                              m.classification === 'talent' ? 'bg-emerald-100 text-emerald-800' :
                              m.classification === 'project' ? 'bg-blue-100 text-blue-800' :
                              'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {m.classification === 'talent' ? '人材' : m.classification === 'project' ? '案件' : 'その他'}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">未分類</span>
                        )}
                        <span className="text-xs text-slate-400">状態: {m.processingStatus}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleDetail(m.id)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {openDetailId === m.id ? '詳細を閉じる' : '詳細 / 抽出結果'}
                      </button>
                      <button
                        type="button"
                        disabled={updatingId === m.id}
                        onClick={() => setClassification(m.id, 'talent')}
                        className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        人材
                      </button>
                      <button
                        type="button"
                        disabled={updatingId === m.id}
                        onClick={() => setClassification(m.id, 'project')}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                      >
                        案件
                      </button>
                      <button
                        type="button"
                        disabled={classifyingId === m.id}
                        onClick={() => classifyEmail(m.id)}
                        className="rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                      >
                        {classifyingId === m.id ? '分類中…' : 'AI分類'}
                      </button>
                      <button
                        type="button"
                        disabled={extractingId === m.id}
                        onClick={() => extractEmail(m.id)}
                        className="rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                      >
                        {extractingId === m.id ? '抽出中…' : '抽出'}
                      </button>
                    </div>
                  </div>
                  {openDetailId === m.id ? (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                      {detail ? (
                        <div className="space-y-4 text-sm text-slate-700">
                          <div className="grid gap-2 md:grid-cols-2">
                            <div>宛先: {detail.toAddr || '—'}</div>
                            <div>CC: {detail.ccAddr || '—'}</div>
                            <div>Delivered-To: {detail.deliveredToAddr || '—'}</div>
                            <div>Original Recipient: {detail.originalRecipient || '—'}</div>
                          </div>
                          {detail.bodyText && (
                            <div>
                              <div className="text-xs font-semibold text-slate-500">本文</div>
                              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-white p-3 text-sm text-slate-700 border border-slate-200">{detail.bodyText}</pre>
                            </div>
                          )}
                          <div>
                            <div className="text-xs font-semibold text-slate-500">抽出状態</div>
                            <div className="mt-1">
                              classification: {detail.classification || '未分類'} / status: {detail.processingStatus}
                            </div>
                            <div>AI confidence: {detail.aiConfidence != null ? detail.aiConfidence.toFixed(2) : '—'}</div>
                          </div>
                          {detail.projectOffers?.length ? (
                            <div>
                              <div className="text-xs font-semibold text-slate-500">案件抽出結果</div>
                              {detail.projectOffers.map((offer) => (
                                <div key={offer.id} className="mt-2 rounded-md bg-white p-3">
                                  <div className="font-medium text-slate-800">{offer.project?.canonicalName || '案件'}</div>
                                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                                    <input
                                      value={projectDrafts[offer.id]?.priceMin ?? ''}
                                      onChange={(e) => setProjectDrafts((prev) => ({ ...prev, [offer.id]: { ...(prev[offer.id] ?? { priceMin: '', priceMax: '', startPeriod: '', workLocation: '', remoteOk: '', supplyChainDepth: '', interviewCount: '' }), priceMin: e.target.value } }))}
                                      className="rounded border border-slate-300 px-2 py-1"
                                      placeholder="単価下限"
                                    />
                                    <input
                                      value={projectDrafts[offer.id]?.priceMax ?? ''}
                                      onChange={(e) => setProjectDrafts((prev) => ({ ...prev, [offer.id]: { ...(prev[offer.id] ?? { priceMin: '', priceMax: '', startPeriod: '', workLocation: '', remoteOk: '', supplyChainDepth: '', interviewCount: '' }), priceMax: e.target.value } }))}
                                      className="rounded border border-slate-300 px-2 py-1"
                                      placeholder="単価上限"
                                    />
                                    <input
                                      value={projectDrafts[offer.id]?.startPeriod ?? ''}
                                      onChange={(e) => setProjectDrafts((prev) => ({ ...prev, [offer.id]: { ...(prev[offer.id] ?? { priceMin: '', priceMax: '', startPeriod: '', workLocation: '', remoteOk: '', supplyChainDepth: '', interviewCount: '' }), startPeriod: e.target.value } }))}
                                      className="rounded border border-slate-300 px-2 py-1"
                                      placeholder="開始時期"
                                    />
                                    <input
                                      value={projectDrafts[offer.id]?.workLocation ?? ''}
                                      onChange={(e) => setProjectDrafts((prev) => ({ ...prev, [offer.id]: { ...(prev[offer.id] ?? { priceMin: '', priceMax: '', startPeriod: '', workLocation: '', remoteOk: '', supplyChainDepth: '', interviewCount: '' }), workLocation: e.target.value } }))}
                                      className="rounded border border-slate-300 px-2 py-1"
                                      placeholder="勤務地"
                                    />
                                    <select
                                      value={projectDrafts[offer.id]?.remoteOk ?? ''}
                                      onChange={(e) => setProjectDrafts((prev) => ({ ...prev, [offer.id]: { ...(prev[offer.id] ?? { priceMin: '', priceMax: '', startPeriod: '', workLocation: '', remoteOk: '', supplyChainDepth: '', interviewCount: '' }), remoteOk: e.target.value } }))}
                                      className="rounded border border-slate-300 px-2 py-1"
                                    >
                                      <option value="">リモート未設定</option>
                                      <option value="true">リモート可</option>
                                      <option value="false">リモート不可</option>
                                    </select>
                                    <button type="button" className="btn-secondary" disabled={savingOfferId === offer.id} onClick={() => saveProjectOffer(offer.id)}>
                                      {savingOfferId === offer.id ? '保存中…' : '案件抽出を保存'}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {detail.talentOffers?.length ? (
                            <div>
                              <div className="text-xs font-semibold text-slate-500">人材抽出結果</div>
                              {detail.talentOffers.map((offer) => (
                                <div key={offer.id} className="mt-2 rounded-md bg-white p-3">
                                  <div className="font-medium text-slate-800">{offer.talent?.canonicalName || '人材'}</div>
                                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                                    <input
                                      value={talentDrafts[offer.id]?.hopePriceMin ?? ''}
                                      onChange={(e) => setTalentDrafts((prev) => ({ ...prev, [offer.id]: { ...(prev[offer.id] ?? { hopePriceMin: '', hopePriceMax: '', startAvailableDate: '', workLocationPreference: '', employmentTypeText: '', age: '' }), hopePriceMin: e.target.value } }))}
                                      className="rounded border border-slate-300 px-2 py-1"
                                      placeholder="希望単価下限"
                                    />
                                    <input
                                      value={talentDrafts[offer.id]?.hopePriceMax ?? ''}
                                      onChange={(e) => setTalentDrafts((prev) => ({ ...prev, [offer.id]: { ...(prev[offer.id] ?? { hopePriceMin: '', hopePriceMax: '', startAvailableDate: '', workLocationPreference: '', employmentTypeText: '', age: '' }), hopePriceMax: e.target.value } }))}
                                      className="rounded border border-slate-300 px-2 py-1"
                                      placeholder="希望単価上限"
                                    />
                                    <input
                                      value={talentDrafts[offer.id]?.startAvailableDate ?? ''}
                                      onChange={(e) => setTalentDrafts((prev) => ({ ...prev, [offer.id]: { ...(prev[offer.id] ?? { hopePriceMin: '', hopePriceMax: '', startAvailableDate: '', workLocationPreference: '', employmentTypeText: '', age: '' }), startAvailableDate: e.target.value } }))}
                                      className="rounded border border-slate-300 px-2 py-1"
                                      placeholder="参画可能時期"
                                    />
                                    <input
                                      value={talentDrafts[offer.id]?.workLocationPreference ?? ''}
                                      onChange={(e) => setTalentDrafts((prev) => ({ ...prev, [offer.id]: { ...(prev[offer.id] ?? { hopePriceMin: '', hopePriceMax: '', startAvailableDate: '', workLocationPreference: '', employmentTypeText: '', age: '' }), workLocationPreference: e.target.value } }))}
                                      className="rounded border border-slate-300 px-2 py-1"
                                      placeholder="勤務地希望"
                                    />
                                    <input
                                      value={talentDrafts[offer.id]?.employmentTypeText ?? ''}
                                      onChange={(e) => setTalentDrafts((prev) => ({ ...prev, [offer.id]: { ...(prev[offer.id] ?? { hopePriceMin: '', hopePriceMax: '', startAvailableDate: '', workLocationPreference: '', employmentTypeText: '', age: '' }), employmentTypeText: e.target.value } }))}
                                      className="rounded border border-slate-300 px-2 py-1"
                                      placeholder="雇用形態"
                                    />
                                    <input
                                      value={talentDrafts[offer.id]?.age ?? ''}
                                      onChange={(e) => setTalentDrafts((prev) => ({ ...prev, [offer.id]: { ...(prev[offer.id] ?? { hopePriceMin: '', hopePriceMax: '', startAvailableDate: '', workLocationPreference: '', employmentTypeText: '', age: '' }), age: e.target.value } }))}
                                      className="rounded border border-slate-300 px-2 py-1"
                                      placeholder="年齢"
                                    />
                                    <button type="button" className="btn-secondary" disabled={savingOfferId === offer.id} onClick={() => saveTalentOffer(offer.id)}>
                                      {savingOfferId === offer.id ? '保存中…' : '人材抽出を保存'}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="text-sm text-slate-500">詳細を読み込み中です。</div>
                      )}
                    </div>
                  ) : null}
                      </>
                    );
                  })()}
                </li>
              ))}
            </ul>
            {totalPages > 1 && (
              <div className="mt-5 flex items-center justify-center gap-3">
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="btn-secondary py-2 px-3 text-sm disabled:opacity-50"
                >
                  前へ
                </button>
                <span className="text-sm font-medium text-slate-600">
                  {page + 1} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  className="btn-secondary py-2 px-3 text-sm disabled:opacity-50"
                >
                  次へ
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
