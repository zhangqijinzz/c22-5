import { describe, expect, it } from 'vitest';
import { RuleRepository } from '../repositories/ruleRepository';

class StaticStorage {
  constructor(private readonly document: unknown) {}
  async read(): Promise<unknown> { return this.document; }
  readFallback(): unknown { return null; }
  async write(): Promise<void> { /* static fixture */ }
}

describe('RuleRepository legacy persistence', () => {
  it('restores an old workspace without regression data and keeps new cases round-tripping', async () => {
    const legacyDocument = {
      schemaVersion: 1,
      activeProjectId: 'p1',
      projects: [{
        id: 'p1',
        title: '旧项目',
        updatedAt: 123,
        fields: [{ id: 'amount', name: '金额', type: 'number', min: 0, max: 1000 }],
        rules: [],
        sampleInputs: {},
        versions: [{
          id: 'v1', name: '旧快照', savedAt: 100, frozen: false,
          fields: [{ id: 'amount', name: '金额', type: 'number', min: 0, max: 1000 }],
          rules: [],
          sampleInputs: {},
        }],
      }],
    };
    const restored = await new RuleRepository(new StaticStorage(legacyDocument) as never).load();
    expect(restored?.projects[0].regressionCases).toEqual([]);
    expect(restored?.projects[0].versions[0].regressionCases).toEqual([]);

    const withCases: typeof legacyDocument = structuredClone(legacyDocument);
    Object.assign(withCases.projects[0], {
      regressionCases: [{
        id: 'case-1', name: '用例', fieldIds: ['amount'], input: { amount: 12 },
        expectValid: true, expectedRules: [], createdAt: 9,
      }],
    });
    const roundTrip = await new RuleRepository(new StaticStorage(withCases) as never).load();
    expect(roundTrip?.projects[0].regressionCases[0].id).toBe('case-1');

    // 结构损坏的单条用例被跳过，不影响整个工作区恢复
    const corrupted = structuredClone(withCases) as unknown as { projects: Record<string, unknown>[] };
    corrupted.projects[0].regressionCases = [
      (withCases.projects[0] as unknown as { regressionCases: unknown[] }).regressionCases[0],
      { id: 'broken' },
    ];
    const tolerant = await new RuleRepository(new StaticStorage(corrupted) as never).load();
    expect(tolerant?.projects[0].regressionCases).toHaveLength(1);
  });
});
