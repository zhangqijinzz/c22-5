import type { ModuleId, RegressionCase, RuleProject, SampleInput } from '../models/ruleModel';
import type { WorkspaceState } from './workspaceViewModel';

export interface WorkspacePort {
  getSnapshot(): WorkspaceState;
  commitProject(project: RuleProject, notice?: string, options?: { recheck?: boolean }): boolean;
  updateView(patch: Partial<WorkspaceState>): void;
  navigate(module: ModuleId): void;
  selectRule(ruleId?: string): void;
  addRegressionCase(input?: SampleInput): void;
  updateRegressionCase(caseId: string, updates: Partial<Pick<RegressionCase, 'name' | 'input' | 'expectedRuleIds'>>): void;
  removeRegressionCase(caseId: string): void;
  acceptRegressionResult(caseId: string): void;
  runRegression(): void;
}
