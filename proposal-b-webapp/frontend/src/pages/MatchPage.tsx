import { useEffect, useState } from 'react';
import LoadingBlock from '../components/LoadingBlock';

interface MatchItem {
  projectOfferId: string;
  talentOfferId: string;
  projectTitle: string;
  talentTitle: string;
  score: number;
  scoreBreakdown: { keyword: number; base: number };
  isRecommended: boolean;
  exclusionReason: string | null;
}

export default function MatchPage() {
  const [items, setItems] = useState<MatchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [scoreThreshold, setScoreThreshold] = useState(70);
  const [recommendedOnly, setRecommendedOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const url = `/api/matches?limit=50&recommendedOnly=${recommendedOnly}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
        if (data.scoreThreshold != null) setScoreThreshold(data.scoreThreshold);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [recommendedOnly]);

  if (loading) {
    return <LoadingBlock />;
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <h2 className="text-base font-semibold text-slate-700">マッチ</h2>
        <p className="mt-2 text-sm">案件と人材を組み合わせた「おすすめ」候補がここに表示されます。</p>
        <p className="mt-3 text-sm text-slate-500">
          {recommendedOnly ? '推薦だけ表示中です。フィルタを外すと全件表示されます。' : '案件・人材がそれぞれ1件以上あるとマッチ候補が出ます。受信タブでメールを追加し、案件/人材に分類してください。'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-slate-800">マッチ候補（{total} 件）</h2>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-card">
          <input
            type="checkbox"
            checked={recommendedOnly}
            onChange={(e) => setRecommendedOnly(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
          />
          推薦だけ（{scoreThreshold}点以上）
        </label>
      </div>
      <p className="mt-1 text-sm text-slate-500">スコアは本文・件名のキーワード一致度で簡易計算しています。閾値: {scoreThreshold}点</p>
      <ul className="mt-4 space-y-3">
        {items.map((m, i) => (
          <li
            key={`${m.projectOfferId}-${m.talentOfferId}-${i}`}
            className={`card card-hover p-4 ${
              m.isRecommended ? 'border-emerald-200 bg-emerald-50/50' : ''
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800">{m.projectTitle}</p>
                <p className="mt-0.5 text-sm text-slate-600">× {m.talentTitle}</p>
                {m.exclusionReason && (
                  <p className="mt-2 text-sm text-amber-700">除外理由: {m.exclusionReason}</p>
                )}
                <p className="mt-1.5 text-xs text-slate-500">
                  内訳: 基礎{m.scoreBreakdown.base} + キーワード{m.scoreBreakdown.keyword} = {m.score}点
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-700">{m.score} 点</span>
                {m.isRecommended && (
                  <span className="rounded-lg bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">推薦</span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
