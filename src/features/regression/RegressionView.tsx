import { useEffect, useMemo, useState } from 'react';
import type { RegressionCaseResult, RegressionRuleExpectation, RuleField, ScalarValue } from '../../models/ruleModel';
import type { WorkspaceState } from '../../viewmodels/workspaceViewModel';
import type { RegressionViewModel } from './regressionViewModel';

interface RegressionViewProps { state: WorkspaceState; viewModel: RegressionViewModel }

type FilterKey = 'all' | 'changed' | 'invalid' | 'stale';

const statusMeta: Record<RegressionCaseResult['status'], { label: string; tone: string }> = {
  consistent: { label: '保持一致', tone: 'good' },
  changed: { label: '命中变化', tone: 'red' },
  'no-match': { label: '变成无命中', tone: 'amber' },
  'invalid-consistent': { label: '非法输入 · 一致', tone: 'neutral' },
  'invalid-changed': { label: '非法输入 · 已变化', tone: 'amber' },
  stale: { label: '待维护', tone: 'amber' },
};

export function RegressionView({ state, viewModel }: RegressionViewProps) {
  const project = state.project;
  const report = state.regressionReport;
  const [filter, setFilter] = useState<FilterKey>('all');
  const [newCaseName, setNewCaseName] = useState('');

  // 进入页面或切项目后自动跑一遍；项目被修改后报告会标记过期，由用户决定何时一键重跑
  useEffect(() => {
    viewModel.runAll();
  }, [viewModel, project?.id]);

  const resultsById = useMemo(() => new Map((report?.results ?? []).map((result) => [result.caseId, result])), [report]);
  const isStale = Boolean(report && project && report.projectUpdatedAt !== project.updatedAt);
  const cases = project?.regressionCases ?? [];
  const hasStructuralIssues = Boolean(report?.results.some((result) => result.status === 'stale'));

  const filteredCases = cases.filter((testCase) => {
    const result = resultsById.get(testCase.id);
    if (!result) return filter === 'all';
    if (filter === 'changed') return result.status === 'changed' || result.status === 'no-match';
    if (filter === 'invalid') return result.status === 'invalid-consistent' || result.status === 'invalid-changed';
    if (filter === 'stale') return result.status === 'stale';
    return true;
  });

  return (
    <section className="module-page regression-page">
      <div className="page-heading">
        <div><span className="eyebrow">模块 04 / 回归集合</span><h1>回归用例集</h1><p>每组用例记住具体输入和当时的命中结果，一键跑完，逐组看出命中是否与记录一致。</p></div>
        <div className="button-row">
          <button className="button button-subtle" disabled={!cases.length} onClick={() => viewModel.acceptAllChanged()}>接受全部变化</button>
          <button className="button button-primary" disabled={!cases.length} onClick={() => viewModel.runAll()}><span>⟳</span> 运行全部回归</button>
        </div>
      </div>

      {project?.frozenVersionId && <div className="frozen-notice">◈ 当前项目已冻结，用例集合随版本保留；复制版本后可继续编辑。</div>}

      {report && cases.length > 0 && (
        <div className="regression-summary card-surface">
          <SummaryChip label="保持一致" value={report.consistent} tone="good" active={filter === 'all'} onClick={() => setFilter('all')} />
          <SummaryChip label="命中变化" value={report.changed} tone="red" active={filter === 'changed'} onClick={() => setFilter('changed')} />
          <SummaryChip label="变成无命中" value={report.noMatch} tone="amber" active={filter === 'changed'} onClick={() => setFilter('changed')} />
          <SummaryChip label="输入不合法" value={report.invalidConsistent + report.invalidChanged} tone="neutral" active={filter === 'invalid'} onClick={() => setFilter('invalid')} />
          <SummaryChip label="待维护" value={report.stale} tone="amber" active={filter === 'stale'} onClick={() => setFilter('stale')} />
        </div>
      )}

      {isStale && <div className="inline-issue regression-stale-banner">项目在上次运行之后被修改过，当前结果可能已过期。点击“运行全部回归”刷新。</div>}
      {hasStructuralIssues && <div className="inline-issue regression-stale-banner">有用例因字段增删或取值越界无法比对（已归入“待维护”），修好输入后再参与规则命中判定。</div>}

      <div className="regression-add card-surface">
        <div className="regression-add-copy"><strong>添加回归用例</strong><span>记住当前“样例试验区”的输入，或按下面的字段直接填一组新输入。</span></div>
        <input aria-label="新用例名称" value={newCaseName} placeholder={`用例名称（可选）· 默认“用例 ${cases.length + 1}”`} onChange={(event) => setNewCaseName(event.target.value)} />
        <div className="button-row">
          <button className="button button-outline" disabled={!project?.fields.length} onClick={() => { viewModel.addCase(newCaseName, project ? buildDraftInput(project.fields, project.sampleInputs) : undefined); setNewCaseName(''); }}>记录当前样例输入</button>
          <button className="button button-subtle" disabled={!project?.fields.length} onClick={() => { viewModel.addCase(newCaseName); setNewCaseName(''); }}>＋ 新建空白用例</button>
        </div>
      </div>

      {cases.length === 0 ? (
        <div className="empty-card card-surface"><div className="empty-icon">◷</div><h2>回归集合还是空的</h2><p>把曾经手动验证过的输入存成用例。之后每次改规则，一键就能看出哪些场景的命中结果被破坏了。</p></div>
      ) : (
        <div className="regression-list">
          {filteredCases.map((testCase) => <CaseCard key={testCase.id} testCase={testCase} index={cases.indexOf(testCase)} fields={project?.fields ?? []} result={resultsById.get(testCase.id)} viewModel={viewModel} />)}
          {filter !== 'all' && filteredCases.length === 0 && <div className="empty-card card-surface"><div className="empty-icon">✓</div><h2>这个分组下没有用例</h2><p>切换到“全部”查看完整回归集合。</p></div>}
        </div>
      )}
      {report && report.changed + report.noMatch + report.invalidChanged + report.stale > 0 && <div className="regression-footnote">提示：命中变化的用例会列出新进来与退出命中的规则；“接受全部变化”会把当前命中固化为新的期望，待维护与非法输入用例不受影响。</div>}
    </section>
  );
}

