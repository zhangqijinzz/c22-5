export type FieldType = 'number' | 'enum' | 'boolean';
export type ScalarValue = string | number | boolean;
export type ModuleId = 'fields' | 'rules' | 'samples' | 'regression' | 'inspection';

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

export interface RegressionRuleExpectation {
  id: string;
  name: string;
}

export interface RegressionCase {
  id: string;
  name: string;
  /** 录入用例时字段定义的 id 集合，用于字段增删后识别“缺值/字段已删除”的漂移 */
  fieldIds: string[];
  input: SampleInput;
  /** 用例本身期望输入是合法输入（参与规则命中比对），还是非法输入（只校验报错状态） */
  expectValid: boolean;
  /** 录入时命中的有序规则快照；expectValid 为 false 或无命中时为空 */
  expectedRules: RegressionRuleExpectation[];
  createdAt: number;
}

export interface RegressionInputIssue {
  fieldId: string;
  fieldName: string;
  message: string;
}

export type RegressionCaseStatus =
  | 'consistent'
  | 'changed'
  | 'no-match'
  | 'invalid-consistent'
  | 'invalid-changed'
  | 'stale';

export interface RegressionCaseResult {
  caseId: string;
  status: RegressionCaseStatus;
  /** 字段定义漂移或取值越界等需要人工维护的问题（与规则变化严格区分） */
  structuralIssues: RegressionInputIssue[];
  /** 合法输入当前实际命中的有序规则 */
  actualRules: RegressionRuleExpectation[];
  expectedRules: RegressionRuleExpectation[];
  /** 相对期望新进来命中的规则 */
  enteredRules: RegressionRuleExpectation[];
  /** 相对期望退出命中的规则（含已被删除的规则，依据录入时的名称快照展示） */
  exitedRules: RegressionRuleExpectation[];
  /** 输入非法时的校验错误 */
  inputErrors: string[];
  winner?: RegressionRuleExpectation;
}

export interface RegressionReport {
  total: number;
  consistent: number;
  changed: number;
  noMatch: number;
  invalidConsistent: number;
  invalidChanged: number;
  stale: number;
  results: RegressionCaseResult[];
  /** 生成报告时项目的 updatedAt，用于编辑后提示报告已过期 */
  projectUpdatedAt: number;
  ranAt: number;
}

export interface RuleVersion {
  id: string;
  name: string;
  savedAt: number;
  frozen: boolean;
  fields: RuleField[];
  rules: BusinessRule[];
  sampleInputs: SampleInput;
  regressionCases: RegressionCase[];
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

export interface DomainChecker {
  analyze(project: RuleProject): RuleAnalysis;
  validateProject(project: RuleProject): ValidationIssue[];
}

export const fieldLabel = (field: RuleField): string => field.name || '未命名字段';
