import { rebaselineCase, recordRegressionCase } from '../../domain/regressionSuite';
import type { RegressionCase, RuleProject, SampleInput, ScalarValue } from '../../models/ruleModel';
import type { WorkspacePort } from '../../viewmodels/workspacePort';

export class RegressionViewModel {
  constructor(private readonly workspace: WorkspacePort) {}

  runAll(): void {
    const project = this.currentProject();
    if (!project) return;
    const report = this.workspace.runRegression();
    if (!report) return;
    if (!project.regressionCases.length) this.workspace.updateView({ notice: '回归集合还是空的，先添加用例' });
    else if (report.changed + report.noMatch + report.invalidChanged + report.stale === 0) {
      this.workspace.updateView({ notice: `回归通过：${report.consistent} 组命中一致${report.invalidConsistent ? `、${report.invalidConsistent} 组非法输入与记录一致` : ''}` });
    } else {
      const parts = [
        report.changed && `${report.changed} 组命中变化`,
        report.noMatch && `${report.noMatch} 组变成无命中`,
        report.invalidChanged && `${report.invalidChanged} 组输入合法性变化`,
        report.stale && `${report.stale} 组需要维护`,
      ].filter(Boolean);
      this.workspace.updateView({ notice: `回归完成：${parts.join('、')}` });
    }
  }

  addCase(name: string, input?: SampleInput, expectValid = true): void {
    const project = this.currentProject();
    if (!project) return;
    const values = input ?? project.sampleInputs;
    const recorded = recordRegressionCase(project, name, values, expectValid);
    const testCase = recorded.case;
    const committed = this.commit({ ...project, regressionCases: [...project.regressionCases, testCase] }, `已加入回归用例“${testCase.name}”`);
    if (committed) {
      if (recorded.inputErrors.length) this.workspace.updateView({ notice: `已记录非法输入用例“${testCase.name}”：${recorded.inputErrors[0]}` });
      this.runAll();
    }
  }

  addCaseFromSamples(name: string): void {
    const project = this.currentProject();
    if (!project) return;
    this.addCase(name, structuredClone(project.sampleInputs));
  }

  renameCase(caseId: string, name: string): void {
    this.updateCases(
      (testCase) => testCase.id === caseId ? { ...testCase, name } : testCase,
      '用例名称已更新',
    );
  }

  setValue(caseId: string, fieldId: string, value: ScalarValue | ''): void {
    const project = this.currentProject();
    if (!project) return;
    const testCase = project.regressionCases.find((candidate) => candidate.id === caseId);
    if (!testCase) return;
    const input = { ...testCase.input, [fieldId]: value };
    this.updateCases(
      (candidate) => candidate.id === caseId ? { ...candidate, input } : candidate,
      '用例输入已修改，点击“运行全部回归”查看结果',
    );
  }

  removeCase(caseId: string): void {
    const project = this.currentProject();
    if (!project) return;
    const testCase = project.regressionCases.find((candidate) => candidate.id === caseId);
    this.commit(
      { ...project, regressionCases: project.regressionCases.filter((candidate) => candidate.id !== caseId) },
      `已删除回归用例${testCase ? `“${testCase.name}”` : ''}`,
    );
    this.runAll();
  }

  /** 接受某一组用例当前的命中结果，更新它记住的期望快照 */
  acceptCurrent(caseId: string): void {
    const project = this.currentProject();
    if (!project) return;
    const rebased = rebaselineCase(project, caseId);
    if (!rebased) return;
    this.commit(
      { ...project, regressionCases: project.regressionCases.map((testCase) => testCase.id === caseId ? rebased : testCase) },
      `已将“${rebased.name}”的期望更新为当前结果`,
    );
    this.runAll();
  }

  /** 一键接受所有发生变化（含变为无命中）的用例现状；待维护/非法输入用例不动 */
  acceptAllChanged(): void {
    const project = this.currentProject();
    const report = this.workspace.getSnapshot().regressionReport;
    if (!project || !report) return;
    const mutableIds = new Set(
      report.results
        .filter((result) => result.status === 'changed' || result.status === 'no-match' || result.status === 'invalid-changed')
        .map((result) => result.caseId),
    );
    if (!mutableIds.size) return;
    const nextCases = project.regressionCases.map((testCase) => {
      if (!mutableIds.has(testCase.id)) return testCase;
      const rebased = rebaselineCase(project, testCase.id);
      return rebased ?? testCase;
    });
    this.commit({ ...project, regressionCases: nextCases }, `已接受 ${mutableIds.size} 组用例的当前结果`);
    this.runAll();
  }

  private updateCases(update: (testCase: RegressionCase) => RegressionCase, notice: string): void {
    const project = this.currentProject();
    if (project) this.commit({ ...project, regressionCases: project.regressionCases.map(update) }, notice, { recheck: false });
  }

  private commit(project: RuleProject, notice: string, options?: { recheck?: boolean }): boolean {
    return this.workspace.commitProject(project, notice, options);
  }

  private currentProject(): RuleProject | null {
    return this.workspace.getSnapshot().project;
  }
}
