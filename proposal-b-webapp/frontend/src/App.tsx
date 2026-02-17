import { useEffect, useState } from 'react';
import InboxPage from './pages/InboxPage';
import ProjectsPage from './pages/ProjectsPage';
import TalentsPage from './pages/TalentsPage';
import MatchPage from './pages/MatchPage';
import ConfigPage from './pages/ConfigPage';

type Tab = 'inbox' | 'projects' | 'talents' | 'match' | 'config';

interface Stats {
  rawEmails: number;
  projectOffers: number;
  talentOffers: number;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('inbox');
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then((d) => setStats(d))
      .catch(() => setStats(null));
  }, [tab]);

  const nav = [
    { id: 'inbox' as Tab, label: '受信', count: stats?.rawEmails },
    { id: 'projects' as Tab, label: '案件', count: stats?.projectOffers },
    { id: 'talents' as Tab, label: '人材', count: stats?.talentOffers },
    { id: 'match' as Tab, label: 'マッチ' },
    { id: 'config' as Tab, label: '設定' },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white shadow-card">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
          <h1 className="text-lg font-bold text-slate-800 sm:text-xl">SES マッチング</h1>
          <nav className="mt-3 flex flex-wrap items-center gap-0.5" role="tablist" aria-label="メイン">
            {nav.map(({ id, label, count }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                  tab === id
                    ? 'bg-primary-100 text-primary-800 ring-1 ring-primary-200'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                }`}
              >
                {label}
                {count !== undefined && count !== null && (
                  <span
                    className={`ml-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium ${
                      tab === id ? 'bg-primary-200/80 text-primary-900' : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6" role="main">
        {tab === 'inbox' && <InboxPage />}
        {tab === 'projects' && <ProjectsPage />}
        {tab === 'talents' && <TalentsPage />}
        {tab === 'match' && <MatchPage />}
        {tab === 'config' && <ConfigPage />}
      </main>
    </div>
  );
}
