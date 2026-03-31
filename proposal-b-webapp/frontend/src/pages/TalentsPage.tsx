import { useEffect, useState } from 'react';
import LoadingBlock from '../components/LoadingBlock';
import { apiFetch } from '../lib/http';

interface TalentOfferItem {
  id: string;
  talent: { id: string };
  salesOwnerEmail?: string | null;
  salesOwnerName?: string | null;
  rawEmail: {
    id: string;
    subject: string | null;
    fromAddr: string;
    toAddr: string | null;
    salesOwnerEmail: string | null;
    salesOwnerName: string | null;
    bodyText: string | null;
    receivedAt: string;
  } | null;
}

interface TalentDedupeCandidate {
  score: number;
  reasons: string[];
  left: TalentOfferItem;
  right: TalentOfferItem;
}

interface TalentDedupeHistoryItem {
  id: string;
  createdAt: string;
  userId: string | null;
  payload: {
    keepOfferId: string;
    mergeOfferId: string;
    fromTalentId: string;
    toTalentId: string;
  } | null;
  keepOffer: {
    id: string;
    rawEmail: { subject: string | null; salesOwnerName: string | null; salesOwnerEmail: string | null; receivedAt: string | null } | null;
  } | null;
  mergeOffer: {
    id: string;
    rawEmail: { subject: string | null; salesOwnerName: string | null; salesOwnerEmail: string | null; receivedAt: string | null } | null;
  } | null;
}

