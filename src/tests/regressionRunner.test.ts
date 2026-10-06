import { describe, expect, it } from 'vitest';
import { matchedRulesForInput, runRegressionCase, runRegressionSuite, validateRegressionInput } from '../domain/regressionRunner';
import type { BusinessRule, RegressionCase, RuleField, RuleProject } from '../models/ruleModel';

const amount: RuleField = { id: 'amount', name: '金额', type: 'number', min: 0, max: 1000 };
const tier: RuleField = { id: 'tier', name: '等级', type: 'enum', enumValues: ['basic', 'gold'] };
const active: RuleField = { id: 'active', name: '启用', type: 'boolean' };

function makeRule(id: string, conditions: BusinessRule['conditions'], priority = 10): BusinessRule {
  return { id, name: id, conditions, priority, result: id };
}

function project(rules: BusinessRule[], regressionCases: RegressionCase[] = [], fields: RuleField[] = [amount, tier, active]): RuleProject {
  return { id: 'p', title: '测试项目', fields, rules, sampleInputs: {}, regressionCases, versions: [], updatedAt: 1 };
}

const gte = (fieldId: string, value: number): BusinessRule['conditions'] => ({ kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId, operator: 'gte', value }] });
const goldTier = (): BusinessRule['conditions'] => ({ kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'tier', operator: 'eq', value: 'gold' }] });
const input = (overrides: Record<string, unknown> = {}) => ({ amount: 600, tier: 'gold', active: true, ...overrides }) as RegressionCase['input'];
const testCase = (id: string, expectedRuleIds: string[], overrides: Record<string, unknown> = {}): RegressionCase => ({ id, name: id, createdAt: 1, input: input(overrides), expectedRuleIds });

describe('regression input validation', () => {
  it('accepts a fully valid input', () => {
    expect(validateRegressionInput([amount, tier, active], input())).toEqual([]);
  });

  it('flags missing values after a field was added', () => {
    const issues = validateRegressionInput([amount, tier, active], { amount: 10, tier: 'gold' });
    expect(issues.map((issue) => issue.code)).toEqual(['missing-value']);
    expect(issues[0].fieldId).toBe('active');
  });

  it('flags out-of-range numbers, invalid enums, wrong types, and removed fields separately', () => {
    const issues = validateRegressionInput([amount, tier, active], { amount: 1200, tier: 'platinum', active: 'yes', legacy: 1 });
    expect(issues.map((issue) => issue.code).sort()).toEqual(['field-removed', 'invalid-enum', 'invalid-type', 'out-of-range']);
    expect(issues.every((issue) => issue.message.length > 0)).toBe(true);
  });

  it('treats empty string as a missing value, same as the sample editor semantics', () => {
    const issues = validateRegressionInput([active], { active: '' });
    expect(issues.map((issue) => issue.code)).toEqual(['missing-value']);
  });
});

describe('regression case outcomes', () => {
  const base = makeRule('base', gte('amount', 500), 10);
  const gold = makeRule('gold', goldTier(), 20);

  it('reports unchanged when the matched set and winner stay identical', () => {
    const result = runRegressionCase(project([base, gold]), testCase('c1', ['gold', 'base']));
    expect(result.outcome).toBe('unchanged');
    expect(result.enteredRuleIds).toEqual([]);
    expect(result.exitedRuleIds).toEqual([]);
  });

  it('detects a rule newly entering the match set', () => {
    const changed = project([base, gold, makeRule('promo', gte('amount', 400), 5)]);
    const result = runRegressionCase(changed, testCase('c1', ['gold', 'base']));
    expect(result.outcome).toBe('changed');
    expect(result.enteredRuleIds).toEqual(['promo']);
    expect(result.exitedRuleIds).toEqual([]);
  });

  it('detects a rule dropping out of the match set after rules change', () => {
    const tightened = project([makeRule('base', gte('amount', 800), 10), gold]);
    const result = runRegressionCase(tightened, testCase('c1', ['gold', 'base']));
    expect(result.outcome).toBe('changed');
    expect(result.enteredRuleIds).toEqual([]);
    expect(result.exitedRuleIds).toEqual(['base']);
  });

  it('reports no-match distinctly when a previously matching input now hits nothing', () => {
    const tightened = project([makeRule('base', gte('amount', 900), 10), gold]);
    const result = runRegressionCase(tightened, testCase('c1', ['base'], { tier: 'basic', amount: 600 }));
    expect(result.outcome).toBe('no-match');
    expect(result.currentRuleIds).toEqual([]);
    expect(result.exitedRuleIds).toEqual(['base']);
  });

  it('stays unchanged when the expectation was no match and nothing matches', () => {
    const result = runRegressionCase(project([base]), testCase('c1', [], { amount: 100 }));
    expect(result.outcome).toBe('unchanged');
  });

  it('classifies invalid inputs separately and never evaluates rules', () => {
    const result = runRegressionCase(project([base, gold]), testCase('c1', ['base'], { amount: 5000 }));
    expect(result.outcome).toBe('invalid-input');
    expect(result.currentRuleIds).toEqual([]);
    expect(result.inputIssues.map((issue) => issue.code)).toContain('out-of-range');
    expect(result.enteredRuleIds).toEqual([]);
  });

  it('notices winner order changes even when the matched rule set is the same', () => {
    const reordered = project([makeRule('base', gte('amount', 500), 30), makeRule('gold', goldTier(), 20)]);
    const result = runRegressionCase(reordered, testCase('c1', ['gold', 'base']));
    expect(result.outcome).toBe('changed');
    expect(result.currentRuleIds[0]).toBe('base');
  });
});

describe('regression suite aggregation', () => {
  it('tallies unchanged, changed, no-match and invalid groups independently', () => {
    const rules = [makeRule('base', gte('amount', 500), 10), makeRule('gold', goldTier(), 20)];
    const cases = [
      testCase('ok', ['gold', 'base']),
      testCase('gone', ['base'], { tier: 'basic', amount: 100 }),
      testCase('bad', ['base'], { amount: 9999 }),
    ];
    const report = runRegressionSuite(project(rules, cases));
    expect(report.total).toBe(3);
    expect(report.unchanged).toBe(1);
    expect(report.changed).toBe(0);
    expect(report.noMatch).toBe(1);
    expect(report.invalid).toBe(1);
    expect(report.results.find((result) => result.caseId === 'gone')?.exitedRuleIds).toEqual(['base']);
  });

  it('matches rules by priority with list order as tie breaker', () => {
    const rules = [makeRule('first', gte('amount', 500), 10), makeRule('second', gte('amount', 500), 10)];
    expect(matchedRulesForInput(project(rules), input()).map((rule) => rule.id)).toEqual(['first', 'second']);
  });
});
