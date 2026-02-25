import { useEffect, useMemo, useState } from 'react';
import type { MissionKpis } from '../types';
import { getActivity, getKpis, getPresence } from '../lib/api';

function KpiCard(props: { label: string; value: number | string; tone?: 'neutral' | 'red' | 'yellow' | 'green' }) {
  const toneClass =
    props.tone === 'red'
      ? 'border-red-200 bg-red-50 text-red-900'
      : props.tone === 'yellow'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : props.tone === 'green'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-slate-200 bg-white text-slate-900';

  return (
    <div className={`rounded-xl border p-4 shadow-card ${toneClass}`}>
      <div className="text-xs font-medium text-slate-600">{props.label}</div>
      <div className="mt-1 text-2xl font-bold">{props.value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [kpis, setKpis] = useState<MissionKpis | null>(null);
  const [activity, setActivity] = useState<Array<{ id: string; ts: string; persona: string; kind: string; ticket?: string; text: string }>>([]);
  const [presence, setPresence] = useState<Record<string, { lastSeenAt: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [k, a, p] = await Promise.all([getKpis(), getActivity(25), getPresence()]);
      setKpis(k);
      setActivity(a.items);
      setPresence(p.presence);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    load();
    const t = window.setInterval(load, 10000);
    return () => window.clearInterval(t);
  }, []);

  const officeRows = useMemo(() => {
    const keys = new Set<string>([...Object.keys(presence), ...activity.map((a) => String(a.persona || '').toLowerCase()).filter(Boolean)]);

    const latestByPersona = new Map<string, { ts: string; kind: string; ticket?: string; text: string }>();
    for (const a of activity) {
      const k = String(a.persona || '').toLowerCase();
      if (!k) continue;
      const cur = latestByPersona.get(k);
      if (!cur || a.ts > cur.ts) {
        latestByPersona.set(k, { ts: a.ts, kind: a.kind, ticket: a.ticket, text: a.text });
      }
    }

    const rows = Array.from(keys).map((persona) => {
      const lastSeenAt = presence[persona]?.lastSeenAt ?? null;
      const lastMsg = latestByPersona.get(persona) ?? null;
      return { persona, lastSeenAt, lastMsg };
    });

    rows.sort((a, b) => {
      const at = a.lastSeenAt ?? a.lastMsg?.ts ?? '';
      const bt = b.lastSeenAt ?? b.lastMsg?.ts ?? '';
      return at < bt ? 1 : -1;
    });

    return rows;
  }, [presence, activity]);

  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">ダッシュボード</h2>
          <p className="mt-0.5 text-sm text-slate-500">KPI / オフィス稼働 / 最新ログ</p>
        </div>
        <button type="button" className="btn-secondary px-3 py-2 text-sm" onClick={load}>
          更新
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="事業所数" value={kpis?.totalAccounts ?? '—'} />
        <KpiCard label="赤" value={kpis?.accountsRed ?? '—'} tone="red" />
        <KpiCard label="黄" value={kpis?.accountsYellow ?? '—'} tone="yellow" />
        <KpiCard label="緑" value={kpis?.accountsGreen ?? '—'} tone="green" />
        <KpiCard label="7日以上動きなし（利用者）" value={kpis?.inactiveLearners ?? '—'} />
        <KpiCard label="提出数（30日）" value={kpis?.submissionsCount ?? '—'} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">オフィス稼働（リアルタイム）</h3>
            <span className="text-xs text-slate-500">10秒ごとに更新</span>
          </div>
          <div className="mt-3 space-y-2">
            {officeRows.map((r) => (
              <div key={r.persona} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-base font-bold text-slate-900">{r.persona}</div>
                  <div className="text-xs text-slate-500">
                    最終稼働：{r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleString('ja-JP') : '—'}
                  </div>
                </div>
                <div className="mt-2 rounded-lg bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-slate-600">
                      最新ログ：{r.lastMsg ? new Date(r.lastMsg.ts).toLocaleString('ja-JP') : '—'}
                    </div>
                    <div className="text-xs text-slate-400">
                      {r.lastMsg?.kind ?? '—'} {r.lastMsg?.ticket ? `· ${r.lastMsg.ticket}` : ''}
                    </div>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{r.lastMsg?.text ?? '—'}</div>
                </div>
              </div>
            ))}
            {officeRows.length === 0 ? <div className="text-sm text-slate-500">まだ稼働ログがありません。</div> : null}
          </div>
        </section>

        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">最新ログ（見やすい版）</h3>
            <span className="text-xs text-slate-500">上から新しい順</span>
          </div>
          <div className="mt-3 space-y-2">
            {activity.map((a) => (
              <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-bold text-slate-900">
                    {a.persona} · {new Date(a.ts).toLocaleString('ja-JP')}
                  </div>
                  <div className="text-xs text-slate-400">
                    {a.kind} {a.ticket ? `· ${a.ticket}` : ''}
                  </div>
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{a.text}</div>
              </div>
            ))}
            {activity.length === 0 ? <div className="text-sm text-slate-500">まだログがありません。</div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
