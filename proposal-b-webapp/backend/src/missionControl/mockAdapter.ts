import type { MissionAccountDetail, MissionAccountSummary, MissionDataAdapter, MissionKpis } from './types';

function iso(date: Date) {
  return date.toISOString();
}

const mockAccounts: MissionAccountSummary[] = [
  {
    id: 'acme',
    name: 'Acme School',
    status: 'red',
    lastContactAt: iso(new Date(Date.now() - 9 * 24 * 60 * 60 * 1000)),
    todos: ['担当者に状況確認（未ログイン学習者が多い）', '来週の定例を設定'],
  },
  {
    id: 'beta',
    name: 'Beta Academy',
    status: 'yellow',
    lastContactAt: iso(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)),
    todos: ['今週の学習進捗をヒアリング', 'LINE文面（週次）を送付'],
  },
  {
    id: 'gamma',
    name: 'Gamma Training',
    status: 'green',
    lastContactAt: iso(new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)),
    todos: ['月次レポート送付'],
  },
];

const mockLearnersByAccount: Record<string, MissionAccountDetail> = {
  acme: {
    account: mockAccounts[0],
    learners: [
      {
        id: 'l-001',
        displayName: '山田 太郎',
        lastActivityAt: iso(new Date(Date.now() - 12 * 24 * 60 * 60 * 1000)),
        submissions30d: 0,
      },
      {
        id: 'l-002',
        displayName: '佐藤 花子',
        lastActivityAt: iso(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)),
        submissions30d: 1,
      },
    ],
  },
  beta: {
    account: mockAccounts[1],
    learners: [
      {
        id: 'l-003',
        displayName: '鈴木 一郎',
        lastActivityAt: iso(new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)),
        submissions30d: 2,
      },
      {
        id: 'l-004',
        displayName: '高橋 次郎',
        lastActivityAt: iso(new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)),
        submissions30d: 5,
      },
    ],
  },
  gamma: {
    account: mockAccounts[2],
    learners: [
      {
        id: 'l-005',
        displayName: '田中 美咲',
        lastActivityAt: iso(new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)),
        submissions30d: 6,
      },
      {
        id: 'l-006',
        displayName: '伊藤 翔',
        lastActivityAt: iso(new Date(Date.now() - 0.5 * 24 * 60 * 60 * 1000)),
        submissions30d: 4,
      },
    ],
  },
};

export class MockMissionAdapter implements MissionDataAdapter {
  async getKpis(): Promise<MissionKpis> {
    const totalAccounts = mockAccounts.length;
    const accountsRed = mockAccounts.filter((a) => a.status === 'red').length;
    const accountsYellow = mockAccounts.filter((a) => a.status === 'yellow').length;
    const accountsGreen = mockAccounts.filter((a) => a.status === 'green').length;

    const allLearners = Object.values(mockLearnersByAccount).flatMap((d) => d.learners);
    const inactiveLearners = allLearners.filter((l) => {
      if (!l.lastActivityAt) return true;
      const days = (Date.now() - new Date(l.lastActivityAt).getTime()) / (24 * 60 * 60 * 1000);
      return days >= 7;
    }).length;

    const submissionsCount = allLearners.reduce((sum, l) => sum + l.submissions30d, 0);

    return {
      totalAccounts,
      accountsRed,
      accountsYellow,
      accountsGreen,
      inactiveLearners,
      submissionsCount,
    };
  }

  async listAccounts(): Promise<MissionAccountSummary[]> {
    return mockAccounts;
  }

  async getAccountDetail(accountId: string): Promise<MissionAccountDetail | null> {
    return mockLearnersByAccount[accountId] ?? null;
  }
}
