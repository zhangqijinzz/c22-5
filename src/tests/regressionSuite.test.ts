import { describe, expect, it } from 'vitest';
import { rebaselineCase, recordRegressionCase, runRegressionSuite } from '../domain/regressionSuite';
import type { BusinessRule, RegressionCase, RuleField, RuleProject } from '../models/ruleModel';

const amount: RuleField = { id: 'amount', name: '金额', type: 'number', min: 0, max: 1000 };
const tier: RuleField = { id: 'tier', name: '等级', type: 'enum', enumValues: ['basic', 'gold'] };
const active: RuleField = { id: 'active', name: '启用', type: 'boolean' };

function makeRule(id: string, fieldId: string, value: string | number | boolean, operator: 'gte' | 'eq' | 'isTrue' = 'gte'): BusinessRule {
  const condition = operator === 'gte'
    ? { kind: 'predicate' as const, fieldId, operator: 'gte' as const, value: value as number }
    : operator === 'isTrue'
      ? { kind: 'predicate' as const, fieldId, operator: 'isTrue' as const, value: true }
      : { kind: 'predicate' as const, fieldId, operator: 'eq' as const, value: value as string };
  return { id, name: id, priority: 10, result: id, conditions: { kind: 'group', operator: 'and', conditions: [condition] } };
}

function project(rules: BusinessRule[], regressionCases: RegressionCase[] = [], fields: RuleField[] = [amount, tier, active]): RuleProject {
  return { id: 'p', title: '测试项目', fields, rules, sampleInputs: {}, regressionCases, versions: [], updatedAt: 1 };
}

function caseRecord(partial: Partial<RegressionCase> & Pick<RegressionCase, 'input'>): RegressionCase {
  return {
    id: partial.id ?? 'case-1',
    name: partial.name ?? '用例',
    fieldIds: partial.fieldIds ?? ['amount', 'tier', 'active'],
    input: partial.input,
    expectValid: partial.expectValid ?? true,
    expectedRules: partial.expectedRules ?? [],
    createdAt: partial.createdAt ?? 1,
  };
}

