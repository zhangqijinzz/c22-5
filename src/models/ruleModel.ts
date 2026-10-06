export type FieldType = 'number' | 'enum' | 'boolean';
export type ScalarValue = string | number | boolean;
export type ModuleId = 'fields' | 'rules' | 'samples' | 'inspection' | 'regression';

export interface RuleField {
  id: string;
  name: string;
  type: FieldType;
  enumValues?: string[];
  min?: number;
  max?: number;
}

export interface NumberRange {
  min: number;
  max: number;
}

export type PredicateCondition =
  | { kind: 'predicate'; fieldId: string; operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte'; value: number }
  | { kind: 'predicate'; fieldId: string; operator: 'between'; value: NumberRange }
  | { kind: 'predicate'; fieldId: string; operator: 'eq' | 'notEq'; value: string }
  | { kind: 'predicate'; fieldId: string; operator: 'isTrue' | 'isFalse'; value: boolean };

export interface ConditionGroup {
  kind: 'group';
  operator: 'and' | 'or';
  conditions: RuleCondition[];
}

export type RuleCondition = PredicateCondition | ConditionGroup;

export interface BusinessRule {
  id: string;
  name: string;
  conditions: ConditionGroup;
  priority: number;
  result: string;
}

export type SampleInput = Record<string, ScalarValue | ''>;

export interface RuleVersion {
  id: string;
  name: string;
  savedAt: number;
  frozen: boolean;
  fields: RuleField[];
  rules: BusinessRule[];
  sampleInputs: SampleInput;
}

export interface RuleProject {
  id: string;
  title: string;
  fields: RuleField[];
  rules: BusinessRule[];
  sampleInputs: SampleInput;
  regressionCases: RegressionCase[];
  versions: RuleVersion[];
  frozenVersionId?: string;
  updatedAt: number;
}

export interface WorkspaceDocument {
  schemaVersion: 1;
  projects: RuleProject[];
  activeProjectId: string;
}

export interface ValidationIssue {
  code: string;
  message: string;
  fieldId?: string;
  ruleId?: string;
}

export interface MatchWitness {
  values: SampleInput;
  ruleIds: string[];
}

export interface RuleOverlap {
  ruleAId: string;
  ruleBId: string;
  conflict: boolean;
  witness: SampleInput;
}

export interface RuleAnalysis {
  checkedCases: number;
  coveredCases: number;
  coveragePercent: number;
  overlaps: RuleOverlap[];
  unreachableRuleIds: string[];
  shadowedRuleIds: string[];
  uncoveredExamples: SampleInput[];
  truncated: boolean;
}

export interface SampleEvaluation {
  valid: boolean;
  errors: string[];
  matchedRules: BusinessRule[];
  winner?: BusinessRule;
}

/** 单条回归用例：固定一组输入，以及记录时期望命中的规则集合（空数组表示期望没有任何规则命中）。 */
export interface RegressionCase {
  id: string;
  name: string;
  createdAt: number;
  input: SampleInput;
  expectedRuleIds: string[];
}

export type RegressionIssueCode =
  | 'missing-value'
  | 'invalid-type'
  | 'out-of-range'
  | 'invalid-enum'
  | 'field-removed'
  | 'unknown-input';

export interface RegressionInputIssue {
  code: RegressionIssueCode;
  fieldId: string;
  fieldName?: string;
  message: string;
}

export type RegressionOutcome = 'unchanged' | 'changed' | 'no-match' | 'invalid-input';

export interface RegressionCaseResult {
  caseId: string;
  outcome: RegressionOutcome;
  /** 输入不合法时的结构化原因，与规则命中变化严格分开。 */
  inputIssues: RegressionInputIssue[];
  currentRuleIds: string[];
  expectedRuleIds: string[];
  /** 相比期望新进入命中的规则。 */
  enteredRuleIds: string[];
  /** 相比期望退出命中的规则。 */
  exitedRuleIds: string[];
}

export interface RegressionRunReport {
  ranAt: number;
  total: number;
  unchanged: number;
  changed: number;
  noMatch: number;
  invalid: number;
  results: RegressionCaseResult[];
}

export interface DomainChecker {
  analyze(project: RuleProject): RuleAnalysis;
  validateProject(project: RuleProject): ValidationIssue[];
}

export const fieldLabel = (field: RuleField): string => field.name || '未命名字段';
