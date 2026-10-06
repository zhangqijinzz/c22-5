import { matchesRule } from './conditionEvaluator';
import type {
  BusinessRule,
  RegressionCase,
  RegressionCaseResult,
  RegressionInputIssue,
  RegressionRunReport,
  RuleField,
  RuleProject,
  SampleInput,
} from '../models/ruleModel';

/**
 * 校验回归用例的输入本身是否合法。
 * 输入不合法与“规则命中变化”是两类完全不同的问题，必须分开上报，
 * 因此这里返回结构化原因，而不是直接参与命中比对。
 */
export function validateRegressionInput(fields: RuleField[], input: SampleInput): RegressionInputIssue[] {
  const issues: RegressionInputIssue[] = [];
  for (const field of fields) {
    const value = input[field.id];
    if (value === undefined || value === '') {
      issues.push(issue('missing-value', field, `用例缺少字段“${field.name}”的值（字段新增后旧用例需要补值）`));
      continue;
    }
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push(issue('invalid-type', field, `“${field.name}”必须是有效数值`));
      } else if (value < (field.min ?? -Infinity) || value > (field.max ?? Infinity)) {
        issues.push(issue('out-of-range', field, `“${field.name}”取值 ${value} 超出范围 ${field.min} 到 ${field.max}`));
      }
    } else if (field.type === 'enum') {
      if (typeof value !== 'string' || !(field.enumValues ?? []).includes(value)) {
        issues.push(issue('invalid-enum', field, `“${field.name}”的值“${String(value)}”不在当前枚举选项中`));
      }
    } else if (typeof value !== 'boolean') {
      issues.push(issue('invalid-type', field, `“${field.name}”需要是布尔值（是/否）`));
    }
  }
  const liveFieldIds = new Set(fields.map((field) => field.id));
  for (const key of Object.keys(input)) {
    if (!liveFieldIds.has(key)) {
      issues.push({ code: 'field-removed', fieldId: key, message: `用例引用的字段“${key}”已被删除，请移除该输入或重新选择字段` });
    }
  }
  return issues;
}

function issue(code: RegressionInputIssue['code'], field: RuleField, message: string): RegressionInputIssue {
  return { code, fieldId: field.id, fieldName: field.name, message };
}

/** 按项目当前规则求值，返回按优先级（同优先级按规则列表顺序）排序后的命中规则。 */
export function matchedRulesForInput(project: RuleProject, input: SampleInput): BusinessRule[] {
  return project.rules
    .filter((rule) => matchesRule(rule, input))
    .sort((a, b) => b.priority - a.priority || project.rules.indexOf(a) - project.rules.indexOf(b));
}

export function runRegressionCase(project: RuleProject, testCase: RegressionCase): RegressionCaseResult {
  const inputIssues = validateRegressionInput(project.fields, testCase.input);
  const expectedRuleIds = [...testCase.expectedRuleIds];
  if (inputIssues.length) {
    return {
      caseId: testCase.id,
      outcome: 'invalid-input',
      inputIssues,
      currentRuleIds: [],
      expectedRuleIds,
      enteredRuleIds: [],
      exitedRuleIds: [],
    };
  }
  const currentRules = matchedRulesForInput(project, testCase.input);
  const currentRuleIds = currentRules.map((rule) => rule.id);
  const currentSet = new Set(currentRuleIds);
  const expectedSet = new Set(expectedRuleIds);
  const enteredRuleIds = currentRuleIds.filter((id) => !expectedSet.has(id));
  const exitedRuleIds = expectedRuleIds.filter((id) => !currentSet.has(id));
  const winnerChanged = currentRuleIds[0] !== expectedRuleIds[0];
  let outcome: RegressionCaseResult['outcome'];
  if (currentRuleIds.length === 0) {
    // 记录时就期望无命中且仍然无命中，属于保持一致。
    outcome = expectedRuleIds.length === 0 ? 'unchanged' : 'no-match';
  } else if (enteredRuleIds.length === 0 && exitedRuleIds.length === 0 && !winnerChanged) {
    outcome = 'unchanged';
  } else {
    outcome = 'changed';
  }
  return {
    caseId: testCase.id,
    outcome,
    inputIssues: [],
    currentRuleIds,
    expectedRuleIds,
    enteredRuleIds,
    exitedRuleIds,
  };
}

export function runRegressionSuite(project: RuleProject): RegressionRunReport {
  const results = project.regressionCases.map((testCase) => runRegressionCase(project, testCase));
  return {
    ranAt: Date.now(),
    total: results.length,
    unchanged: results.filter((result) => result.outcome === 'unchanged').length,
    changed: results.filter((result) => result.outcome === 'changed').length,
    noMatch: results.filter((result) => result.outcome === 'no-match').length,
    invalid: results.filter((result) => result.outcome === 'invalid-input').length,
    results,
  };
}
