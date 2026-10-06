import { evaluateSample } from './conditionEvaluator';
import { makeId } from '../models/projectFactory';
import type {
  BusinessRule,
  RegressionCase,
  RegressionCaseResult,
  RegressionInputIssue,
  RegressionReport,
  RegressionRuleExpectation,
  RuleField,
  RuleProject,
  SampleInput,
} from '../models/ruleModel';

/** 录入用例时对当前输入求值，固化期望命中的有序规则快照 */
export function recordRegressionCase(
  project: RuleProject,
  name: string,
  input: SampleInput,
  expectValid: boolean,
): { case: RegressionCase; inputErrors: string[] } {
  const evaluation = evaluateSample(project, input);
  const expectedRules = evaluation.valid
    ? evaluation.matchedRules.map((rule) => ({ id: rule.id, name: rule.name }))
    : [];
  const testCase: RegressionCase = {
    id: makeId('case'),
    name: name.trim() || `用例 ${project.regressionCases.length + 1}`,
    fieldIds: project.fields.map((field) => field.id),
    input: structuredClone(input),
    expectValid: evaluation.valid ? true : expectValid,
    expectedRules,
    createdAt: Date.now(),
  };
  return { case: testCase, inputErrors: evaluation.errors };
}

/** 接受当前实际结果，重新固化某一组用例的期望 */
export function rebaselineCase(project: RuleProject, caseId: string): RegressionCase | null {
  const target = project.regressionCases.find((item) => item.id === caseId);
  if (!target) return null;
  const recorded = recordRegressionCase(project, target.name, target.input, target.expectValid);
  return { ...recorded.case, id: target.id, createdAt: target.createdAt };
}

/** 对当前项目跑完全部回归用例，逐组给出状态与规则进出明细 */
export function runRegressionSuite(project: RuleProject): RegressionReport {
  const ranAt = Date.now();
  const results = project.regressionCases.map((testCase) => evaluateCase(project, testCase));
  return {
    total: results.length,
    consistent: results.filter((result) => result.status === 'consistent').length,
    changed: results.filter((result) => result.status === 'changed').length,
    noMatch: results.filter((result) => result.status === 'no-match').length,
    invalidConsistent: results.filter((result) => result.status === 'invalid-consistent').length,
    invalidChanged: results.filter((result) => result.status === 'invalid-changed').length,
    stale: results.filter((result) => result.status === 'stale').length,
    results,
    projectUpdatedAt: project.updatedAt,
    ranAt,
  };
}

function evaluateCase(project: RuleProject, testCase: RegressionCase): RegressionCaseResult {
  const structuralIssues = inspectStructure(project, testCase);
  const evaluation = evaluateSample(project, normalizeInput(project, testCase.input));
  const expectedRules = testCase.expectedRules.map((rule) => snapshotRule(project, rule));
  const base = {
    caseId: testCase.id,
    structuralIssues,
    expectedRules,
    actualRules: [] as RegressionRuleExpectation[],
    enteredRules: [] as RegressionRuleExpectation[],
    exitedRules: [] as RegressionRuleExpectation[],
    inputErrors: evaluation.errors,
  };

  // 字段增删 / 缺值 / 越界等定义漂移单独归类，绝不与规则变化混报
  if (structuralIssues.length) return { ...base, status: 'stale' };

  if (!evaluation.valid) {
    // 用例本身记录的就是非法输入：非法状态保持则一致；期望合法却跑成非法，归入“输入不合法”分组并提示变化
    return { ...base, status: testCase.expectValid ? 'invalid-changed' : 'invalid-consistent' };
  }

  const actualRules = evaluation.matchedRules.map((rule) => ({ id: rule.id, name: rule.name }));
  const enteredRules = diffEntered(actualRules, expectedRules, project);
  const exitedRules = diffExited(actualRules, expectedRules, project);
  const orderedChanged = enteredRules.length > 0 || exitedRules.length > 0
    || actualRules.some((rule, index) => rule.id !== expectedRules[index]?.id);
  const populated = {
    ...base,
    actualRules,
    enteredRules,
    exitedRules,
    winner: actualRules[0],
  };

  if (!testCase.expectValid) {
    // 原本期望非法，现在输入却能跑出规则结果
    return { ...populated, status: 'invalid-changed' };
  }
  if (actualRules.length === 0) {
    return { ...populated, status: expectedRules.length === 0 ? 'consistent' : 'no-match' };
  }
  return { ...populated, status: orderedChanged ? 'changed' : 'consistent' };
}

