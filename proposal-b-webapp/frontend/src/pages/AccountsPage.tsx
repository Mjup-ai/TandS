import { useEffect, useState } from 'react';
import type { MissionAccountSummary } from '../types';
import { listAccounts } from '../lib/api';

function StatusBadge(props: { status: MissionAccountSummary['status'] }) {
  const cls =
    props.status === 'red'
      ? 'bg-red-100 text-red-800'
      : props.status === 'yellow'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-emerald-100 text-emerald-800';
  return <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${cls}`}>{props.status}</span>;
}

function fmtDate(s: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

export default function AccountsPage(props: { onOpenAccount: (accountId: string) => void }) {
  const [items, setItems] = useState<MissionAccountSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAccounts()
      .then((d) => {
        setItems(d.items);
        setError(null);
      })
      .catch((e) => {
        setError(String(e));
      });
  }, []);

  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>;
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-slate-900">Accounts</h2>

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-3">Tenant</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last contact</th>
              <th className="px-4 py-3">Todos</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <button className="font-semibold text-primary-700 hover:underline" onClick={() => props.onOpenAccount(a.id)}>
                    {a.name}
                  </button>
                  <div className="text-xs text-slate-500">{a.id}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={a.status} />
                </td>
                <td className="px-4 py-3 text-slate-700">{fmtDate(a.lastContactAt)}</td>
                <td className="px-4 py-3 text-slate-700">
                  <ul className="list-disc pl-4">
                    {a.todos.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={4}>
                  No accounts.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
