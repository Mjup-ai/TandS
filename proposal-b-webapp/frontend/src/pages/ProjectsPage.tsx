import { useEffect, useState } from 'react';
import LoadingBlock from '../components/LoadingBlock';

interface ProjectOfferItem {
  id: string;
  project: { id: string; canonicalName: string | null };
  rawEmail: { id: string; subject: string | null; fromAddr: string; bodyText: string | null; receivedAt: string } | null;
}

export default function ProjectsPage() {
  const [items, setItems] = useState<ProjectOfferItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/project-offers?limit=50')
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingBlock />;
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <h2 className="text-base font-semibold text-slate-700">案件</h2>
        <p className="mt-2 text-sm">受信一覧で「案件」と分類したメールがここに表示されます。</p>
        <p className="mt-3 text-sm text-slate-500">まだ1件もありません。受信タブでメールを追加し、「案件」を押してください。</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-base font-semibold text-slate-800">案件（{total} 件）</h2>
      <ul className="mt-4 space-y-3">
        {items.map((o) => (
          <li key={o.id} className="card card-hover p-4">
            <button
              type="button"
              onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}
              className="w-full text-left"
            >
              <p className="font-medium text-slate-800">{o.project?.canonicalName || o.rawEmail?.subject || '（件名なし）'}</p>
              <p className="mt-0.5 text-sm text-slate-500">{o.rawEmail?.fromAddr} · {o.rawEmail?.receivedAt ? new Date(o.rawEmail.receivedAt).toLocaleString('ja-JP') : ''}</p>
              {o.rawEmail?.bodyText && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                  {expandedId === o.id ? o.rawEmail.bodyText : `${o.rawEmail.bodyText.slice(0, 200)}${o.rawEmail.bodyText.length > 200 ? '…' : ''}`}
                </p>
              )}
              {o.rawEmail?.bodyText && o.rawEmail.bodyText.length > 200 && (
                <p className="mt-1.5 text-xs font-medium text-primary-600">{expandedId === o.id ? '閉じる' : '本文をすべて表示'}</p>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
