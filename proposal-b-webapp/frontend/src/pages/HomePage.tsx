import { useEffect, useMemo, useState } from 'react';
import {
  getActivity,
  getPersonas,
  getThreadMessages,
  getThreads,
  postActivity,
  type PersonaProfile,
  type ThreadMessage,
  type ThreadSummary,
} from '../lib/api';

type ApprovalCard = {
  ticket: string;
  askedAt: string;
  askedBy: string;
  askedTo: string;
  question: string;
};

function parseYesNo(text: string) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim());
  const hit = lines.find((l) => l.startsWith('Yes/No：') || l.startsWith('Yes/No:') || l.startsWith('YesNo：') || l.startsWith('YesNo:'));
  if (!hit) return null;
  return hit.replace(/^(Yes\/No|YesNo)[：:]\s*/, '').trim();
}

function startsNewTicket(text: string) {
  const t = String(text || '').trim();
  if (!t) return false;
  return t.startsWith('新規:') || t.startsWith('別件:') || /^T#\d+/.test(t);
}

function extractExplicitTicket(text: string) {
  const t = String(text || '').trim();
  const m = t.match(/^(T#\d+)/);
  return m?.[1] ?? null;
}

function makeNewTicket() {
  return `T#${Math.floor(Math.random() * 9000 + 1000)}`;
}

export default function HomePage() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [personas, setPersonas] = useState<PersonaProfile[]>([]);
  const [focusTicket, setFocusTicket] = useState<string | null>(null);
  const [focusMessages, setFocusMessages] = useState<ThreadMessage[]>([]);
  const [activity, setActivity] = useState<Array<{ id: string; ts: string; persona: string; to?: string; kind: string; ticket?: string; text: string }>>([]);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const personaMap = useMemo(() => {
    const m: Record<string, PersonaProfile> = {};
    for (const p of personas) m[p.key.toLowerCase()] = p;
    return m;
  }, [personas]);

  const load = async () => {
    try {
      setError(null);
      const [t, p, a] = await Promise.all([getThreads(20), getPersonas(), getActivity(120)]);
      setThreads(t.items);
      setPersonas(p.items);
      setActivity(a.items);

      if (!focusTicket) {
        const remembered = window.localStorage.getItem('mc_focus_ticket');
        const pick = remembered || t.items[0]?.ticket || null;
        setFocusTicket(pick);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const loadFocus = async (ticket: string) => {
    try {
      const d = await getThreadMessages(ticket, 120);
      setFocusMessages(d.items);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    load();
    const id = window.setInterval(load, 10000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!focusTicket) return;
    window.localStorage.setItem('mc_focus_ticket', focusTicket);
    loadFocus(focusTicket);
    const id = window.setInterval(() => loadFocus(focusTicket).catch(() => void 0), 10000);
    return () => window.clearInterval(id);
  }, [focusTicket]);

  const liveStatus = useMemo(() => {
    // Take latest doing message per persona as “実況”.
    const latest = new Map<string, { ts: string; ticket?: string; text: string }>();
    for (const a of activity) {
      const p = String(a.persona || '').toLowerCase();
      if (!p) continue;
      if (a.kind !== 'doing') continue;
      const cur = latest.get(p);
      if (!cur || a.ts > cur.ts) latest.set(p, { ts: a.ts, ticket: a.ticket, text: a.text });
    }

    const items = Array.from(latest.entries())
      .map(([persona, v]) => ({ persona, ...v }))
      .sort((x, y) => (x.ts < y.ts ? 1 : -1))
      .slice(0, 6);

    return items;
  }, [activity]);

  const approvals = useMemo<ApprovalCard[]>(() => {
    // Rule: message contains Yes/No AND to==mjup. Not yet answered by mjup after askedAt.
    const asked: ApprovalCard[] = [];
    for (const m of activity) {
      if (!m.ticket) continue;
      const q = parseYesNo(m.text);
      if (!q) continue;
      const to = String(m.to || '').toLowerCase();
      if (to !== 'mjup') continue;
      asked.push({
        ticket: m.ticket,
        askedAt: m.ts,
        askedBy: String(m.persona || ''),
        askedTo: 'mjup',
        question: q,
      });
    }

    // last answer per ticket by mjup
    const lastAnswerAt = new Map<string, string>();
    for (const m of activity) {
      if (!m.ticket) continue;
      if (String(m.persona || '').toLowerCase() !== 'mjup') continue;
      const ts = m.ts;
      const cur = lastAnswerAt.get(m.ticket);
      if (!cur || ts > cur) lastAnswerAt.set(m.ticket, ts);
    }

    const pending: ApprovalCard[] = [];
    // take most recent ask per ticket
    const byTicket = new Map<string, ApprovalCard>();
    for (const a of asked) {
      const cur = byTicket.get(a.ticket);
      if (!cur || a.askedAt > cur.askedAt) byTicket.set(a.ticket, a);
    }

    for (const a of byTicket.values()) {
      const ans = lastAnswerAt.get(a.ticket);
      if (ans && ans > a.askedAt) continue;
      pending.push(a);
    }

    pending.sort((x, y) => (x.askedAt < y.askedAt ? 1 : -1));
    return pending.slice(0, 3);
  }, [activity]);

  const focus = useMemo(() => {
    if (!focusTicket) return null;
    return threads.find((t) => t.ticket === focusTicket) ?? null;
  }, [threads, focusTicket]);

  const focusSummary = useMemo(() => {
    const last = focusMessages[focusMessages.length - 1];
    const firstLine = last?.text?.split(/\r?\n/).find(Boolean) ?? '';
    return firstLine;
  }, [focusMessages]);

  const compactThreads = useMemo(() => {
    const items = [...threads];
    items.sort((a, b) => (a.lastTs < b.lastTs ? 1 : -1));
    return items.slice(0, 8);
  }, [threads]);

  async function sendFromHome() {
    const text = draft.trim();
    if (!text) return;

    const explicit = extractExplicitTicket(text);
    const targetTicket = explicit
      ? explicit
      : startsNewTicket(text)
        ? makeNewTicket()
        : focusTicket ?? makeNewTicket();

    setSending(true);
    try {
      await postActivity({ persona: 'mjup', to: 'shiki', kind: 'info', ticket: targetTicket, text });
      setDraft('');
      setFocusTicket(targetTicket);
      await load();
      await loadFocus(targetTicket);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  async function answer(ticket: string, yes: boolean) {
    setSending(true);
    try {
      await postActivity({
        persona: 'mjup',
        to: 'shiki',
        kind: 'info',
        ticket,
        text: yes ? '承認：Yes' : '承認：No',
      });
      await load();
      if (ticket === focusTicket) await loadFocus(ticket);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="h-[calc(100vh-112px)] overflow-hidden">
      <div className="pixel-office h-full overflow-hidden">
        <div className="flex h-full flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="pixel-h1">司令室</div>
              <div className="pixel-sub">ここだけ見れば回る（スクロール無し / 10秒更新）</div>
            </div>
            {error ? <div className="pixel-error max-w-[60%] truncate">{error}</div> : null}
          </div>

          {/* Live status bar */}
          <div className="pixel-room">
            <div className="flex items-center justify-between">
              <div className="pixel-h3">実況（いま動いてる）</div>
              <div className="pixel-sub opacity-70">doing の最新だけ表示</div>
            </div>
            <div className="mt-2 grid gap-2 lg:grid-cols-3">
              {liveStatus.length ? (
                liveStatus.map((s) => {
                  const prof = personaMap[s.persona];
                  const label = (prof?.animal ? prof.animal + ' ' : '') + (prof?.displayName ?? s.persona);
                  const first = String(s.text || '').split(/\r?\n/).find(Boolean) ?? '';
                  return (
                    <div key={s.persona} className="pixel-inset">
                      <div className="pixel-sub opacity-80">{label} · {s.ticket ?? '—'}</div>
                      <div className="mt-0.5 line-clamp-1 text-sm text-slate-100/90">{first}</div>
                    </div>
                  );
                })
              ) : (
                <div className="pixel-sub opacity-70">まだ実況が無い。各プロは doing で status を投稿すると出る。</div>
              )}
            </div>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[0.9fr_1.2fr_0.9fr]">
            {/* Left: Threads */}
            <section className="pixel-room overflow-hidden">
              <div className="pixel-h3">T#（最大8）</div>
              <div className="mt-2 grid gap-2">
                {compactThreads.map((t) => {
                  const active = t.ticket === focusTicket;
                  const animal = personaMap[t.lastPersona?.toLowerCase()]?.animal;
                  const name = personaMap[t.lastPersona?.toLowerCase()]?.displayName ?? t.lastPersona;
                  return (
                    <button
                      key={t.ticket}
                      type="button"
                      onClick={() => setFocusTicket(t.ticket)}
                      className={`text-left ${active ? 'pixel-note pixel-note--blocked' : 'pixel-note'}`}
                    >
                      <div className="pixel-note-meta">
                        {t.ticket} · {animal ? animal + ' ' : ''}
                        {name} · {t.lastKind}
                      </div>
                      <div className="mt-1 line-clamp-1 text-sm text-slate-950">{t.lastText}</div>
                    </button>
                  );
                })}
                {compactThreads.length === 0 ? <div className="pixel-sub opacity-70">まだT#が無い。下の入力で開始。</div> : null}
              </div>
            </section>

            {/* Center: Focus */}
            <section className="pixel-room overflow-hidden">
              <div className="flex items-center justify-between gap-2">
                <div className="pixel-h3">Focus</div>
                <div className="pixel-sub opacity-70">{focusTicket ?? '—'}</div>
              </div>

              <div className="mt-2 pixel-panel overflow-hidden">
                <div className="pixel-title">{focus ? `${focus.ticket} · ${focus.lastKind}` : '—'}</div>
                <div className="mt-1 line-clamp-2 text-sm text-slate-100/90">{focusSummary || 'まだ投稿がありません。'}</div>

                <div className="mt-3 grid gap-2">
                  {focusMessages.slice(-3).map((m) => {
                    const animal = personaMap[m.persona?.toLowerCase()]?.animal;
                    const name = personaMap[m.persona?.toLowerCase()]?.displayName ?? m.persona;
                    return (
                      <div key={m.id} className="pixel-inset">
                        <div className="pixel-sub opacity-80">
                          {animal ? animal + ' ' : ''}
                          {name}
                          {m.to ? ` → ${m.to}` : ''} · {m.kind}
                        </div>
                        <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-slate-100/90">{m.text}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Right: Approvals */}
            <section className="pixel-room overflow-hidden">
              <div className="pixel-h3">承認待ち（Yes/No）</div>
              <div className="mt-2 grid gap-2">
                {approvals.map((a) => (
                  <div key={a.ticket} className="pixel-alert">
                    <div className="pixel-h3">{a.ticket}</div>
                    <div className="mt-1 text-sm text-slate-100/90">{a.question}</div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        className="btn-primary px-3 py-2"
                        disabled={sending}
                        onClick={() => answer(a.ticket, true)}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className="btn-secondary px-3 py-2"
                        disabled={sending}
                        onClick={() => answer(a.ticket, false)}
                      >
                        No
                      </button>
                    </div>
                  </div>
                ))}
                {approvals.length === 0 ? <div className="pixel-sub opacity-70">承認待ちは無し。</div> : null}
              </div>
            </section>
          </div>

          {/* Bottom input (fixed) */}
          <div className="pixel-panel">
            <div className="pixel-sub">まーき入力（デフォルトはFocusに追記。新規は `新規:` / `別件:` / `T#123 …`）</div>
            <div className="mt-2 flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg border border-slate-300 bg-white/90 px-3 py-2 text-sm text-slate-900"
                placeholder="例：次の改善3つを進めて。右側を壁面ディスプレイ化、家具差分、Yes/NoをHomeに…"
              />
              <button type="button" className="btn-primary px-4 py-3" disabled={sending || !draft.trim()} onClick={sendFromHome}>
                {sending ? '送信中…' : '送信'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