function buildDraftInput(fields: RuleField[], fallback: Record<string, ScalarValue | ''>): Record<string, ScalarValue | ''> {
  const draft: Record<string, ScalarValue | ''> = {};
  for (const field of fields) {
    const current = fallback[field.id];
    if (current !== undefined) draft[field.id] = current;
    else draft[field.id] = field.type === 'number' ? field.min ?? 0 : field.type === 'enum' ? field.enumValues?.[0] ?? '' : false;
  }
  return draft;
}

function SummaryChip({ label, value, tone, active, onClick }: { label: string; value: number; tone: string; active: boolean; onClick: () => void }) {
  return <button className={`regression-chip chip-${tone}${active ? ' chip-active' : ''}${value === 0 ? ' chip-zero' : ''}`} onClick={onClick}><strong>{value}</strong><span>{label}</span></button>;
}

interface CaseCardProps {
  testCase: import('../../models/ruleModel').RegressionCase;
  index: number;
  fields: RuleField[];
  result?: RegressionCaseResult;
  viewModel: RegressionViewModel;
}

function CaseCard({ testCase, index, fields, result, viewModel }: CaseCardProps) {
  const meta = result ? statusMeta[result.status] : null;
  return (
    <article className={`regression-case card-surface${result ? ` case-${result.status}` : ''}`}>
      <header className="regression-case-header">
        <span className="regression-case-index">{String(index + 1).padStart(2, '0')}</span>
        <div className="regression-case-title">
          <input aria-label="用例名称" value={testCase.name} onChange={(event) => viewModel.renameCase(testCase.id, event.target.value)} />
          <span>{testCase.expectValid ? '合法输入用例' : '非法输入用例'} · 记录于 {formatTime(testCase.createdAt)}</span>
        </div>
        {meta && <span className={`regression-status status-${meta.tone}`}><i />{meta.label}</span>}
        <button className="icon-button danger-hover" aria-label={`删除用例${testCase.name}`} title="删除用例" onClick={() => viewModel.removeCase(testCase.id)}>×</button>
      </header>

      <div className="regression-case-body">
        <div className="regression-inputs">
          <span className="regression-block-label">具体输入</span>
          <div className="regression-field-grid">
            {fields.map((field) => <CaseInput key={field.id} field={field} value={testCase.input[field.id]} onChange={(value) => viewModel.setValue(testCase.id, field.id, value)} />)}
          </div>
          {Object.keys(testCase.input).filter((fieldId) => !fields.some((field) => field.id === fieldId)).length > 0 && (
            <div className="regression-extra-keys">含 {Object.keys(testCase.input).filter((fieldId) => !fields.some((field) => field.id === fieldId)).length} 个已删除字段的残留值</div>
          )}
        </div>

        <div className="regression-expect">
          {result ? <ResultDetail result={result} /> : <div className="regression-pending">尚未运行</div>}
        </div>
      </div>

      {result && (result.status === 'changed' || result.status === 'no-match' || result.status === 'invalid-changed') && (
        <footer className="regression-case-footer">
          <span>当前命中与记录不一致</span>
          <button className="text-button" onClick={() => viewModel.acceptCurrent(testCase.id)}>接受当前结果为新期望 →</button>
        </footer>
      )}
    </article>
  );
}

