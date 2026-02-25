import { useEffect, useMemo, useState } from 'react';
import { getThreadMessages, getThreads, postActivity, type ThreadMessage, type ThreadSummary } from '../lib/api';

function KindBadge(props: { kind: string }) {
  const cls =
    props.kind === 'blocked'
      ? 'bg-red-100 text-red-800 ring-red-200'
      : props.kind === 'done'
        ? 'bg-emerald-100 text-emerald-800 ring-emerald-200'
        : props.kind === 'doing'
          ? 'bg-amber-100 text-amber-800 ring-amber-200'
          : 'bg-slate-100 text-slate-700 ring-slate-200';
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${cls}`}>{props.kind}</span>;
}

function parseOfficeFormat(text: string) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: { header?: string; conclusion?: string; done?: string; next?: string; blocked?: string; question?: string; rest?: string } = {};
  if (lines.length === 0) return out;

  out.header = lines[0];
  for (const l of lines.slice(1)) {
    if (l.startsWith('結論：')) out.conclusion = l.replace(/^結論：\s*/, '');
    else if (l.startsWith('Done：')) out.done = l.replace(/^Done：\s*/, '');
    else if (l.startsWith('Next：')) out.next = l.replace(/^Next：\s*/, '');
    else if (l.startsWith('Blocked：')) out.blocked = l.replace(/^Blocked：\s*/, '');
    else if (l.startsWith('質問：')) out.question = l.replace(/^質問：\s*/, '');
    else out.rest = (out.rest ? out.rest + '\n' : '') + l;
  }
  return out;
}

function Bubble(props: { me: boolean; msg: ThreadMessage }) {
  const base = props.me
    ? 'ml-auto bg-primary-600 text-white'
    : 'mr-auto bg-white text-slate-900 border border-slate-200';

  const parsed = parseOfficeFormat(props.msg.text);
  const isStructured = Boolean(parsed.conclusion || parsed.done || parsed.next || parsed.blocked || parsed.question);

  return (
    <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-card ${base}`}>
      <div className={`flex items-center justify-between gap-2 text-[11px] font-semibold ${props.me ? 'text-primary-50/90' : 'text-slate-500'}`}>
        <div>
          {props.msg.persona}
          {props.msg.to ? ` → ${props.msg.to}` : ''} · {new Date(props.msg.ts).toLocaleString('ja-JP')}
        </div>
        <div className={props.me ? 'text-primary-50/80' : 'text-slate-400'}>{props.msg.kind}</div>
      </div>

      {isStructured ? (
        <div className="mt-2 space-y-1.5">
          {parsed.header ? <div className={`text-xs ${props.me ? 'text-primary-50/90' : 'text-slate-600'}`}>{parsed.header}</div> : null}
          {parsed.conclusion ? <div className="whitespace-pre-wrap leading-relaxed"><span className="font-semibold">結論：</span>{parsed.conclusion}</div> : null}
          {parsed.done ? <div className="whitespace-pre-wrap leading-relaxed"><span className="font-semibold">Done：</span>{parsed.done}</div> : null}
          {parsed.next ? <div className="whitespace-pre-wrap leading-relaxed"><span className="font-semibold">Next：</span>{parsed.next}</div> : null}
          {parsed.blocked ? <div className="whitespace-pre-wrap leading-relaxed"><span className="font-semibold">Blocked：</span>{parsed.blocked}</div> : null}
          {parsed.question ? <div className="whitespace-pre-wrap leading-relaxed"><span className="font-semibold">質問：</span>{parsed.question}</div> : null}
          {parsed.rest ? <div className={`whitespace-pre-wrap leading-relaxed ${props.me ? 'text-primary-50/80' : 'text-slate-600'}`}>{parsed.rest}</div> : null}
        </div>
      ) : (
        <div className="mt-1 whitespace-pre-wrap leading-relaxed">{props.msg.text}</div>
      )}
    </div>
  );
}

