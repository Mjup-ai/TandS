import type { MissionDataAdapter } from './types';
import { getDataMode } from './config';
import { MockMissionAdapter } from './mockAdapter';
import { CsvMissionAdapter } from './csvAdapter';
import { DbMissionAdapter } from './dbAdapter';

export function createMissionAdapter(): MissionDataAdapter {
  const mode = getDataMode();
  if (mode === 'csv') return new CsvMissionAdapter();
  if (mode === 'db') return new DbMissionAdapter();
  return new MockMissionAdapter();
}
