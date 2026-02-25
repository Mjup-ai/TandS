import { useState } from 'react';

export default function LoginPage(props: { onLogin: (password: string) => Promise<void>; error?: string | null }) {
  const [password, setPassword] = useState('');

  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-card">
      <h2 className="text-lg font-bold text-slate-900">Login</h2>
      <p className="mt-1 text-sm text-slate-600">Mission Control にアクセスするにはパスワードが必要です。</p>

      <div className="mt-4">
        <label className="block text-sm font-medium text-slate-700">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
          placeholder="MISSION_CONTROL_PASSWORD"
        />
      </div>

      {props.error ? <div className="mt-3 text-sm text-red-700">{props.error}</div> : null}

      <button
        type="button"
        onClick={() => props.onLogin(password)}
        className="mt-4 w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
      >
        Login
      </button>
    </div>
  );
}