export default function ChatPage() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null);
  const [newTicket, setNewTicket] = useState('');
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [persona, setPersona] = useState('shiki');
  const [to, setTo] = useState('shiki');
  const [kind, setKind] = useState<'info' | 'doing' | 'done' | 'blocked'>('info');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadThreads = async () => {
    const d = await getThreads(100);
    setThreads(d.items);
    if (!selectedTicket && d.items[0]) setSelectedTicket(d.items[0].ticket);
    // Auto-suggest a new ticket when none exist
    if (d.items.length === 0 && !newTicket) {
      const n = Math.floor(Math.random() * 900 + 100);
      setNewTicket(`T#${n}`);
    }
  };

  const loadMessages = async (ticket: string) => {
    const d = await getThreadMessages(ticket, 150);
    setMessages(d.items);
  };

  const load = async () => {
    try {
      setError(null);
      await loadThreads();
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    load();
    const t = window.setInterval(load, 10000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedTicket) return;
    loadMessages(selectedTicket).catch((e) => setError(String(e)));
    const t = window.setInterval(() => {
      loadMessages(selectedTicket).catch(() => void 0);
    }, 10000);
    return () => window.clearInterval(t);
  }, [selectedTicket]);

  const selected = useMemo(() => threads.find((t) => t.ticket === selectedTicket) ?? null, [threads, selectedTicket]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">指揮チャット</h2>
        <p className="mt-0.5 text-sm text-slate-500">T#ごとに、指揮系統のやりとりをチャット表示（10秒更新）</p>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}

      <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
        <section className="card p-0 overflow-hidden">
          <div className="border-b border-slate-200 bg-white px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">スレッド</div>
            <div className="text-xs text-slate-500">最新順</div>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            {threads.map((t) => (
              <button
                key={t.ticket}
                type="button"
                onClick={() => setSelectedTicket(t.ticket)}
                className={`w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                  selectedTicket === t.ticket ? 'bg-primary-50' : 'bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-slate-900">{t.ticket}</div>
                  <KindBadge kind={t.lastKind} />
                </div>
                <div className="mt-1 line-clamp-2 text-sm text-slate-700">{t.lastText}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {t.lastPersona} · {new Date(t.lastTs).toLocaleString('ja-JP')} · {t.messages} msgs
                </div>
              </button>
            ))}
            {threads.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">
                まだスレッドがありません。<br />
                ticket（例：T#123）付きで投稿すると、ここにまとまります。
              </div>
            ) : null}
          </div>
        </section>

        <section className="card p-0 overflow-hidden">
          <div className="border-b border-slate-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">{selected?.ticket ?? '—'}</div>
                <div className="text-xs text-slate-500">{selected ? `${selected.lastPersona} · ${new Date(selected.lastTs).toLocaleString('ja-JP')}` : ''}</div>
              </div>
              {selected ? <KindBadge kind={selected.lastKind} /> : null}
            </div>
          </div>

          <div className="flex max-h-[62vh] flex-col gap-2 overflow-auto bg-slate-50 px-4 py-4">
            {messages.map((m) => {
              const me = (m.persona || '').toLowerCase() === 'shiki';
              return <Bubble key={m.id} me={me} msg={m} />;
            })}
            {messages.length === 0 ? <div className="text-sm text-slate-500">まだ投稿がありません。</div> : null}
          </div>

          <div className="border-t border-slate-200 bg-white px-4 py-3">
            <div className="text-xs text-slate-500">投稿（ここが正本。#officeには自動ミラー予定）</div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="text-xs font-semibold text-slate-600">送信者</label>
              <select
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
              >
                {['mjup', 'shiki', 'kumi', 'tsumugi', 'hiraku', 'suu', 'kotone'].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>

              <label className="ml-2 text-xs font-semibold text-slate-600">宛先</label>
              <select
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
              >
                {['shiki', 'kumi', 'tsumugi', 'hiraku', 'suu', 'kotone'].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>

              <label className="ml-2 text-xs font-semibold text-slate-600">状態</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as any)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
              >
                {['info', 'doing', 'done', 'blocked'].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>

              {selectedTicket ? (
                <span className="ml-auto text-xs text-slate-500">ticket: {selectedTicket}</span>
              ) : (
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-slate-500">ticket:</span>
                  <input
                    value={newTicket}
                    onChange={(e) => setNewTicket(e.target.value)}
                    placeholder="T#123"
                    className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
                  />
                </div>
              )}
            </div>

            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary-500"
              rows={3}
              placeholder={`例：\nT#123 / Doing / kumi\n結論：…\nDone：…\nNext：…\nBlocked：…\n質問：Yes/No`}
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={sending || !draft.trim() || (!selectedTicket && !newTicket.trim())}
                className="btn-primary px-3 py-2 text-sm"
                onClick={async () => {
                  const ticket = selectedTicket ?? newTicket.trim();
                  if (!ticket) return;
                  if (!draft.trim()) return;
                  setSending(true);
                  try {
                    await postActivity({ persona, to, kind, ticket, text: draft });
                    setDraft('');
                    setSelectedTicket(ticket);
                    await loadMessages(ticket);
                    await loadThreads();
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setSending(false);
                  }
                }}
              >
                {sending ? '送信中…' : selectedTicket ? '送信' : '送信（新規スレッド作成）'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
