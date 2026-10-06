import type { RuleProject, SampleInput, ScalarValue } from '../../models/ruleModel';
import type { WorkspacePort } from '../../viewmodels/workspacePort';

export class RegressionViewModel {
  constructor(private readonly workspace: WorkspacePort) {}

  /** 用当前“样例试验区”的输入记录一组新用例，期望命中快照同时固化。 */
  captureFromSample(): void {
    this.workspace.addRegressionCase();
  }

  captureWithInput(input: SampleInput): void {
    this.workspace.addRegressionCase(input);
  }

  rename(caseId: string, name: string): void {
    this.workspace.updateRegressionCase(caseId, { name });
  }

  setValue(caseId: string, fieldId: string, value: ScalarValue | ''): void {
    const project = this.currentProject();
    const testCase = project?.regressionCases.find((candidate) => candidate.id === caseId);
    if (!project || !testCase) return;
    this.workspace.updateRegressionCase(caseId, { input: { ...testCase.input, [fieldId]: value } });
  }

  remove(caseId: string): void {
    this.workspace.removeRegressionCase(caseId);
  }

  /** 规则改完后确认新的命中结果才是正确的，把它固化为新期望。 */
  acceptCurrent(caseId: string): void {
    this.workspace.acceptRegressionResult(caseId);
  }

  runAll(): void {
    this.workspace.runRegression();
  }

  private currentProject(): RuleProject | null {
    return this.workspace.getSnapshot().project;
  }
}