export default function TalentsPage() {
  const [items, setItems] = useState<TalentOfferItem[]>([]);
  const [duplicates, setDuplicates] = useState<TalentDedupeCandidate[]>([]);
  const [history, setHistory] = useState<TalentDedupeHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [queryDraft, setQueryDraft] = useState('');
  const [salesOwnerDraft, setSalesOwnerDraft] = useState('');
  const [query, setQuery] = useState('');
  const [salesOwner, setSalesOwner] = useState('');
  const [mergingKey, setMergingKey] = useState<string | null>(null);
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [matchResults, setMatchResults] = useState<Array<{ projectTitle: string; talentTitle: string; score: number; isRecommended: boolean; recommendationReasons: string[]; exclusionReason: string | null }> | null>(null);
  const [matchTargetTitle, setMatchTargetTitle] = useState<string>('');

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (query.trim()) params.set('q', query.trim());
    if (salesOwner.trim()) params.set('salesOwner', salesOwner.trim());

    Promise.all([
      apiFetch(`/api/talent-offers?${params.toString()}`).then((r) => r.json()),
      apiFetch(`/api/talent-dedupe-candidates?${params.toString()}`).then((r) => r.json()),
      apiFetch('/api/talent-dedupe-history?limit=10').then((r) => r.json()),
    ])
      .then(([offersData, duplicateData, historyData]) => {
        setItems(offersData.items ?? []);
        setTotal(offersData.total ?? 0);
        setDuplicates(duplicateData.items ?? []);
        setHistory(historyData.items ?? []);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
        setDuplicates([]);
        setHistory([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [query, salesOwner]);

  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(queryDraft);
    setSalesOwner(salesOwnerDraft);
  };

  const clearFilters = () => {
    setQueryDraft('');
    setSalesOwnerDraft('');
    setQuery('');
    setSalesOwner('');
  };

  const mergeOffers = async (keepOfferId: string, mergeOfferId: string) => {
    if (!window.confirm('この2件を同一人材として束ねますか？')) return;
    const key = `${keepOfferId}:${mergeOfferId}`;
    setMergingKey(key);
    try {
      const res = await apiFetch('/api/talent-dedupe-merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keepOfferId, mergeOfferId }),
      });
      if (!res.ok) throw new Error('merge failed');
      load();
    } catch {
      window.alert('統合に失敗しました。');
    } finally {
      setMergingKey(null);
    }
  };

  const findMatches = async (talentOfferId: string, title: string) => {
    setMatchingId(talentOfferId);
    setMatchResults(null);
    setMatchTargetTitle(title);
    try {
      const res = await apiFetch('/api/match', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ talentOfferId }),
      });
      const data = await res.json();
      if (data.items) {
        setMatchResults(data.items);
      } else if (Array.isArray(data)) {
        setMatchResults(data);
      } else {
        setMatchResults([]);
      }
    } catch {
      window.alert('マッチング検索に失敗しました。');
      setMatchResults(null);
    } finally {
      setMatchingId(null);
    }
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <h2 className="text-base font-semibold text-slate-700">人材</h2>
        <p className="mt-2 text-sm">受信一覧で「人材」と分類したメールがここに表示されます。</p>
        <p className="mt-3 text-sm text-slate-500">まだ1件もありません。受信タブでメールを追加し、「人材」を押してください。</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800">人材（{total} 件）</h2>
          <p className="mt-1 text-sm text-slate-500">担当営業とキーワードで、見るべき人材だけに寄せられます。</p>
        </div>
      </div>

      <form onSubmit={applyFilters} className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <div className="grid gap-3 md:grid-cols-[2fr_1.3fr_auto_auto]">
          <div>
            <label className="block text-sm font-medium text-slate-700">キーワード</label>
            <input
              type="text"
              value={queryDraft}
              onChange={(e) => setQueryDraft(e.target.value)}
              placeholder="件名、本文、開始時期など"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400 focus:border-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">担当営業</label>
            <input
              type="text"
              value={salesOwnerDraft}
              onChange={(e) => setSalesOwnerDraft(e.target.value)}
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

      <section className="mt-4 rounded-xl border border-sky-200 bg-sky-50/60 p-4 shadow-card">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-sky-900">重複候補</h3>
            <p className="mt-1 text-sm text-sky-800">複数営業マン経由で来た同一人材っぽい候補をここで先に確認できます。</p>
          </div>
          <div className="text-sm font-medium text-sky-900">{duplicates.length} 件</div>
        </div>

        {duplicates.length === 0 ? (
          <p className="mt-3 text-sm text-sky-800/80">今の条件では重複候補は見つかっていません。</p>
        ) : (
          <div className="mt-4 space-y-3">
            {duplicates.map((candidate, index) => (
              <div key={`${candidate.left.id}-${candidate.right.id}-${index}`} className="rounded-xl border border-sky-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-sky-900">候補スコア {candidate.score}</div>
                  <div className="flex flex-wrap gap-2">
                    {candidate.reasons.map((reason) => (
                      <span key={reason} className="rounded-md bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                        {reason}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {[candidate.left, candidate.right].map((offer, offerIndex) => (
                    <div key={`${offer.id}-${offerIndex}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="font-medium text-slate-800">{offer.rawEmail?.subject || '（件名なし）'}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {offer.rawEmail?.fromAddr} · {offer.rawEmail?.receivedAt ? new Date(offer.rawEmail.receivedAt).toLocaleString('ja-JP') : ''}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {offer.salesOwnerName || offer.salesOwnerEmail || offer.rawEmail?.salesOwnerName || offer.rawEmail?.salesOwnerEmail ? (
                          <span className="rounded-md bg-sky-100 px-2 py-0.5 font-medium text-sky-800">
                            担当営業: {offer.salesOwnerName || offer.salesOwnerEmail || offer.rawEmail?.salesOwnerName || offer.rawEmail?.salesOwnerEmail}
                          </span>
                        ) : null}
                        {offer.rawEmail?.toAddr ? (
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                            宛先: {offer.rawEmail.toAddr}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={mergingKey === `${candidate.left.id}:${candidate.right.id}` || mergingKey === `${candidate.right.id}:${candidate.left.id}`}
                    onClick={() => mergeOffers(candidate.left.id, candidate.right.id)}
                  >
                    左を残して統合
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={mergingKey === `${candidate.left.id}:${candidate.right.id}` || mergingKey === `${candidate.right.id}:${candidate.left.id}`}
                    onClick={() => mergeOffers(candidate.right.id, candidate.left.id)}
                  >
                    右を残して統合
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">統合履歴</h3>
            <p className="mt-1 text-sm text-slate-500">直近で同一人材として束ねた操作です。</p>
          </div>
          <div className="text-sm font-medium text-slate-700">{history.length} 件</div>
        </div>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">まだ統合履歴はありません。</p>
        ) : (
          <div className="mt-4 space-y-2">
            {history.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <div className="font-medium text-slate-800">{new Date(item.createdAt).toLocaleString('ja-JP')}</div>
                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <div className="rounded-md bg-white p-2">
                    <div className="text-xs font-semibold text-slate-500">残した人材</div>
                    <div className="mt-1 font-medium text-slate-800">
                      {item.keepOffer?.rawEmail?.subject || item.payload?.keepOfferId || '—'}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {item.keepOffer?.rawEmail?.salesOwnerName || item.keepOffer?.rawEmail?.salesOwnerEmail || '担当不明'}
                    </div>
                  </div>
                  <div className="rounded-md bg-white p-2">
                    <div className="text-xs font-semibold text-slate-500">束ねた人材</div>
                    <div className="mt-1 font-medium text-slate-800">
                      {item.mergeOffer?.rawEmail?.subject || item.payload?.mergeOfferId || '—'}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {item.mergeOffer?.rawEmail?.salesOwnerName || item.mergeOffer?.rawEmail?.salesOwnerEmail || '担当不明'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {matchResults !== null && (
        <section className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 shadow-card">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-indigo-900">マッチ結果: {matchTargetTitle}</h3>
              <p className="mt-1 text-sm text-indigo-800">{matchResults.length} 件の候補案件が見つかりました。</p>
            </div>
            <button type="button" className="btn-secondary text-sm" onClick={() => setMatchResults(null)}>閉じる</button>
          </div>
          {matchResults.length === 0 ? (
            <p className="mt-3 text-sm text-indigo-800/80">マッチする案件が見つかりませんでした。</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {matchResults.map((mr, i) => (
                <li key={i} className={`rounded-lg border p-3 ${
                  mr.score >= 80 ? 'border-emerald-200 bg-emerald-50' :
                  mr.score >= 50 ? 'border-amber-200 bg-amber-50' :
                  'border-slate-200 bg-white'
                }`}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-medium text-slate-800">{mr.projectTitle}</span>
                      {mr.exclusionReason && <span className="ml-2 text-xs text-amber-700">({mr.exclusionReason})</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-lg px-2.5 py-1 text-sm font-medium ${
                        mr.score >= 80 ? 'bg-emerald-100 text-emerald-800' :
                        mr.score >= 50 ? 'bg-amber-100 text-amber-800' :
                        'bg-slate-100 text-slate-700'
                      }`}>{mr.score} 点</span>
                      {mr.isRecommended && <span className="rounded-lg bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">推薦</span>}
                    </div>
                  </div>
                  {mr.recommendationReasons.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {mr.recommendationReasons.map((r) => (
                        <span key={r} className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">{r}</span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ul className="mt-4 space-y-3">
        {items.map((o) => (
          <li key={o.id} className="card card-hover p-4">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="font-medium text-slate-800">{o.rawEmail?.subject || '（件名なし）'}</p>
                <p className="mt-0.5 text-sm text-slate-500">{o.rawEmail?.fromAddr} · {o.rawEmail?.receivedAt ? new Date(o.rawEmail.receivedAt).toLocaleString('ja-JP') : ''}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {o.salesOwnerName || o.salesOwnerEmail || o.rawEmail?.salesOwnerName || o.rawEmail?.salesOwnerEmail ? (
                    <span className="rounded-md bg-sky-100 px-2 py-0.5 font-medium text-sky-800">
                      担当営業: {o.salesOwnerName || o.salesOwnerEmail || o.rawEmail?.salesOwnerName || o.rawEmail?.salesOwnerEmail}
                    </span>
                  ) : null}
                  {o.rawEmail?.toAddr ? (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                      宛先: {o.rawEmail.toAddr}
                    </span>
                  ) : null}
                </div>
                {o.rawEmail?.bodyText && (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                    {expandedId === o.id ? o.rawEmail.bodyText : `${o.rawEmail.bodyText.slice(0, 200)}${o.rawEmail.bodyText.length > 200 ? '…' : ''}`}
                  </p>
                )}
                {o.rawEmail?.bodyText && o.rawEmail.bodyText.length > 200 && (
                  <p className="mt-1.5 text-xs font-medium text-primary-600">{expandedId === o.id ? '閉じる' : '本文をすべて表示'}</p>
                )}
              </button>
              <button
                type="button"
                disabled={matchingId === o.id}
                onClick={() => findMatches(o.id, o.rawEmail?.subject || '（件名なし）')}
                className="shrink-0 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              >
                {matchingId === o.id ? '検索中…' : 'マッチ検索'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
