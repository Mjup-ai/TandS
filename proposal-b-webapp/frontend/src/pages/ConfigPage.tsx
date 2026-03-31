import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/http';
import LoadingBlock from '../components/LoadingBlock';

interface Config {
  scoreThreshold: number;
  gmailAccount?: string | null;
}

interface Stats {
  rawEmailCount?: number;
  projectOfferCount?: number;
  talentOfferCount?: number;
  matchCount?: number;
}

export default function ConfigPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    apiFetch('/api/config')
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig(null))
      .finally(() => setLoadingConfig(false));

    apiFetch('/api/stats')
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoadingStats(false));
  }, []);

  if (loadingConfig && loadingStats) {
    return <LoadingBlock />;
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h2 className="section-title">設定</h2>
        {config ? (
          <dl className="mt-4 space-y-4">
            <div>
              <dt className="text-sm font-medium text-slate-500">推薦閾値（スコア）</dt>
              <dd className="mt-1 text-slate-800">{config.scoreThreshold} 点以上を推薦とする</dd>
            </div>
            {config.gmailAccount != null && (
              <div>
                <dt className="text-sm font-medium text-slate-500">Gmail アカウント</dt>
                <dd className="mt-1 text-slate-800">{config.gmailAccount || '未設定'}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="mt-4 text-sm text-slate-500">設定情報の取得に失敗しました。</p>
        )}
        <p className="mt-5 text-xs text-slate-500">閾値の変更はサーバー側の設定で行います。</p>
      </div>

      <div className="card p-6">
        <h2 className="section-title">統計</h2>
        {loadingStats ? (
          <LoadingBlock />
        ) : stats ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
              <div className="text-2xl font-bold text-slate-800">{stats.rawEmailCount ?? '—'}</div>
              <div className="mt-1 text-sm font-medium text-slate-500">メール件数</div>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-center">
              <div className="text-2xl font-bold text-blue-800">{stats.projectOfferCount ?? '—'}</div>
              <div className="mt-1 text-sm font-medium text-blue-600">案件数</div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
              <div className="text-2xl font-bold text-emerald-800">{stats.talentOfferCount ?? '—'}</div>
              <div className="mt-1 text-sm font-medium text-emerald-600">人材数</div>
            </div>
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-center">
              <div className="text-2xl font-bold text-indigo-800">{stats.matchCount ?? '—'}</div>
              <div className="mt-1 text-sm font-medium text-indigo-600">マッチ数</div>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">統計情報の取得に失敗しました。</p>
        )}
      </div>
    </div>
  );
}