function ResultDetail({ result }: { result: RegressionCaseResult }) {
  if (result.status === 'stale') {
    return <div className="regression-stale-detail"><span className="regression-block-label">用例需要维护</span>{result.structuralIssues.map((issue) => <p key={`${issue.fieldId}-${issue.message}`}>! {issue.message}</p>)}</div>;
  }
  if (result.status === 'invalid-consistent') {
    return <div className="regression-invalid-detail"><span className="regression-block-label">输入不合法（与记录一致）</span>{result.inputErrors.map((error) => <p key={error}>! {error}</p>)}</div>;
  }
  if (result.status === 'invalid-changed') {
    return (
      <div className="regression-invalid-detail changed">
        <span className="regression-block-label">原记录为非法输入，现在可以通过校验</span>
        <RuleDiff expectedRules={result.expectedRules} actualRules={result.actualRules} enteredRules={result.enteredRules} exitedRules={result.exitedRules} />
      </div>
    );
  }
  return (
    <div className={`regression-diff${result.status === 'consistent' ? ' is-consistent' : ''}`}>
      <div className="regression-rule-columns">
        <RuleColumn label="记录的期望命中" rules={result.expectedRules} emptyText="记录为无任何规则命中" muted={result.status === 'no-match'} />
        <span className="regression-diff-arrow">→</span>
        <RuleColumn label="当前实际命中" rules={result.actualRules} emptyText="没有任何规则命中" highlight />
      </div>
      {(result.enteredRules.length > 0 || result.exitedRules.length > 0) && (
        <div className="regression-rule-delta">
          {result.enteredRules.length > 0 && <div className="delta-entered"><b>新进命中</b>{result.enteredRules.map((rule) => <span key={`in-${rule.id}`} className="delta-tag delta-in">＋ {formatRule(rule)}</span>)}</div>}
          {result.exitedRules.length > 0 && <div className="delta-exited"><b>退出命中</b>{result.exitedRules.map((rule) => <span key={`out-${rule.id}`} className="delta-tag delta-out">－ {formatRule(rule)}</span>)}</div>}
        </div>
      )}
    </div>
  );
}

function RuleDiff({ expectedRules, actualRules, enteredRules, exitedRules }: Pick<RegressionCaseResult, 'expectedRules' | 'actualRules' | 'enteredRules' | 'exitedRules'>) {
  return (
    <>
      <div className="regression-rule-columns">
        <RuleColumn label="记录的期望命中" rules={expectedRules} emptyText="记录为非法输入" muted />
        <span className="regression-diff-arrow">→</span>
        <RuleColumn label="当前实际命中" rules={actualRules} emptyText="没有任何规则命中" highlight />
      </div>
      {(enteredRules.length > 0 || exitedRules.length > 0) && (
        <div className="regression-rule-delta">
          {enteredRules.length > 0 && <div className="delta-entered"><b>新进命中</b>{enteredRules.map((rule) => <span key={`in-${rule.id}`} className="delta-tag delta-in">＋ {formatRule(rule)}</span>)}</div>}
          {exitedRules.length > 0 && <div className="delta-exited"><b>退出命中</b>{exitedRules.map((rule) => <span key={`out-${rule.id}`} className="delta-tag delta-out">－ {formatRule(rule)}</span>)}</div>}
        </div>
      )}
    </>
  );
}

function RuleColumn({ label, rules, emptyText, highlight, muted }: { label: string; rules: RegressionRuleExpectation[]; emptyText: string; highlight?: boolean; muted?: boolean }) {
  return (
    <div className={`rule-column${highlight ? ' rule-column-actual' : ''}${muted ? ' rule-column-muted' : ''}`}>
      <span className="regression-block-label">{label}</span>
      {rules.length ? <ol>{rules.map((rule, order) => <li key={`${rule.id}-${order}`}><em>{order === 0 ? '胜' : order + 1}</em><strong>{formatRule(rule)}</strong></li>)}</ol> : <p className="rule-column-empty">{emptyText}</p>}
    </div>
  );
}

interface CaseInputProps { field: RuleField; value: ScalarValue | '' | undefined; onChange: (value: ScalarValue | '') => void }

function CaseInput({ field, value, onChange }: CaseInputProps) {
  return (
    <label className="regression-field">
      <span>{field.name}<small>{field.type === 'number' ? `${field.min}–${field.max}` : field.type === 'enum' ? '枚举值' : '是 / 否'}</small></span>
      {field.type === 'number'
        ? <input type="number" min={field.min} max={field.max} value={typeof value === 'number' ? value : ''} onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))} />
        : field.type === 'enum'
          ? <select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}><option value="">（留空）</option>{(field.enumValues ?? []).map((item) => <option key={item} value={item}>{item}</option>)}</select>
          : <select value={typeof value === 'boolean' ? String(value) : ''} onChange={(event) => onChange(event.target.value === '' ? '' : event.target.value === 'true')}><option value="">（留空）</option><option value="true">是</option><option value="false">否</option></select>}
    </label>
  );
}

function formatRule(rule: RegressionRuleExpectation): string {
  return rule.name || rule.id;
}

function formatTime(time: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(time);
}
