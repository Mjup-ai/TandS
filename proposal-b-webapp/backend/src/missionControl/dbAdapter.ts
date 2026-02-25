import type { MissionDataAdapter, MissionKpis, MissionAccountSummary, MissionAccountDetail } from './types';

export class DbMissionAdapter implements MissionDataAdapter {
  async getKpis(): Promise<MissionKpis> {
    throw Object.assign(new Error('DB adapter not implemented yet'), { status: 501 });
  }
  async listAccounts(): Promise<MissionAccountSummary[]> {
    throw Object.assign(new Error('DB adapter not implemented yet'), { status: 501 });
  }
  async getAccountDetail(_accountId: string): Promise<MissionAccountDetail | null> {
    throw Object.assign(new Error('DB adapter not implemented yet'), { status: 501 });
  }
}
