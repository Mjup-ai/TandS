import { useEffect, useState } from 'react';
import { APP_NAME } from './config';
import { authLogin, authLogout, authMe } from './lib/api';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import DashboardPage from './pages/DashboardPage';
import AccountsPage from './pages/AccountsPage';
import AccountDetailPage from './pages/AccountDetailPage';
import ChatPage from './pages/ChatPage';
import OfficePage from './pages/OfficePage';

type View = 'home' | 'dashboard' | 'office' | 'accounts' | 'accountDetail' | 'chat';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [view, setView] = useState<View>('office');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  useEffect(() => {
    authMe()
      .then((d) => {
        setAuthenticated(Boolean(d.authenticated));
        setLoading(false);
      })
      .catch(() => {
        setAuthenticated(false);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="min-h-screen bg-slate-50" />;
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white shadow-card">
          <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
            <h1 className="text-lg font-bold text-slate-800 sm:text-xl">{APP_NAME}</h1>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <LoginPage
            error={loginError}
            onLogin={async (password) => {
              setLoginError(null);
              try {
                await authLogin(password);
                setAuthenticated(true);
              } catch (e) {
                setLoginError('Login failed');
              }
            }}
          />
        </main>
      </div>
    );
  }

  const nav = [
    { id: 'office' as const, label: 'オフィス' },
    { id: 'home' as const, label: '司令室' },
    { id: 'dashboard' as const, label: 'ダッシュボード' },
    { id: 'chat' as const, label: '指揮チャット' },
    { id: 'accounts' as const, label: 'アカウント' },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white shadow-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-lg font-bold text-slate-800 sm:text-xl">{APP_NAME}</h1>
            <nav className="mt-3 flex flex-wrap items-center gap-0.5" aria-label="Main">
              {nav.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setView(id);
                    setSelectedAccountId(null);
                  }}
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

          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            onClick={async () => {
              await authLogout();
              setAuthenticated(false);
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6" role="main">
        {view === 'home' && <HomePage />}
        {view === 'office' && <OfficePage />}
        {view === 'dashboard' && <DashboardPage />}
        {view === 'chat' && <ChatPage />}
        {view === 'accounts' && (
          <AccountsPage
            onOpenAccount={(accountId) => {
              setSelectedAccountId(accountId);
              setView('accountDetail');
            }}
          />
        )}
        {view === 'accountDetail' && selectedAccountId ? (
          <AccountDetailPage
            accountId={selectedAccountId}
            onBack={() => {
              setView('accounts');
              setSelectedAccountId(null);
            }}
          />
        ) : null}
      </main>
    </div>
  );
}
