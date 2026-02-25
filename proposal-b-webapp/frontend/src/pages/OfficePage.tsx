import { useEffect, useMemo, useState } from 'react';
import {
  getActivity,
  getPersonas,
  getPresence,
  getQueueRunning,
  getQueueSummary,
  getThreadMessages,
  getThreads,
  postActivity,
  type PersonaProfile,
  type QueueTask,
  type ThreadMessage,
  type ThreadSummary,
} from '../lib/api';

type ActivityItem = { id: string; ts: string; persona: string; to?: string; kind: string; ticket?: string; text: string };

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

function minsAgo(tsIso: string) {
  const ms = Date.now() - new Date(tsIso).getTime();
  return Math.max(0, Math.round(ms / 60000));
}

function Lamp(props: { tone: 'green' | 'yellow' | 'red' }) {
  const cls =
    props.tone === 'green'
      ? 'pixel-lamp pixel-lamp--green'
      : props.tone === 'yellow'
        ? 'pixel-lamp pixel-lamp--yellow'
        : 'pixel-lamp pixel-lamp--red';
  return <span className={cls} aria-label={props.tone} />;
}

function lampTone(lastSeenAt: string | null) {
  if (!lastSeenAt) return 'red' as const;
  const m = minsAgo(lastSeenAt);
  if (m <= 15) return 'green' as const;
  if (m <= 60) return 'yellow' as const;
  return 'red' as const;
}

function cutePersonaName(p: string) {
  const k = (p || '').toLowerCase();
  if (k === 'shiki') return 'シキ';
  if (k === 'kumi') return 'クミ';
  if (k === 'tsumugi') return 'ツムギ';
  if (k === 'kensaku') return 'ケンサク';
  if (k === 'hajime') return 'ハジメ';
  if (k === 'hiraku') return 'ヒラク';
  if (k === 'suu') return 'スウ';
  if (k === 'kotone') return 'コトネ';
  if (k === 'kaname') return 'カナメ';
  if (k === 'nozomi') return 'ノゾミ';
  if (k === 'moru') return 'もる';
  if (k === 'mjup' || k === 'marki' || k === 'まーき') return 'まーき';
  return p;
}

function emojiForPersona(p: string, personas?: Record<string, PersonaProfile>) {
  const k = (p || '').toLowerCase();
  const prof = personas?.[k];
  if (prof?.animal) return prof.animal;
  // fallback defaults
  if (k === 'shiki') return '🐺';
  if (k === 'tsumugi') return '🦝';
  if (k === 'kensaku') return '🦉';
  if (k === 'hajime') return '🦊';
  if (k === 'suu') return '🐙';
  if (k === 'kumi') return '🐱';
  if (k === 'kotone') return '🦜';
  if (k === 'kaname') return '🐻';
  if (k === 'nozomi') return '🦄';
  if (k === 'hiraku') return '🦦';
  if (k === 'moru') return '🦊';
  if (k === 'mjup' || k === 'marki' || k === 'まーき') return '🦉';
  return '🐾';
}

function parseOfficeFormat(text: string) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: { conclusion?: string; next?: string; blocked?: string } = {};
  for (const l of lines) {
    if (l.startsWith('結論：')) out.conclusion = l.replace(/^結論：\s*/, '');
    else if (l.startsWith('Next：')) out.next = l.replace(/^Next：\s*/, '');
    else if (l.startsWith('Blocked：')) out.blocked = l.replace(/^Blocked：\s*/, '');
  }
  return out;
}

