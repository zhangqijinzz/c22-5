import type { RegressionCaseResult, RuleProject } from '../../models/ruleModel';
import type { WorkspaceState } from '../../viewmodels/workspaceViewModel';
import type { RegressionViewModel } from './regressionViewModel';

interface RegressionViewProps { state: WorkspaceState; viewModel: RegressionViewModel }

const outcomeMeta: Record<RegressionCaseResult['outcome'], { label: string; tone: string; icon: string; hint: string }> = {
  unchanged: { label: '保持一致', tone: 'regression-good', icon: '✓', hint: '命中规则与记录时期望完全相同' },
  changed: { label: '命中变化', tone: 'regression-warn', icon: '⇄', hint: '规则集合改变后，命中结果与期望不同' },
  'no-match': { label: '变为无命中', tone: 'regression-danger', icon: '∅', hint: '记录时存在命中，现在没有任何规则命中' },
  'invalid-input': { label: '输入不合法', tone: 'regression-neutral', icon: '!', hint: '输入本身缺值或越界，未参与规则比对' },
};

export function RegressionView({ state, viewModel }: RegressionViewProps) {
  const project = state.project;
  const report = state.regressionReport;
  const fields = project?.fields ?? [];
  const cases = project?.regressionCases ?? [];
  const resultByCase = new Map((report?.results ?? []).map((result) => [result.caseId, result]));
  return (
    <section className="module-page regression-page">
      <div className="page-heading">
        <div><span className="eyebrow">模块 05 / 回归集合</span><h1>回归用例集</h1><p>每组用例固定具体输入与当时的命中结果，一键跑完即可发现规则调整带来的差异。集合随项目一起保存。</p></div>
        <div className="button-row">
          <button className="button button-subtle" disabled={!fields.length} onClick={() => viewModel.captureFromSample()} title="使用“样例试验区”当前填写的输入"><span className="button-icon">＋</span> 从样例输入记录</button>
          <button className="button button-primary" disabled={!cases.length} onClick={() => viewModel.runAll()}><span>▶</span> 一键运行全部</button>
        </div>
      </div>

      {report && report.total > 0 && <RegressionSummary report={report} />}

      {!cases.length
        ? <div className="regression-empty card-surface"><span>◉</span><div><strong>还没有回归用例</strong><p>在“样例试验区”填好一组能命中的输入后回到这里，点击“从样例输入记录”；也可以直接在下方逐字段录入。用例会把当时命中的规则一起记住。</p></div></div>
        : <div className="regression-list">
          {cases.map((testCase, index) => <CaseRow key={testCase.id} index={index} testCase={testCase} project={project as RuleProject} result={resultByCase.get(testCase.id)} viewModel={viewModel} />)}
        </div>}
      {cases.length === 0 && fields.length > 0 && <div className="regression-inline-add card-surface"><button className="text-button" onClick={() => viewModel.captureWithInput({})}>＋ 记录一条空白用例</button><span>新建后可逐字段填写输入，再用“固化当前命中”生成期望。</span></div>}
    </section>
  );
}

function RegressionSummary({ report }: { report: NonNullable<WorkspaceState['regressionReport']> }) {
  const items = [
    { label: '保持一致', value: report.unchanged, tone: 'summary-good' },
    { label: '命中变化', value: report.changed, tone: 'summary-warn' },
    { label: '变为无命中', value: report.noMatch, tone: 'summary-danger' },
    { label: '输入不合法', value: report.invalid, tone: 'summary-neutral' },
  ];
  const allGreen = report.changed === 0 && report.noMatch === 0 && report.invalid === 0;
  return (
    <div className={`regression-summary card-surface${allGreen ? ' summary-all-good' : ''}`}>
      <div className="regression-summary-head"><strong>{allGreen ? '全部回归用例与记录一致' : '回归运行发现差异'}</strong><span>最近运行 {new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(report.ranAt)} · 共 {report.total} 组</span></div>
      <div className="regression-summary-grid">
        {items.map((item) => <div className={`summary-cell ${item.tone}`} key={item.label}><b>{item.value}</b><span>{item.label}</span></div>)}
      </div>
    </div>
  );
}

interface CaseRowProps {
  index: number;
  testCase: NonNullable<RuleProject['regressionCases']>[number];
  project: RuleProject;
  result?: RegressionCaseResult;
  viewModel: RegressionViewModel;
}

