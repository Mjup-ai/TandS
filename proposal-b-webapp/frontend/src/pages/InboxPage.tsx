import { useEffect, useRef, useState } from 'react';
import LoadingBlock from '../components/LoadingBlock';
import MessageBar from '../components/MessageBar';

interface RawEmail {
  id: string;
  subject: string | null;
  fromAddr: string;
  bodyText: string | null;
  receivedAt: string;
  classification: string | null;
  processingStatus: string;
}

interface ApiError {
  code: string;
  message: string;
}

const PAGE_SIZE = 20;

export default function InboxPage() {
  const [items, setItems] = useState<RawEmail[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState('');
  const [from, setFrom] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [emlUploading, setEmlUploading] = useState(false);
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
    fetch('/api/raw-emails/import-eml', { method: 'POST', body: form })
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
    fetch(`/api/raw-emails?limit=${PAGE_SIZE}&offset=${offset}`)
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
    fetch('/api/raw-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, from, bodyText }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.code) {
          setMessage({ type: 'error', text: (data as ApiError).message || '追加に失敗しました。' });
          return;
        }
        setSubject('');
        setFrom('');
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
    fetch(`/api/raw-emails/${id}/classification`, {
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
        <h2 className="text-base font-semibold text-slate-800">受信一覧（{total} 件）</h2>
        <p className="mt-0.5 text-sm text-slate-500">「人材」「案件」を選ぶとマッチングの台帳に振り分けられます。</p>
        {loading ? (
          <LoadingBlock />
        ) : items.length === 0 ? (
          <div className="empty-state mt-4">
            <p className="font-medium text-slate-600">まだ1件もありません</p>
            <p className="mt-1 text-sm">上のフォームで「1件追加」するか、.eml を取り込んでください。</p>
          </div>
        ) : (
          <>
            <ul className="mt-4 space-y-3">
              {items.map((m) => (
                <li key={m.id} className="card card-hover p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-800">{m.subject || '（件名なし）'}</p>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {m.fromAddr} · {new Date(m.receivedAt).toLocaleString('ja-JP')}
                      </p>
                      {m.bodyText && (
                        <p className="mt-2 text-sm text-slate-600 line-clamp-2">
                          {m.bodyText.slice(0, 200)}
                          {m.bodyText.length > 200 ? '…' : ''}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {m.classification ? (
                          <span
                            className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${
                              m.classification === 'talent' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {m.classification === 'talent' ? '人材' : '案件'}
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
                    </div>
                  </div>
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