/** 结构性检查：字段被删除、新增字段缺值；期望合法时取值缺失/越界也提示维护 */
function inspectStructure(project: RuleProject, testCase: RegressionCase): RegressionInputIssue[] {
  const issues: RegressionInputIssue[] = [];
  const fieldById = new Map(project.fields.map((field) => [field.id, field]));
  for (const fieldId of testCase.fieldIds) {
    if (!fieldById.has(fieldId)) {
      issues.push({ fieldId, fieldName: `字段 ${fieldId}`, message: `用例引用的字段“${fieldId}”已从字段定义中删除，请删除该值或重新选择字段` });
    }
  }
  for (const fieldId of Object.keys(testCase.input)) {
    if (!fieldById.has(fieldId)) {
      issues.push({ fieldId, fieldName: `字段 ${fieldId}`, message: `用例包含字段定义里已不存在的输入“${fieldId}”，请清理该值` });
    }
  }
  for (const field of project.fields) {
    const existedAtRecord = testCase.fieldIds.includes(field.id);
    const issue = inspectValue(field, testCase.input[field.id], existedAtRecord);
    if (issue) issues.push({ fieldId: field.id, fieldName: field.name, message: issue.message });
  }
  return issues;
}

interface ValueIssue { kind: 'missing-after-add' | 'type-mismatch' | 'out-of-range'; message: string }

function inspectValue(field: RuleField, value: SampleInput[string] | undefined, existedAtRecord: boolean): ValueIssue | null {
  if (value === undefined || value === '') {
    // 用例保存之后新增的字段缺值属于定义漂移；录入时就存在的字段留空是用例自身的非法输入
    return existedAtRecord
      ? null
      : { kind: 'missing-after-add', message: value === undefined
        ? `字段“${field.name}”是在用例保存之后新增的，请补一个取值`
        : `请补全新增字段“${field.name}”的取值` };
  }
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { kind: 'type-mismatch', message: `字段“${field.name}”需要数值，用例里保存的值类型不对` };
    }
    const min = field.min ?? -Infinity;
    const max = field.max ?? Infinity;
    if (value < min || value > max) {
      return { kind: 'out-of-range', message: `字段“${field.name}”的取值 ${value} 超出当前范围（${formatBound(min)} 到 ${formatBound(max)}），请调整用例或放开范围` };
    }
  }
  if (field.type === 'enum') {
    if (typeof value !== 'string') {
      return { kind: 'type-mismatch', message: `字段“${field.name}”需要枚举选项，用例里保存的值类型不对` };
    }
    if (!(field.enumValues ?? []).includes(value)) {
      return { kind: 'out-of-range', message: `字段“${field.name}”的取值“${value}”已不在枚举选项中，请重新选择` };
    }
  }
  if (field.type === 'boolean' && typeof value !== 'boolean') {
    return { kind: 'type-mismatch', message: `字段“${field.name}”需要是或否，用例里保存的值类型不对` };
  }
  return null;
}

function formatBound(value: number): string {
  return Number.isFinite(value) ? String(value) : '∞';
}

/** evaluateSample 会把缺失字段报为“请填写”，这里保持原输入即可；只剔除已删除字段避免污染错误信息 */
function normalizeInput(project: RuleProject, input: SampleInput): SampleInput {
  const fieldIds = new Set(project.fields.map((field) => field.id));
  return Object.fromEntries(Object.entries(input).filter(([fieldId]) => fieldIds.has(fieldId)));
}

/** 期望里引用、但当前实际没有命中的规则；规则已删除时用录入时的名称快照呈现 */
function diffEntered(
  actualRules: RegressionRuleExpectation[],
  expectedRules: RegressionRuleExpectation[],
  project: RuleProject,
): RegressionRuleExpectation[] {
  const expectedIds = new Set(expectedRules.map((rule) => rule.id));
  return actualRules.filter((rule) => !expectedIds.has(rule.id)).map((rule) => snapshotRule(project, rule));
}

function diffExited(
  actualRules: RegressionRuleExpectation[],
  expectedRules: RegressionRuleExpectation[],
  project: RuleProject,
): RegressionRuleExpectation[] {
  const actualIds = new Set(actualRules.map((rule) => rule.id));
  return expectedRules.filter((rule) => !actualIds.has(rule.id)).map((rule) => snapshotRule(project, rule));
}

function snapshotRule(project: RuleProject, rule: RegressionRuleExpectation): RegressionRuleExpectation {
  const current = project.rules.find((candidate) => candidate.id === rule.id);
  return current ? { id: current.id, name: current.name } : { id: rule.id, name: rule.name || rule.id };
}

export function ruleExists(project: RuleProject, ruleId: string): BusinessRule | undefined {
  return project.rules.find((rule) => rule.id === ruleId);
}
