import { useEffect, useState } from 'react';
import LoadingBlock from '../components/LoadingBlock';

interface Config {
  scoreThreshold: number;
}

export default function ConfigPage() {
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  if (!config) {
    return <LoadingBlock />;
  }

  return (
    <div className="card p-6">
      <h2 className="section-title">設定</h2>
      <dl className="mt-4 space-y-4">
        <div>
          <dt className="text-sm font-medium text-slate-500">推薦閾値（スコア）</dt>
          <dd className="mt-1 text-slate-800">{config.scoreThreshold} 点以上を推薦とする</dd>
        </div>
      </dl>
      <p className="mt-5 text-xs text-slate-500">閾値の変更はサーバー側の設定で行います。</p>
    </div>
  );
}
