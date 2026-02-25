export const APP_NAME = 'Mission Control';

export const DISCORD_PERSONAS: Array<{ key: string; label: string }> = [
  { key: 'moru', label: 'もる' },
  { key: 'shiki', label: 'シキ' },
  { key: 'tsumugi', label: 'ツムギ' },
  { key: 'kensaku', label: 'ケンサク' },
  { key: 'hajime', label: 'ハジメ' },
  { key: 'suu', label: 'スウ' },
  { key: 'kumi', label: 'クミ' },
  { key: 'kotone', label: 'コトネ' },
  { key: 'hiraku', label: 'ヒラク' },
] as const;

export const LINE_TEMPLATES = {
  weekly: {
    title: '週次フォロー',
    build: (params: {
      accountName: string;
      inactiveLearners: string[];
      totalSubmissions30d: number;
    }) => {
      const inactiveBlock =
        params.inactiveLearners.length > 0
          ? `・直近7日間で活動がない方: ${params.inactiveLearners.join('、')}`
          : '・直近7日間で活動がない方: なし';

      return [
        `${params.accountName} ご担当者さま`,
        '',
        '今週の学習状況の共有です。',
        inactiveBlock,
        `・直近30日間の提出数合計: ${params.totalSubmissions30d}`,
        '',
        '気になる点やフォロー方針があれば、このLINEに返信ください。',
      ].join('\n');
    },
  },
  monthly: {
    title: '月次レポート',
    build: (params: {
      accountName: string;
      learnersCount: number;
      inactiveLearnersCount: number;
      totalSubmissions30d: number;
    }) => {
      return [
        `${params.accountName} ご担当者さま`,
        '',
        '月次レポート（直近30日）です。',
        `・学習者数: ${params.learnersCount}`,
        `・直近7日活動なし: ${params.inactiveLearnersCount}`,
        `・提出数合計: ${params.totalSubmissions30d}`,
        '',
        '必要に応じて、次月の目標設定・個別フォローをご提案します。',
      ].join('\n');
    },
  },
} as const;