describe('runRegressionSuite', () => {
  it('marks identical matches as consistent and surfaces the entered/exited rules when matches change', () => {
    const rules = [makeRule('gold-min', 'amount', 500), makeRule('active-rule', 'active', true, 'isTrue')];
    const golden = caseRecord({
      id: 'c-stable',
      expectedRules: [{ id: 'gold-min', name: 'gold-min' }, { id: 'active-rule', name: 'active-rule' }],
      input: { amount: 800, tier: 'gold', active: true },
    });
    // 录入时只有 gold-min 命中，后来 active-rule 新进来命中
    const drift = caseRecord({
      id: 'c-drift',
      expectedRules: [{ id: 'gold-min', name: 'gold-min' }],
      input: { amount: 800, tier: 'basic', active: true },
    });
    const report = runRegressionSuite(project(rules, [golden, drift]));
    expect(report.results[0].status).toBe('consistent');
    expect(report.results[1].status).toBe('changed');
    expect(report.results[1].enteredRules.map((rule) => rule.id)).toEqual(['active-rule']);
    expect(report.results[1].exitedRules).toEqual([]);
  });

  it('flags cases that lost every match as no-match, distinct from rule-set changes', () => {
    const rules = [makeRule('gold-min', 'amount', 500)];
    const usedToMatch = caseRecord({
      expectedRules: [{ id: 'gold-min', name: 'gold-min' }],
      input: { amount: 200, tier: 'basic', active: false },
    });
    const stillUncovered = caseRecord({
      id: 'case-2',
      expectedRules: [],
      input: { amount: 200, tier: 'basic', active: false },
    });
    const report = runRegressionSuite(project(rules, [usedToMatch, stillUncovered]));
    expect(report.results[0].status).toBe('no-match');
    expect(report.results[0].exitedRules.map((rule) => rule.id)).toEqual(['gold-min']);
    expect(report.results[1].status).toBe('consistent');
  });

  it('keeps deliberately invalid inputs in their own bucket and reports validity flips', () => {
    const rules = [makeRule('gold-min', 'amount', 500)];
    const missingTier = caseRecord({
      id: 'c-invalid',
      expectValid: false,
      input: { amount: 800, tier: '', active: false },
    });
    const fixedInput = caseRecord({
      id: 'c-became-valid',
      expectValid: false,
      expectedRules: [],
      input: { amount: 800, tier: 'gold', active: false },
    });
    const report = runRegressionSuite(project(rules, [missingTier, fixedInput]));
    expect(report.results[0].status).toBe('invalid-consistent');
    expect(report.results[0].actualRules).toEqual([]);
    expect(report.results[1].status).toBe('invalid-changed');
    expect(report.results[1].actualRules.map((rule) => rule.id)).toEqual(['gold-min']);
    // 非法输入分组独立统计，不混入规则变化计数
    expect(report.invalidConsistent).toBe(1);
    expect(report.changed).toBe(0);
  });

  it('reports stale cases with clear hints when fields are removed, added without values, or values leave range', () => {
    const rules = [makeRule('gold-min', 'amount', 500)];
    const removedFieldCase = caseRecord({
      id: 'c-removed',
      input: { amount: 800, tier: 'gold', active: false },
      expectedRules: [{ id: 'gold-min', name: 'gold-min' }],
    });
    const projectAfterRemoval = project(rules, [removedFieldCase], [amount, tier]);
    const removedReport = runRegressionSuite(projectAfterRemoval);
    expect(removedReport.results[0].status).toBe('stale');
    expect(removedReport.results[0].structuralIssues[0].message).toContain('已从字段定义中删除');

    const newField: RuleField = { id: 'new-field', name: '渠道', type: 'boolean' };
    const missingNewValue = caseRecord({ input: { amount: 800, tier: 'gold', active: false }, expectedRules: [{ id: 'gold-min', name: 'gold-min' }] });
    const addedReport = runRegressionSuite(project(rules, [missingNewValue], [amount, tier, active, newField]));
    expect(addedReport.results[0].status).toBe('stale');
    expect(addedReport.results[0].structuralIssues[0].message).toContain('在用例保存之后新增');

    const narrowed = { ...amount, max: 500 };
    const outOfRange = caseRecord({ input: { amount: 800, tier: 'gold', active: false }, expectedRules: [{ id: 'gold-min', name: 'gold-min' }] });
    const rangeReport = runRegressionSuite(project(rules, [outOfRange], [narrowed, tier, active]));
    expect(rangeReport.results[0].status).toBe('stale');
    expect(rangeReport.results[0].structuralIssues[0].message).toContain('超出当前范围');
    // 待维护用例不能算作规则变化，也不能算作非法输入
    expect(rangeReport.changed).toBe(0);
    expect(rangeReport.invalidConsistent + rangeReport.invalidChanged).toBe(0);
  });

  it('detects enum option removal as drift and falls back to the recorded rule name snapshot when a rule is deleted', () => {
    const rules = [makeRule('gold-min', 'amount', 500)];
    const retargetedTier: RuleField = { id: 'tier', name: '等级', type: 'enum', enumValues: ['basic', 'platinum'] };
    const oldEnumValue = caseRecord({
      input: { amount: 800, tier: 'gold', active: false },
      expectedRules: [{ id: 'deleted-rule', name: '旧规则名称快照' }],
    });
    const enumReport = runRegressionSuite(project(rules, [oldEnumValue], [amount, retargetedTier, active]));
    expect(enumReport.results[0].status).toBe('stale');
    expect(enumReport.results[0].structuralIssues[0].message).toContain('已不在枚举选项中');

    const ruleDeletedCase = caseRecord({
      input: { amount: 200, tier: 'basic', active: false },
      expectedRules: [{ id: 'deleted-rule', name: '旧规则名称快照' }],
    });
    const deletedReport = runRegressionSuite(project(rules, [ruleDeletedCase]));
    expect(deletedReport.results[0].status).toBe('no-match');
    expect(deletedReport.results[0].exitedRules[0]).toEqual({ id: 'deleted-rule', name: '旧规则名称快照' });
  });

  it('records a case from current matches and rebaseline adopts the new reality', () => {
    const rules = [makeRule('gold-min', 'amount', 500)];
    const base = project(rules);
    const recorded = recordRegressionCase(base, '', { amount: 800, tier: 'gold', active: false }, true);
    expect(recorded.case.expectedRules.map((rule) => rule.id)).toEqual(['gold-min']);
    expect(recorded.inputErrors).toEqual([]);

    // 规则阈值放宽，原本不命中的输入也命中了
    const relaxedRules = [makeRule('gold-min', 'amount', 100)];
    const withCase = { ...project(relaxedRules), regressionCases: [{ ...recorded.case, expectedRules: [] }] };
    const firstRun = runRegressionSuite(withCase);
    expect(firstRun.results[0].status).toBe('changed');
    const rebasedCase = rebaselineCase(withCase, recorded.case.id);
    expect(rebasedCase?.expectedRules.map((rule) => rule.id)).toEqual(['gold-min']);
    const adopted = { ...withCase, regressionCases: [rebasedCase as RegressionCase], updatedAt: 2 };
    const secondRun = runRegressionSuite(adopted);
    expect(secondRun.results[0].status).toBe('consistent');
  });

  it('treats priority/order changes as changed even when the rule set is identical', () => {
    const rules = [
      { ...makeRule('a', 'amount', 500), priority: 20 },
      { ...makeRule('b', 'active', true, 'isTrue'), priority: 10 },
    ];
    const reordered = caseRecord({
      expectedRules: [{ id: 'b', name: 'b' }, { id: 'a', name: 'a' }],
      input: { amount: 800, tier: 'gold', active: true },
    });
    const report = runRegressionSuite(project(rules, [reordered]));
    expect(report.results[0].status).toBe('changed');
    expect(report.results[0].actualRules.map((rule) => rule.id)).toEqual(['a', 'b']);
  });
});
