import { useEffect, useMemo, useState } from 'react';
import type { MissionAccountDetail } from '../types';
import { getAccountDetail, postDiscordWebhook } from '../lib/api';
import { DISCORD_PERSONAS, LINE_TEMPLATES } from '../config';

function fmtDate(s: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export default function AccountDetailPage(props: { accountId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<MissionAccountDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postMsg, setPostMsg] = useState<string | null>(null);

  const [persona, setPersona] = useState<string>('tsumugi');

  // Quick status post (T1..T4)
  const [tier, setTier] = useState<'T1' | 'T2' | 'T3' | 'T4'>('T1');
  const [quickText, setQuickText] = useState('');

  useEffect(() => {
    setDetail(null);
    setError(null);
    setGenerated(null);
    setPostMsg(null);
    setQuickText('');
    setTier('T1');

    getAccountDetail(props.accountId)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((e) => {
        setError(String(e));
      });
  }, [props.accountId]);

  const totals = useMemo(() => {
    if (!detail) return null;
    const totalSubmissions30d = detail.learners.reduce((sum, l) => sum + l.submissions30d, 0);
    const inactiveLearners = detail.learners.filter((l) => {
      if (!l.lastActivityAt) return true;
      const days = (Date.now() - new Date(l.lastActivityAt).getTime()) / (24 * 60 * 60 * 1000);
      return days >= 7;
    });
    return { totalSubmissions30d, inactiveLearners };
  }, [detail]);

  const personaLabel = useMemo(() => DISCORD_PERSONAS.find((p) => p.key === persona)?.label ?? persona, [persona]);

  if (error) {
    return (
      <div>
        <button className="text-sm font-semibold text-primary-700 hover:underline" onClick={props.onBack}>
          ← Back
        </button>
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      </div>
    );
  }

  return (
    <div>
      <button className="text-sm font-semibold text-primary-700 hover:underline" onClick={props.onBack}>
        ← Back
      </button>

      <h2 className="mt-2 text-lg font-bold text-slate-900">{detail?.account.name ?? 'Account'}</h2>
      <div className="mt-1 text-sm text-slate-600">Last contact: {fmtDate(detail?.account.lastContactAt ?? null)}</div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <div className="text-sm font-semibold text-slate-900">Learners</div>
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Last activity</th>
                  <th className="px-3 py-2">Submissions (30d)</th>
                </tr>
              </thead>
              <tbody>
                {(detail?.learners ?? []).map((l) => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-900">{l.displayName}</td>
                    <td className="px-3 py-2 text-slate-700">{fmtDate(l.lastActivityAt)}</td>
                    <td className="px-3 py-2 text-slate-700">{l.submissions30d}</td>
                  </tr>
                ))}
                {(detail?.learners?.length ?? 0) === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-slate-500" colSpan={3}>
                      No learners.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <div className="text-sm font-semibold text-slate-900">LINE message generator</div>
          <p className="mt-1 text-sm text-slate-600">テンプレートはコード内（src/config）にあります。</p>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs font-semibold text-slate-700">Discord persona</div>
              <select
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
              >
                {DISCORD_PERSONAS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3">
              <div className="text-xs font-semibold text-slate-700">T# status quick post</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(['T1', 'T2', 'T3', 'T4'] as const).map((t) => (
                  <button
                    key={t}
                    className={`rounded-md border px-2 py-1 text-xs font-semibold ${tier === t ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100'}`}
                    onClick={() => setTier(t)}
                    type="button"
                  >
                    {t}
                  </button>
                ))}
              </div>

              <input
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                placeholder="例: 先方から返信あり。来週MTG調整中 / 7日未活動の方へ再フォロー予定"
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
              />

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="rounded-lg border border-slate-200 bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  onClick={async () => {
                    if (!detail) return;
                    const content = `【${tier}】${detail.account.name}${quickText.trim() ? `: ${quickText.trim()}` : ''}`;
                    setPosting(true);
                    setPostMsg(null);
                    try {
                      await postDiscordWebhook({ persona, content });
                      setPostMsg(`Posted to Discord as ${personaLabel} (webhook).`);
                      setQuickText('');
                    } catch (e) {
                      setPostMsg(`Post failed: ${String(e)}`);
                    } finally {
                      setPosting(false);
                    }
                  }}
                  disabled={!detail || posting || quickText.trim().length === 0}
                  type="button"
                >
                  {posting ? 'Posting…' : `Quick post (${tier})`}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              onClick={() => {
                if (!detail || !totals) return;
                const text = LINE_TEMPLATES.weekly.build({
                  accountName: detail.account.name,
                  inactiveLearners: totals.inactiveLearners.map((x) => x.displayName),
                  totalSubmissions30d: totals.totalSubmissions30d,
                });
                setGenerated(text);
              }}
            >
              Generate weekly
            </button>
            <button
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              onClick={() => {
                if (!detail || !totals) return;
                const text = LINE_TEMPLATES.monthly.build({
                  accountName: detail.account.name,
                  learnersCount: detail.learners.length,
                  inactiveLearnersCount: totals.inactiveLearners.length,
                  totalSubmissions30d: totals.totalSubmissions30d,
                });
                setGenerated(text);
              }}
            >
              Generate monthly
            </button>
            <button
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              onClick={async () => {
                if (!generated) return;
                await navigator.clipboard.writeText(generated);
                setPostMsg('Copied to clipboard.');
              }}
              disabled={!generated}
            >
              Copy
            </button>
            <button
              className="rounded-lg border border-slate-200 bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              onClick={async () => {
                if (!generated) return;
                setPosting(true);
                setPostMsg(null);
                try {
                  await postDiscordWebhook({ persona, content: generated });
                  setPostMsg(`Posted to Discord as ${personaLabel} (webhook).`);
                } catch (e) {
                  setPostMsg(`Post failed: ${String(e)}`);
                } finally {
                  setPosting(false);
                }
              }}
              disabled={!generated || posting}
            >
              {posting ? 'Posting…' : `Post to Discord (${personaLabel})`}
            </button>
          </div>

          <div className="mt-3">
            <div className="text-xs font-semibold text-slate-600">Preview</div>
            <textarea
              value={generated ?? ''}
              onChange={(e) => setGenerated(e.target.value)}
              className="mt-1 h-52 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              placeholder="Generate to preview..."
            />
            {postMsg && (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                {postMsg}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