function PixelRoomScene(props: {
  tone: 'green' | 'yellow' | 'red';
  kind: string;
  persona: string;
  personas?: Record<string, PersonaProfile>;
}) {
  const glow = props.tone === 'green' ? 'rgba(60,255,183,0.55)' : props.tone === 'yellow' ? 'rgba(255,216,77,0.45)' : 'rgba(255,77,122,0.55)';
  const blocked = props.kind === 'blocked';
  // Tiny “pixel-ish” SVG scene: wall + floor + window + desk + shelf + lamp
  return (
    <div className="pixel-scene" style={{ boxShadow: `0 0 0 2px rgba(0,0,0,0.35), 0 0 18px ${glow}` }}>
      <svg viewBox="0 0 240 120" className="pixel-scene__svg" aria-hidden>
        {/* wall */}
        <rect x="0" y="0" width="240" height="70" fill="#0f1a3a" />
        {/* floor */}
        <rect x="0" y="70" width="240" height="50" fill="#0b1020" />
        {/* floor stripes */}
        <g opacity="0.35">
          {Array.from({ length: 16 }).map((_, i) => (
            <rect key={i} x={i * 16} y={70} width={8} height={50} fill="#101b3b" />
          ))}
        </g>

        {/* window */}
        <rect x="16" y="14" width="70" height="38" fill="#081028" stroke="#2c3a7a" strokeWidth="3" />
        <g fill="#e8eaff" opacity="0.22">
          {Array.from({ length: 10 }).map((_, i) => (
            <rect key={i} x={18 + i * 7} y={16} width={3} height={34} />
          ))}
        </g>
        <rect x="16" y="52" width="70" height="6" fill="#2c3a7a" />

        {/* shelf */}
        <rect x="160" y="16" width="64" height="10" fill="#2a2f5e" />
        <rect x="160" y="26" width="64" height="3" fill="#171a33" opacity="0.6" />
        {/* books */}
        <rect x="166" y="10" width="8" height="14" fill="#ff4d7a" />
        <rect x="176" y="12" width="8" height="12" fill="#3cffb7" />
        <rect x="186" y="11" width="8" height="13" fill="#ffd84d" />

        {/* desk */}
        <rect x="90" y="58" width="120" height="26" fill="#222a52" />
        <rect x="90" y="84" width="120" height="6" fill="#11152e" />
        {/* monitor */}
        <rect x="118" y="42" width="44" height="20" fill={blocked ? '#2a0b18' : '#0b2a3a'} stroke="#3a4aa0" strokeWidth="3" />
        <rect x="132" y="62" width="16" height="6" fill="#3a4aa0" />
        {/* monitor glow */}
        <rect x="121" y="45" width="38" height="14" fill={blocked ? '#ff4d7a' : props.tone === 'green' ? '#3cffb7' : props.tone === 'yellow' ? '#ffd84d' : '#8aa0ff'} opacity="0.35" />

        {/* chair */}
        <rect x="96" y="66" width="18" height="18" fill="#2a2f5e" />
        <rect x="96" y="58" width="18" height="8" fill="#3a4aa0" />

        {/* little plant */}
        <rect x="208" y="54" width="10" height="10" fill="#2a2f5e" />
        <rect x="211" y="46" width="4" height="8" fill="#3cffb7" opacity="0.8" />

        {/* status lamp */}
        <rect x="204" y="40" width="12" height="12" rx="2" ry="2" fill={props.tone === 'green' ? '#3cffb7' : props.tone === 'yellow' ? '#ffd84d' : '#ff4d7a'} />
        <rect x="206" y="42" width="8" height="8" fill="#ffffff" opacity="0.18" />

        {/* persona hint */}
        <text x="16" y="110" fontSize="10" fill="rgba(232,234,255,0.65)">{emojiForPersona(props.persona, props.personas)} room</text>
      </svg>
    </div>
  );
}

