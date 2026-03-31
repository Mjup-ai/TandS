import { useState } from 'react';
import { APP_NAME } from './config';
import InboxPage from './pages/InboxPage';
import ProjectsPage from './pages/ProjectsPage';
import TalentsPage from './pages/TalentsPage';
import MatchPage from './pages/MatchPage';
import ConfigPage from './pages/ConfigPage';

type View = 'inbox' | 'projects' | 'talents' | 'matches' | 'config';

export default function App() {
  const [view, setView] = useState<View>('inbox');

  const nav = [
    { id: 'inbox' as const, label: '受信一覧' },
    { id: 'projects' as const, label: '案件' },
    { id: 'talents' as const, label: '人材' },
    { id: 'matches' as const, label: 'マッチ' },
    { id: 'config' as const, label: '設定' },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white shadow-card">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <h1 className="text-lg font-bold text-slate-800 sm:text-xl">{APP_NAME}</h1>
          <nav className="mt-3 flex flex-wrap items-center gap-0.5" aria-label="Main">
            {nav.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                  view === id
                    ? 'bg-primary-100 text-primary-800 ring-1 ring-primary-200'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6" role="main">
        {view === 'inbox' && <InboxPage />}
        {view === 'projects' && <ProjectsPage />}
        {view === 'talents' && <TalentsPage />}
        {view === 'matches' && <MatchPage />}
        {view === 'config' && <ConfigPage />}
      </main>
    </div>
  );
}