function CaseRow({ index, testCase, project, result, viewModel }: CaseRowProps) {
  const meta = result ? outcomeMeta[result.outcome] : undefined;
  const ruleName = (id: string) => project.rules.find((rule) => rule.id === id)?.name ?? `已删除规则 ${id}`;
  return (
    <article className={`regression-case card-surface${meta ? ` ${meta.tone}` : ''}`}>
      <header className="regression-case-head">
        <span className="regression-case-index">{String(index + 1).padStart(2, '0')}</span>
        <input className="regression-case-name" aria-label="用例名称" value={testCase.name} onChange={(event) => viewModel.rename(testCase.id, event.target.value)} />
        {meta
          ? <span className={`regression-status-pill ${meta.tone}`} title={meta.hint}><i>{meta.icon}</i>{meta.label}</span>
          : <span className="regression-status-pill regression-idle">未运行</span>}
        <button className="text-button regression-remove" onClick={() => viewModel.remove(testCase.id)}>删除</button>
      </header>

      <div className="regression-case-body">
        <section className="regression-inputs">
          <span className="eyebrow">固定输入</span>
          <div className="regression-field-grid">
            {project.fields.map((field) => <CaseField key={field.id} field={field} value={testCase.input[field.id]} onChange={(value) => viewModel.setValue(testCase.id, field.id, value)} />)}
            {!project.fields.length && <span className="regression-hint">项目还没有字段。</span>}
          </div>
          {result?.outcome === 'invalid-input' && <div className="regression-issues">
            <strong>输入不合法，未参与规则比对：</strong>
            {result.inputIssues.map((item) => <p key={`${item.code}-${item.fieldId}`}>! {item.message}</p>)}
          </div>}
        </section>

        <section className="regression-expectations">
          <div className="regression-rules-column">
            <span className="eyebrow">记录时期望命中</span>
            {testCase.expectedRuleIds.length
              ? <ul className="regression-rule-list">{testCase.expectedRuleIds.map((id) => <li key={id} className={result && !result.currentRuleIds.includes(id) ? 'rule-exited' : ''}><span>{result && !result.currentRuleIds.includes(id) ? '−' : '·'}</span>{ruleName(id)}{result && !result.currentRuleIds.includes(id) && <em>已退出</em>}</li>)}</ul>
              : <div className="regression-no-rule">期望没有任何规则命中</div>}
          </div>
          <div className="regression-rules-column">
            <span className="eyebrow">本次实际命中</span>
            {!result
              ? <div className="regression-no-rule regression-muted">点击“一键运行全部”查看</div>
              : result.outcome === 'invalid-input'
                ? <div className="regression-no-rule regression-muted">输入不合法，未求值</div>
                : result.currentRuleIds.length
                  ? <ul className="regression-rule-list">{result.currentRuleIds.map((id) => <li key={id} className={!result.expectedRuleIds.includes(id) ? 'rule-entered' : ''}><span>{!result.expectedRuleIds.includes(id) ? '+' : '·'}</span>{ruleName(id)}{!result.expectedRuleIds.includes(id) && <em>新进入</em>}</li>)}</ul>
                  : <div className="regression-no-rule">没有任何规则命中</div>}
          </div>
        </section>
      </div>

      {result && (result.outcome === 'changed' || result.outcome === 'no-match') && (
        <footer className="regression-case-foot">
          <span>{result.outcome === 'no-match' ? '这组输入现在落在规则未覆盖区域。' : '若新的命中结果才是正确的，可以固化为新期望；否则请回去调整规则。'}</span>
          <button className="button button-outline" onClick={() => viewModel.acceptCurrent(testCase.id)}>◈ 固化当前命中为新期望</button>
        </footer>
      )}
    </article>
  );
}

interface CaseFieldProps {
  field: RuleProject['fields'][number];
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean | '') => void;
}

function CaseField({ field, value, onChange }: CaseFieldProps) {
  return (
    <label className="regression-field">
      <span>{field.name}<small>{field.type === 'number' ? `${field.min}–${field.max}` : field.type === 'enum' ? '枚举' : '是 / 否'}</small></span>
      {field.type === 'number'
        ? <input type="number" min={field.min} max={field.max} value={typeof value === 'number' ? value : ''} onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))} />
        : field.type === 'enum'
          ? <select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}><option value="">请选择</option>{(field.enumValues ?? []).map((item) => <option key={item} value={item}>{item}</option>)}</select>
          : <select value={typeof value === 'boolean' ? String(value) : ''} onChange={(event) => onChange(event.target.value === '' ? '' : event.target.value === 'true')}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select>}
    </label>
  );
}