function DeskCard(props: {
  persona: string;
  lastSeenAt: string | null;
  personas?: Record<string, PersonaProfile>;
  current?: { ticket?: string; kind?: string; text?: string; ts?: string } | null;
}) {
  const tone = lampTone(props.lastSeenAt);
  const last = props.lastSeenAt ? `${minsAgo(props.lastSeenAt)}分前` : '—';
  const ticket = props.current?.ticket ?? '—';
  const kind = props.current?.kind ?? '—';
  const title = cutePersonaName(props.persona);

  const parsed = parseOfficeFormat(props.current?.text ?? '');
  const summary =
    parsed.blocked
      ? `詰まり：${parsed.blocked}`
      : parsed.next
        ? `次：${parsed.next}`
        : parsed.conclusion
          ? `結論：${parsed.conclusion}`
          : (props.current?.text ?? '').split(/\r?\n/).filter(Boolean)[0] ?? '';

  const jobLine = ticket !== '—' ? `${ticket}（${kind}）` : `（${kind}）`;

  return (
    <div className={`pixel-panel ${props.current?.kind === 'blocked' ? 'pixel-panel--alert' : ''}`}>
      <div className="grid gap-3">
        {/* Mini room with furniture (pixel-ish) */}
        <PixelRoomScene tone={tone} kind={kind} persona={props.persona} personas={props.personas} />

        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="pixel-avatar" aria-hidden>
              {emojiForPersona(props.persona, props.personas)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Lamp tone={tone} />
                <div className="pixel-title">
                  {emojiForPersona(props.persona, props.personas)} {title}
                </div>
              </div>
              <div className="pixel-sub">最終稼働：{last}</div>
            </div>
          </div>
          <div className="pixel-badge">{kind}</div>
        </div>

        <div className="pixel-inset">
          <div className="pixel-sub">いまやってること</div>
          <div className="mt-1 pixel-job">{jobLine}</div>
          <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-slate-100/90">{summary || '—'}</div>
        </div>
      </div>
    </div>
  );
}

function Whiteboard(props: { items: ActivityItem[]; personas?: Record<string, PersonaProfile> }) {
  const isAuto = (t: string) => t.startsWith('[auto-worker]') || t.startsWith('[auto-bridge]');
  const visible = props.items.filter((x) => !isAuto(String(x.text || '')));
  const blocked = visible.filter((x) => x.kind === 'blocked').slice(0, 5);
  const latest = visible.slice(0, 10);
  return (
    <div className="pixel-board">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="pixel-h2">ホワイトボード</div>
          <div className="pixel-sub">最新ログ（10秒ごとに更新）</div>
        </div>
        <div className="pixel-sub opacity-70">見やすさ優先（結論/次/詰まり）</div>
      </div>

      {blocked.length > 0 ? (
        <div className="mt-4 pixel-alert">
          <div className="pixel-h3">要判断（Blocked）</div>
          <div className="mt-2 space-y-2">
            {blocked.map((b) => (
              <div key={b.id} className="pixel-note pixel-note--blocked">
                <div className="pixel-note-meta">
                  {emojiForPersona(b.persona, props.personas)} {cutePersonaName(b.persona)} · {b.ticket ?? '—'} · {new Date(b.ts).toLocaleString('ja-JP')}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-slate-950">{b.text}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {latest.map((a) => (
          <div key={a.id} className="pixel-note">
            <div className="pixel-note-meta">
              {emojiForPersona(a.persona, props.personas)} {cutePersonaName(a.persona)} · {a.ticket ? a.ticket + ' · ' : ''}{new Date(a.ts).toLocaleString('ja-JP')} · {a.kind}
            </div>
            <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-slate-950">{a.text}</div>
          </div>
        ))}
        {latest.length === 0 ? <div className="pixel-sub opacity-70">まだログがありません。まずは指揮チャットでT#を作って投げて。</div> : null}
      </div>
    </div>
  );
}

export default function OfficePage() {
  const [presence, setPresence] = useState<Record<string, { lastSeenAt: string }>>({});
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [personas, setPersonas] = useState<PersonaProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [queue, setQueue] = useState<{ counts: Record<string, number>; overdue: number } | null>(null);
  const [running, setRunning] = useState<QueueTask[]>([]);

  const [focusTicket, setFocusTicket] = useState<string | null>(null);
  const [focusMessages, setFocusMessages] = useState<ThreadMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = async () => {
    try {
      const [p, a, t, pe, qs] = await Promise.all([getPresence(), getActivity(80), getThreads(80), getPersonas(), getQueueSummary()]);
      setPresence(p.presence);
      setActivity(a.items);
      setThreads(t.items);
      setPersonas(pe.items);
      setQueue({ counts: qs.counts ?? {}, overdue: qs.overdue ?? 0 });
      setError(null);

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

  const loadQueueRunning = async () => {
    try {
      const r = await getQueueRunning(20);
      setRunning(r.items ?? []);
    } catch {
      // best-effort
    }
  };

  useEffect(() => {
    load();
    loadQueueRunning();
    const id = window.setInterval(load, 10000);
    const qid = window.setInterval(loadQueueRunning, 3000);
    return () => {
      window.clearInterval(id);
      window.clearInterval(qid);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!focusTicket) return;
    window.localStorage.setItem('mc_focus_ticket', focusTicket);
    loadFocus(focusTicket);
    const id = window.setInterval(() => loadFocus(focusTicket).catch(() => void 0), 10000);
    return () => window.clearInterval(id);
  }, [focusTicket]);

  const personaMap = useMemo(() => {
    const map: Record<string, PersonaProfile> = {};
    for (const p of personas) map[p.key.toLowerCase()] = p;
    return map;
  }, [personas]);

  const personaKeys = useMemo(() => {
    // Source of truth: backend persona list (includes core team + known AI employees).
    const keys = personas.map((p) => p.key.toLowerCase()).filter(Boolean);

    // Safety net: even if API fails during remount/navigation, keep the office stable.
    const fallback = [
      'shiki',
      'tsumugi',
      'kensaku',
      'hajime',
      'suu',
      'kumi',
      'kotone',
      'kaname',
      'nozomi',
      'hiraku',
      'moru',
      'mjup',
    ];

    const merged = new Set<string>([...fallback, ...keys]);
    return Array.from(merged);
  }, [personas]);

  const approvals = useMemo<ApprovalCard[]>(() => {
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

    const lastAnswerAt = new Map<string, string>();
    for (const m of activity) {
      if (!m.ticket) continue;
      if (String(m.persona || '').toLowerCase() !== 'mjup') continue;
      const ts = m.ts;
      const cur = lastAnswerAt.get(m.ticket);
      if (!cur || ts > cur) lastAnswerAt.set(m.ticket, ts);
    }

    const byTicket = new Map<string, ApprovalCard>();
    for (const a of asked) {
      const cur = byTicket.get(a.ticket);
      if (!cur || a.askedAt > cur.askedAt) byTicket.set(a.ticket, a);
    }

    const pending: ApprovalCard[] = [];
    for (const a of byTicket.values()) {
      const ans = lastAnswerAt.get(a.ticket);
      if (ans && ans > a.askedAt) continue;
      pending.push(a);
    }

    pending.sort((x, y) => (x.askedAt < y.askedAt ? 1 : -1));
    return pending.slice(0, 3);
  }, [activity]);

  const focusSummary = useMemo(() => {
    const last = focusMessages[focusMessages.length - 1];
    const firstLine = last?.text?.split(/\r?\n/).find(Boolean) ?? '';
    return firstLine;
  }, [focusMessages]);

  async function answer(ticket: string, yes: boolean) {
    setSending(true);
    try {
      await postActivity({ persona: 'mjup', to: 'shiki', kind: 'info', ticket, text: yes ? '承認：Yes' : '承認：No' });
      await load();
      if (ticket === focusTicket) await loadFocus(ticket);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  async function sendFromOffice() {
    const text = draft.trim();
    if (!text) return;

    const explicit = extractExplicitTicket(text);
    const targetTicket = explicit ? explicit : startsNewTicket(text) ? makeNewTicket() : focusTicket ?? makeNewTicket();

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

  const currentByPersona = useMemo(() => {
    const map = new Map<string, { ticket?: string; kind?: string; text?: string; ts?: string }>();

    function isAuto(text?: string) {
      const t = String(text ?? '');
      return t.startsWith('[auto-worker]') || t.startsWith('[auto-bridge]');
    }

    // Prefer latest thread summary for "current work" if available (but skip auto noise)
    for (const t of threads) {
      const k = String(t.lastPersona || '').toLowerCase();
      if (!k) continue;
      if (isAuto(t.lastText)) continue;
      const cur = map.get(k);
      if (!cur || (t.lastTs && t.lastTs > (cur.ts ?? ''))) {
        map.set(k, { ticket: t.ticket, kind: t.lastKind, text: t.lastText, ts: t.lastTs });
      }
    }

    // Fallback to latest activity (skip auto noise)
    for (const a of activity) {
      const k = String(a.persona || '').toLowerCase();
      if (!k) continue;
      if (isAuto(a.text)) continue;
      if (!map.has(k)) map.set(k, { ticket: a.ticket, kind: a.kind, text: a.text, ts: a.ts });
    }

    return map;
  }, [threads, activity]);

  const cards = useMemo(() => {
    const list = personaKeys.map((p) => ({
      persona: p,
      lastSeenAt: presence[p]?.lastSeenAt ?? personaMap[p]?.lastSeenAt ?? null,
      current: currentByPersona.get(p) ?? null,
    }));

    list.sort((a, b) => {
      const at = a.lastSeenAt ?? a.current?.ts ?? '';
      const bt = b.lastSeenAt ?? b.current?.ts ?? '';
      return at < bt ? 1 : -1;
    });

    return list;
  }, [personaKeys, presence, currentByPersona, personaMap]);

  return (
    <div className="pixel-office space-y-5">
      <div>
        <h2 className="pixel-h1">オフィス</h2>
        <p className="pixel-sub">ピクセル箱庭：担当者＝どうぶつ / 夜のネオン / 10秒更新</p>
      </div>

      {error ? <div className="pixel-error">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="space-y-3">
          <div className="pixel-room">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="pixel-h3">デスク（担当者の今）</div>
              <div className="pixel-sub opacity-70">緑=15分以内 / 黄=60分以内 / 赤=停止</div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((c) => (
                <DeskCard key={c.persona} persona={c.persona} personas={personaMap} lastSeenAt={c.lastSeenAt} current={c.current} />
              ))}
              {activity.length === 0 ? (
                <div className="pixel-sub opacity-70">
                  まだ部屋が静か。指揮チャットでT#を作って投げて（家具のある部屋は先に出してある）。
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="pixel-room">
            <div className="flex items-center justify-between gap-2">
              <div className="pixel-h3">司令パネル</div>
              <div className="pixel-sub opacity-70">オフィス内で完結</div>
            </div>

            {/* Live Ops bar */}
            <div className="mt-3 pixel-inset">
              <div className="flex items-center justify-between gap-2">
                <div className="pixel-sub">実況（Queue / running）</div>
                <div className="pixel-sub opacity-70">
                  queued:{queue?.counts?.queued ?? 0} / running:{queue?.counts?.running ?? 0} / dlq:{queue?.counts?.dlq ?? 0}
                  {queue?.overdue ? ` / overdue:${queue.overdue}` : ''}
                </div>
              </div>
              <div className="mt-2 grid gap-2">
                {running.length ? (
                  running.slice(0, 4).map((t) => {
                    const p = t.payload ?? {};
                    const owner = String(p.to || p.owner || '—');
                    const ticket = p.ticket ? String(p.ticket) : '—';
                    const head = String(p.text || '').split(/\r?\n/).find(Boolean) ?? '';
                    return (
                      <div key={t.id} className="pixel-note">
                        <div className="pixel-note-meta">{ticket} · {owner} · {t.kind}</div>
                        <div className="mt-1 line-clamp-1 text-sm text-slate-950">{head || '実行中…'}</div>
                      </div>
                    );
                  })
                ) : (
                  <div className="pixel-sub opacity-70">いま実行中は無し。</div>
                )}
              </div>
            </div>

            <div className="mt-3 grid gap-3">
              <div className="pixel-inset">
                <div className="flex items-center justify-between gap-2">
                  <div className="pixel-sub">Focus</div>
                  <select
                    className="rounded-md border border-slate-300 bg-white/90 px-2 py-1 text-xs text-slate-900"
                    value={focusTicket ?? ''}
                    onChange={(e) => setFocusTicket(e.target.value || null)}
                  >
                    {threads.slice(0, 20).map((t) => (
                      <option key={t.ticket} value={t.ticket}>
                        {t.ticket}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-1 line-clamp-2 text-sm text-slate-100/90">{focusSummary || '—'}</div>
                <div className="mt-2 grid gap-2">
                  {focusMessages
                    .filter((m) => {
                      const t = String(m.text || '');
                      return !(t.startsWith('[auto-worker]') || t.startsWith('[auto-bridge]'));
                    })
                    .slice(-2)
                    .map((m) => (
                    <div key={m.id} className="pixel-note">
                      <div className="pixel-note-meta">
                        {emojiForPersona(m.persona, personaMap)} {cutePersonaName(m.persona)}{m.to ? ` → ${m.to}` : ''} · {m.kind}
                      </div>
                      <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-slate-950">{m.text}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pixel-inset">
                <div className="pixel-sub">承認待ち（Yes/No）</div>
                <div className="mt-2 grid gap-2">
                  {approvals.length ? (
                    approvals.map((a) => (
                      <div key={a.ticket} className="pixel-alert">
                        <div className="pixel-h3">{a.ticket}</div>
                        <div className="mt-1 text-sm text-slate-100/90">{a.question}</div>
                        <div className="mt-2 flex gap-2">
                          <button type="button" className="btn-primary px-3 py-2" disabled={sending} onClick={() => answer(a.ticket, true)}>
                            Yes
                          </button>
                          <button type="button" className="btn-secondary px-3 py-2" disabled={sending} onClick={() => answer(a.ticket, false)}>
                            No
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="pixel-sub opacity-70">承認待ちは無し。</div>
                  )}
                </div>
              </div>

              <div className="pixel-inset">
                <div className="pixel-sub">まーき入力（→ shiki）</div>
                <div className="mt-2 flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-slate-300 bg-white/90 px-3 py-2 text-sm text-slate-900"
                    placeholder="新規: / 別件: / T#123 ..."
                  />
                  <button type="button" className="btn-primary px-4 py-3" disabled={sending || !draft.trim()} onClick={sendFromOffice}>
                    {sending ? '送信中…' : '送信'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <Whiteboard items={activity} personas={personaMap} />
        </section>
      </div>
    </div>
  );
}
