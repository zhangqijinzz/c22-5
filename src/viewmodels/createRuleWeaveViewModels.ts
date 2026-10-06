import { FieldsViewModel } from '../features/fields/fieldsViewModel';
import { RulesViewModel } from '../features/rules/rulesViewModel';
import { RegressionViewModel } from '../features/regression/regressionViewModel';
import { RuleWorkspaceViewModel } from './workspaceViewModel';
import { SamplesViewModel } from '../features/samples/samplesViewModel';
import { InspectionViewModel } from '../features/inspection/inspectionViewModel';

export function createRuleWeaveViewModels() {
  const workspace = new RuleWorkspaceViewModel();
  return {
    workspace,
    fields: new FieldsViewModel(workspace),
    rules: new RulesViewModel(workspace),
    samples: new SamplesViewModel(workspace),
    regression: new RegressionViewModel(workspace),
    inspection: new InspectionViewModel(workspace),
  };
}
