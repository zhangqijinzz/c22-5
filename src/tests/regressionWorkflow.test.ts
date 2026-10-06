import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegressionViewModel } from '../features/regression/regressionViewModel';
import { FieldsViewModel } from '../features/fields/fieldsViewModel';
import { createDemoWorkspace } from '../models/projectFactory';
import type { RegressionCase, RuleCondition, WorkspaceDocument } from '../models/ruleModel';
import { RuleRepository } from '../repositories/ruleRepository';
import { RuleWorkspaceViewModel } from '../viewmodels/workspaceViewModel';

class MemoryRepository {
  constructor(public document: WorkspaceDocument | null = null) {}
  async load() { return this.document ? structuredClone(this.document) : null; }
  async save(document: WorkspaceDocument) { this.document = structuredClone(document); }
}

class DecodingRepository {
  constructor(private raw: unknown) {}
  async load(): Promise<WorkspaceDocument | null> {
    const storage = {
      read: async () => this.raw,
      readFallback: () => null,
      write: async () => undefined,
    };
    return new RuleRepository(storage as never).load();
  }
  async save() {}
}

class FakeChecker {
  run() { return { promise: Promise.resolve({ checkedCases: 1, coveredCases: 1, coveragePercent: 100, overlaps: [], unreachableRuleIds: [], shadowedRuleIds: [], uncoveredExamples: [], truncated: false }), cancel() {} }; }
}

/** 演示规则集但回归集合为空的工作区，保证每组测试的用例数量完全由自己决定。 */
function demoDocument(regressionCases: RegressionCase[] = []): WorkspaceDocument {
  const workspace = createDemoWorkspace();
  const [project] = workspace.projects;
  return { ...workspace, projects: [{ ...project, regressionCases: structuredClone(regressionCases) }] };
}

async function startedWorkspace(document: WorkspaceDocument | null = null) {
  const workspace = new RuleWorkspaceViewModel(new MemoryRepository(document), new FakeChecker());
  await workspace.start();
  return workspace;
}

function raiseCartThreshold(conditions: RuleCondition[]): RuleCondition[] {
  return conditions.map((condition) =>
    condition.kind === 'predicate' && condition.fieldId === 'cart-total' && condition.operator === 'gte'
      ? { ...condition, value: 1500 }
      : condition);
}

