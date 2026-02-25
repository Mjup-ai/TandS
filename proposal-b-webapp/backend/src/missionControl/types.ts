export type HealthColor = 'red' | 'yellow' | 'green';

export interface MissionKpis {
  totalAccounts: number;
  accountsRed: number;
  accountsYellow: number;
  accountsGreen: number;
  inactiveLearners: number;
  submissionsCount: number;
}

export interface MissionAccountSummary {
  id: string;
  name: string;
  status: HealthColor;
  lastContactAt: string | null; // ISO date
  todos: string[];
}

export interface MissionLearner {
  id: string;
  displayName: string;
  lastActivityAt: string | null; // ISO date
  submissions30d: number;
}

export interface MissionAccountDetail {
  account: MissionAccountSummary;
  learners: MissionLearner[];
}

export interface MissionDataAdapter {
  getKpis(): Promise<MissionKpis>;
  listAccounts(): Promise<MissionAccountSummary[]>;
  getAccountDetail(accountId: string): Promise<MissionAccountDetail | null>;
}
