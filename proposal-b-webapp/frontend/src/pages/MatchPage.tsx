import { useEffect, useState } from 'react';
import LoadingBlock from '../components/LoadingBlock';
import { apiFetch } from '../lib/http';

interface MatchItem {
  projectOfferId: string;
  talentOfferId: string;
  projectTitle: string;
  talentTitle: string;
  projectSalesOwnerEmail: string | null;
  projectSalesOwnerName: string | null;
  talentSalesOwnerEmail: string | null;
  talentSalesOwnerName: string | null;
  score: number;
  scoreBreakdown: { keyword: number; base: number; tech?: number; price?: number; location?: number; start?: number; remote?: number };
  isRecommended: boolean;
  exclusionReason: string | null;
  recommendationReasons: string[];
  attentionPoint: string | null;
  confirmationQuestions: string[];
}

export default function MatchPage() {
  const [items, setItems] = useState<MatchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [scoreThreshold, setScoreThreshold] = useState(70);
  const [recommendedOnly, setRecommendedOnly] = useState(false);
  const [projectSalesOwnerDraft, setProjectSalesOwnerDraft] = useState('');
  const [talentSalesOwnerDraft, setTalentSalesOwnerDraft] = useState('');
  const [projectSalesOwner, setProjectSalesOwner] = useState('');
  const [talentSalesOwner, setTalentSalesOwner] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50', recommendedOnly: String(recommendedOnly) });
    if (projectSalesOwner.trim()) params.set('projectSalesOwner', projectSalesOwner.trim());
    if (talentSalesOwner.trim()) params.set('talentSalesOwner', talentSalesOwner.trim());
    const url = `/api/matches?${params.toString()}`;
    apiFetch(url)
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
        if (data.scoreThreshold != null) setScoreThreshold(data.scoreThreshold);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [recommendedOnly, projectSalesOwner, talentSalesOwner]);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setProjectSalesOwner(projectSalesOwnerDraft);
    setTalentSalesOwner(talentSalesOwnerDraft);
  }

  function clearFilters() {
    setProjectSalesOwnerDraft('');
    setTalentSalesOwnerDraft('');
    setProjectSalesOwner('');
    setTalentSalesOwner('');
  }

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
      <form onSubmit={applyFilters} className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <div className="grid gap-3 md:grid-cols-[1.3fr_1.3fr_auto_auto]">
          <div>
            <label className="block text-sm font-medium text-slate-700">案件担当</label>
            <input
              type="text"
              value={projectSalesOwnerDraft}
              onChange={(e) => setProjectSalesOwnerDraft(e.target.value)}
              placeholder="名前またはメール"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400 focus:border-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">人材担当</label>
            <input
              type="text"
              value={talentSalesOwnerDraft}
              onChange={(e) => setTalentSalesOwnerDraft(e.target.value)}
              placeholder="名前またはメール"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400 focus:border-primary-500"
            />
          </div>
          <button type="submit" className="btn-primary h-11 self-end">
            絞り込む
          </button>
          <button type="button" onClick={clearFilters} className="btn-secondary h-11 self-end">
            クリア
          </button>
        </div>
      </form>
      <ul className="mt-4 space-y-3">
        {items.map((m, i) => (
          <li
            key={`${m.projectOfferId}-${m.talentOfferId}-${i}`}
            className={`card card-hover p-4 ${
              m.score >= 80 ? 'border-l-4 border-l-emerald-400 bg-emerald-50/30' :
              m.score >= 50 ? 'border-l-4 border-l-amber-400 bg-amber-50/30' :
              'border-l-4 border-l-red-300 bg-red-50/20'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                    <div className="text-xs font-semibold text-blue-600">案件</div>
                    <p className="mt-1 font-medium text-slate-800">{m.projectTitle}</p>
                    {(m.projectSalesOwnerName || m.projectSalesOwnerEmail) && (
                      <span className="mt-1 inline-block rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        担当: {m.projectSalesOwnerName || m.projectSalesOwnerEmail}
                      </span>
                    )}
                  </div>
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
                    <div className="text-xs font-semibold text-emerald-600">人材</div>
                    <p className="mt-1 font-medium text-slate-800">{m.talentTitle}</p>
                    {(m.talentSalesOwnerName || m.talentSalesOwnerEmail) && (
                      <span className="mt-1 inline-block rounded-md bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                        担当: {m.talentSalesOwnerName || m.talentSalesOwnerEmail}
                      </span>
                    )}
                  </div>
                </div>
                {m.exclusionReason && (
                  <p className="mt-2 text-sm text-amber-700">除外理由: {m.exclusionReason}</p>
                )}
                <p className="mt-1.5 text-xs text-slate-500">
                  内訳: 基礎{m.scoreBreakdown.base} + キーワード{m.scoreBreakdown.keyword} + 技術{m.scoreBreakdown.tech ?? 0} + 単価{m.scoreBreakdown.price ?? 0} + 勤務地{m.scoreBreakdown.location ?? 0} + 開始{m.scoreBreakdown.start ?? 0} + リモート{m.scoreBreakdown.remote ?? 0} = {m.score}点
                </p>
                {!m.exclusionReason && m.recommendationReasons.length > 0 ? (
                  <div className="mt-3 grid gap-3 lg:grid-cols-3">
                    <div className="rounded-lg bg-emerald-50 p-3">
                      <div className="text-xs font-semibold text-emerald-800">推薦理由</div>
                      <ul className="mt-2 space-y-1 text-sm text-emerald-900">
                        {m.recommendationReasons.map((reason) => (
                          <li key={reason}>- {reason}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-lg bg-amber-50 p-3">
                      <div className="text-xs font-semibold text-amber-800">注意点</div>
                      <div className="mt-2 text-sm text-amber-900">{m.attentionPoint ?? '—'}</div>
                    </div>
                    <div className="rounded-lg bg-sky-50 p-3">
                      <div className="text-xs font-semibold text-sky-800">確認質問</div>
                      <ul className="mt-2 space-y-1 text-sm text-sky-900">
                        {m.confirmationQuestions.map((question) => (
                          <li key={question}>- {question}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-lg px-2.5 py-1 text-sm font-medium ${
                  m.score >= 80 ? 'bg-emerald-100 text-emerald-800' :
                  m.score >= 50 ? 'bg-amber-100 text-amber-800' :
                  'bg-red-100 text-red-700'
                }`}>{m.score} 点</span>
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