describe('regression workflow on the workspace', () => {
  beforeEach(() => vi.useFakeTimers());

  it('captures a case from the current sample, runs all, and shows which rule exited after a rule changes', async () => {
    const workspace = await startedWorkspace(demoDocument());
    const regression = new RegressionViewModel(workspace);

    // 演示样例：金卡会员、金额 1200、使用优惠券 → 金卡大额 + 优惠券两条命中
    regression.captureFromSample();
    let project = workspace.getSnapshot().project!;
    expect(project.regressionCases).toHaveLength(1);
    expect(project.regressionCases[0].expectedRuleIds).toEqual(['rule-gold-discount', 'rule-coupon-discount']);

    workspace.runRegression();
    expect(workspace.getSnapshot().regressionReport?.unchanged).toBe(1);
    expect(workspace.getSnapshot().regressionReport?.changed).toBe(0);

    // 把优惠券阈值从 800 提高到 1500，1200 不再命中优惠券规则
    project = workspace.getSnapshot().project!;
    const rules = project.rules.map((rule) => rule.id === 'rule-coupon-discount'
      ? { ...rule, conditions: { ...rule.conditions, conditions: raiseCartThreshold(rule.conditions.conditions) } }
      : rule);
    workspace.commitProject({ ...project, rules }, '收紧优惠券规则', { recheck: false });

    const report = workspace.getSnapshot().regressionReport!;
    expect(report.changed).toBe(1);
    const result = report.results[0];
    expect(result.outcome).toBe('changed');
    expect(result.enteredRuleIds).toEqual([]);
    expect(result.exitedRuleIds).toEqual(['rule-coupon-discount']);
    expect(result.currentRuleIds).toEqual(['rule-gold-discount']);

    // 确认新结果正确后固化为新期望，再次运行即恢复全绿
    regression.acceptCurrent(project.regressionCases[0].id);
    workspace.runRegression();
    expect(workspace.getSnapshot().regressionReport?.unchanged).toBe(1);
    workspace.dispose();
  });

  it('separately classifies a case whose input became invalid after a field range shrinks', async () => {
    const workspace = await startedWorkspace(demoDocument());
    const regression = new RegressionViewModel(workspace);
    regression.captureFromSample();
    const project = workspace.getSnapshot().project!;

    // 金额字段范围缩小到 0–500，已记录的 1200 立刻越界
    const fields = project.fields.map((field) => field.id === 'cart-total' ? { ...field, max: 500 } : field);
    workspace.commitProject({ ...project, fields }, '收紧金额范围', { recheck: false });

    const report = workspace.getSnapshot().regressionReport!;
    expect(report.invalid).toBe(1);
    expect(report.changed).toBe(0);
    const result = report.results[0];
    expect(result.outcome).toBe('invalid-input');
    expect(result.inputIssues.some((issue) => issue.code === 'out-of-range')).toBe(true);
    expect(result.currentRuleIds).toEqual([]);

    // 输入不合法的用例不能通过“固化当前命中”掩盖掉
    regression.acceptCurrent(project.regressionCases[0].id);
    workspace.runRegression();
    expect(workspace.getSnapshot().regressionReport?.invalid).toBe(1);
    workspace.dispose();
  });

  it('reports no-match when an editing change removes every matching rule', async () => {
    const workspace = await startedWorkspace(demoDocument());
    const regression = new RegressionViewModel(workspace);
    // 金卡会员 1200、不使用优惠券 → 仅命中金卡大额规则
    const project = workspace.getSnapshot().project!;
    workspace.commitProject({ ...project, sampleInputs: { 'member-level': '金卡会员', 'cart-total': 1200, 'coupon-active': false } }, '换一组输入', { recheck: false });
    regression.captureFromSample();
    const capturedId = workspace.getSnapshot().project!.regressionCases[0].id;
    expect(workspace.getSnapshot().project!.regressionCases[0].expectedRuleIds).toEqual(['rule-gold-discount']);

    // 删除金卡规则后，这组输入变为全无命中
    const changed = workspace.getSnapshot().project!;
    workspace.commitProject({ ...changed, rules: changed.rules.filter((rule) => rule.id !== 'rule-gold-discount') }, '删除金卡规则', { recheck: false });
    const result = workspace.getSnapshot().regressionReport?.results.find((item) => item.caseId === capturedId);
    expect(result?.outcome).toBe('no-match');
    expect(result?.currentRuleIds).toEqual([]);
    expect(result?.exitedRuleIds).toEqual(['rule-gold-discount']);
    workspace.dispose();
  });

  it('persists the regression set with the project and restores it on reload', async () => {
    const repository = new MemoryRepository(demoDocument());
    const workspace = new RuleWorkspaceViewModel(repository, new FakeChecker());
    await workspace.start();
    new RegressionViewModel(workspace).captureFromSample();
    await vi.advanceTimersByTimeAsync(260);
    await workspace.flushSave();
    expect(repository.document?.projects[0].regressionCases).toHaveLength(1);

    const restored = new RuleWorkspaceViewModel(new MemoryRepository(repository.document), new FakeChecker());
    await restored.start();
    const report = restored.getSnapshot().regressionReport;
    expect(report?.total).toBe(1);
    expect(report?.unchanged).toBe(1);
    restored.dispose();
    workspace.dispose();
  });

  it('tolerates older documents without the regression field, and rejects structurally malformed cases on decode', async () => {
    const demo = demoDocument();
    const [demoProject] = demo.projects;
    const rawLegacy = { schemaVersion: 1, activeProjectId: demoProject.id, projects: [{ ...demoProject, regressionCases: undefined }] };
    const legacyRepo = new DecodingRepository(rawLegacy);
    const legacy = await legacyRepo.load();
    expect(legacy?.projects[0].regressionCases).toEqual([]);

    const rawWithBadCases = {
      schemaVersion: 1,
      activeProjectId: demoProject.id,
      projects: [{
        ...demoProject,
        regressionCases: [
          { id: 'good', name: '合法用例', createdAt: 2, input: demoProject.sampleInputs, expectedRuleIds: [] },
          { id: 'broken', name: '缺少输入字段', createdAt: 3, expectedRuleIds: [] },
          { id: 'broken2', name: '期望列表类型错误', createdAt: 4, input: {}, expectedRuleIds: 'not-an-array' },
        ],
      }],
    };
    const repaired = await new DecodingRepository(rawWithBadCases).load();
    // 结构损坏的用例在解码层被剔除，不会被误算成一次失败的回归；运行期字段漂移仍逐组提示。
    expect(repaired?.projects[0].regressionCases.map((testCase) => testCase.id)).toEqual(['good']);
  });

  it('flags missing values after a field is added and clears dangling input when a field is removed', async () => {
    const workspace = await startedWorkspace(demoDocument());
    const regression = new RegressionViewModel(workspace);
    const fields = new FieldsViewModel(workspace);
    regression.captureFromSample();
    expect(workspace.getSnapshot().regressionReport?.unchanged).toBe(1);

    // 新增布尔字段后，旧用例缺值，被单独归入“输入不合法”而不是误报规则变化
    fields.addField('boolean');
    const newField = workspace.getSnapshot().project!.fields.at(-1)!;
    const report = workspace.getSnapshot().regressionReport!;
    expect(report.invalid).toBe(1);
    expect(report.results[0].inputIssues.map((issue) => issue.code)).toEqual(['missing-value']);
    expect(report.results[0].inputIssues[0].fieldId).toBe(newField.id);

    // 新字段未被任何规则引用，可以删除；删除后用例输入中的悬空键被清掉，恢复一致
    expect(fields.removeField(newField.id)).toBe(true);
    expect(workspace.getSnapshot().regressionReport?.invalid).toBe(0);
    expect(workspace.getSnapshot().regressionReport?.unchanged).toBe(1);
    expect(workspace.getSnapshot().project!.regressionCases[0].input[newField.id]).toBeUndefined();
    workspace.dispose();
  });
});
