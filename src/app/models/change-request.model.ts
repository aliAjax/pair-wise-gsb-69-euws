export type ChangeStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'rolled_back'
  | 'rejected';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ResourceType = 'datacenter' | 'rack' | 'network' | 'storage' | 'service';
export type ApprovalStage = 'network' | 'system' | 'security' | 'business';
export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'frozen';
export type StepPhase = 'prepare' | 'execute' | 'verify' | 'rollback';
export type IssueSeverity = 'blocker' | 'warning' | 'info';

/**
 * 操作底账条目状态：
 * - pending：已勾选下发，等待命令回包
 * - confirmed：回包到达（或人工补成），记为完成
 * - failed：人工标记失败
 */
export type LedgerEntryStatus = 'pending' | 'confirmed' | 'failed';

/** 步骤在底账中的呈现状态；legacy 表示旧记录没有底账，只读展示。 */
export type StepLedgerState = 'legacy' | 'idle' | LedgerEntryStatus;

/**
 * 操作底账条目。一次勾选对应一条待确认记录，
 * 回包到达才把同一条目转为 confirmed；字段保持精简，不堆砌冗余耗时。
 */
export interface OperationLedgerEntry {
  id: string;
  stepId: string;
  status: LedgerEntryStatus;
  requestedAt: string;
  confirmedAt?: string;
}

export interface ChangeResource {
  id: string;
  name: string;
  type: ResourceType;
  critical: boolean;
  dependencies: string[];
}

export interface ChangeStep {
  id: string;
  phase: StepPhase;
  title: string;
  owner: string;
  durationMinutes: number;
  command: string;
  completed: boolean;
  completedAt?: string;
}

export interface ChangeWindow {
  start: string;
  end: string;
  observationWindowMinutes: number;
  blackoutProtected: boolean;
}

export interface ApprovalRecord {
  stage: ApprovalStage;
  state: ApprovalState;
  approver?: string;
  decidedAt?: string;
  comment?: string;
}

export interface DeviationRecord {
  id: string;
  recordedAt: string;
  owner: string;
  description: string;
  decision: 'continue' | 'pause' | 'rollback';
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  detail: string;
}

export interface ChangeRequest {
  id: string;
  title: string;
  summary: string;
  owner: string;
  onCall: string[];
  status: ChangeStatus;
  risk: RiskLevel;
  resources: ChangeResource[];
  steps: ChangeStep[];
  window: ChangeWindow;
  approvals: ApprovalRecord[];
  deviations: DeviationRecord[];
  audit: AuditRecord[];
  /** 操作底账；旧记录没有该字段，只读展示，不当作已执行完。 */
  ledger?: OperationLedgerEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ValidationIssue {
  id: string;
  changeId: string;
  severity: IssueSeverity;
  code:
    | 'DEPENDENCY_MISSING'
    | 'WINDOW_CONFLICT'
    | 'ROLLBACK_UNEXECUTABLE'
    | 'OBSERVATION_TOO_SHORT'
    | 'OWNER_MISSING';
  title: string;
  detail: string;
  suggestedAction: string;
  relatedId?: string;
}

export const APPROVAL_ORDER: ApprovalStage[] = ['network', 'system', 'security', 'business'];

export const STATUS_LABELS: Record<ChangeStatus, string> = {
  draft: '草稿',
  submitted: '待会签',
  approved: '已批准',
  executing: '执行中',
  completed: '已完成',
  rolled_back: '已回滚',
  rejected: '已退回',
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
};

export const RESOURCE_LABELS: Record<ResourceType, string> = {
  datacenter: '机房',
  rack: '机柜',
  network: '网络',
  storage: '存储',
  service: '服务',
};

export const STAGE_LABELS: Record<ApprovalStage, string> = {
  network: '网络负责人',
  system: '系统负责人',
  security: '安全负责人',
  business: '业务负责人',
};

export const PHASE_LABELS: Record<StepPhase, string> = {
  prepare: '准备',
  execute: '执行',
  verify: '验证',
  rollback: '回滚',
};

export function createEmptyApprovals(): ApprovalRecord[] {
  return APPROVAL_ORDER.map((stage) => ({ stage, state: 'pending' }));
}

export function createEmptyChange(): ChangeRequest {
  const now = new Date();
  const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

  return {
    id: `CHG-${Math.floor(1000 + Math.random() * 9000)}`,
    title: '',
    summary: '',
    owner: '',
    onCall: [],
    status: 'draft',
    risk: 'medium',
    resources: [],
    steps: [],
    window: {
      start: toLocalInputValue(start),
      end: toLocalInputValue(end),
      observationWindowMinutes: 30,
      blackoutProtected: false,
    },
    approvals: createEmptyApprovals(),
    deviations: [],
    audit: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function isWindowOverlapping(left: ChangeWindow, right: ChangeWindow): boolean {
  const leftStart = new Date(left.start).getTime();
  const leftEnd = new Date(left.end).getTime();
  const rightStart = new Date(right.start).getTime();
  const rightEnd = new Date(right.end).getTime();
  return leftStart < rightEnd && rightStart < leftEnd;
}

export function validateChange(change: ChangeRequest, allChanges: ChangeRequest[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const resourceMap = new Map(change.resources.map((resource) => [resource.id, resource]));

  change.resources.forEach((resource) => {
    resource.dependencies
      .filter((dependencyId) => !resourceMap.has(dependencyId))
      .forEach((dependencyId) => {
        issues.push({
          id: `${change.id}-dependency-${resource.id}-${dependencyId}`,
          changeId: change.id,
          severity: 'blocker',
          code: 'DEPENDENCY_MISSING',
          title: `缺少依赖对象 ${dependencyId}`,
          detail: `${resource.name} 依赖 ${dependencyId}，但该对象未纳入本次变更范围。`,
          suggestedAction: '补充依赖对象，或提供不在范围内的书面依据。',
          relatedId: dependencyId,
        });
      });
  });

  allChanges
    .filter(
      (candidate) =>
        candidate.id !== change.id &&
        !['draft', 'rejected', 'rolled_back'].includes(candidate.status) &&
        isWindowOverlapping(change.window, candidate.window),
    )
    .forEach((candidate) => {
      const shared = change.resources.filter((resource) =>
        candidate.resources.some((candidateResource) => candidateResource.id === resource.id),
      );
      if (shared.length > 0) {
        issues.push({
          id: `${change.id}-conflict-${candidate.id}`,
          changeId: change.id,
          severity: 'blocker',
          code: 'WINDOW_CONFLICT',
          title: `与 ${candidate.id} 存在窗口冲突`,
          detail: `共享资源：${shared.map((resource) => resource.name).join('、')}。两项变更的执行窗口发生重叠。`,
          suggestedAction: '调整窗口、串行等待，或将冲突资源移出本次范围。',
          relatedId: candidate.id,
        });
      }
    });

  change.steps
    .filter((step) => step.phase === 'rollback' && (!step.command.trim() || !step.owner.trim()))
    .forEach((step) => {
      issues.push({
        id: `${change.id}-rollback-${step.id}`,
        changeId: change.id,
        severity: 'blocker',
        code: 'ROLLBACK_UNEXECUTABLE',
        title: `回滚步骤“${step.title || '未命名'}”不可执行`,
        detail: '回滚步骤必须包含明确命令或操作说明，并指定责任人。',
        suggestedAction: '补齐回滚命令和责任人后重新校验。',
        relatedId: step.id,
      });
    });

  change.resources
    .filter((resource) => resource.type === 'service' && resource.critical)
    .forEach((resource) => {
      if (change.window.observationWindowMinutes < 30) {
        issues.push({
          id: `${change.id}-observation-${resource.id}`,
          changeId: change.id,
          severity: 'warning',
          code: 'OBSERVATION_TOO_SHORT',
          title: `${resource.name} 观察窗口不足`,
          detail: '关键服务建议至少保留 30 分钟观察窗口。',
          suggestedAction: '延长观察窗口，并由业务负责人签署风险接受记录。',
          relatedId: resource.id,
        });
      }
    });

  if (!change.owner.trim() || change.onCall.length === 0) {
    issues.push({
      id: `${change.id}-owner`,
      changeId: change.id,
      severity: 'blocker',
      code: 'OWNER_MISSING',
      title: '缺少变更责任人',
      detail: '变更负责人与值守人员均不能为空。',
      suggestedAction: '指定变更负责人和至少一名值守人员。',
    });
  }

  return issues;
}

export function createAudit(
  action: string,
  detail: string,
  actor = '当前用户',
): AuditRecord {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    actor,
    action,
    detail,
  };
}

export const LEDGER_STATE_LABELS: Record<StepLedgerState, string> = {
  legacy: '无底账',
  idle: '未下发',
  pending: '待确认',
  confirmed: '已确认',
  failed: '已失败',
};

/** 取某步骤最新一条底账（底账是追加式流水，同一步骤可能有多条）。 */
export function latestLedgerEntry(
  ledger: OperationLedgerEntry[],
  stepId: string,
): OperationLedgerEntry | undefined {
  for (let index = ledger.length - 1; index >= 0; index -= 1) {
    if (ledger[index].stepId === stepId) {
      return ledger[index];
    }
  }
  return undefined;
}

export interface LedgerTransition {
  ledger: OperationLedgerEntry[];
  entry: OperationLedgerEntry;
}

function replaceLedgerEntry(
  ledger: OperationLedgerEntry[],
  entry: OperationLedgerEntry,
): OperationLedgerEntry[] {
  return ledger.map((item) => (item.id === entry.id ? entry : item));
}

/** 勾选下发：留下待确认条目；已有待确认条目时返回 null，重复勾选不多记。 */
export function requestEntry(
  ledger: OperationLedgerEntry[],
  stepId: string,
  entryId: string,
  requestedAt: string,
): LedgerTransition | null {
  if (latestLedgerEntry(ledger, stepId)?.status === 'pending') {
    return null;
  }
  const entry: OperationLedgerEntry = { id: entryId, stepId, status: 'pending', requestedAt };
  return { ledger: [...ledger, entry], entry };
}

/** 回包确认：只作用于待确认条目；重复回包或无待发记录返回 null，只认第一次。 */
export function confirmEntry(
  ledger: OperationLedgerEntry[],
  stepId: string,
  confirmedAt: string,
): LedgerTransition | null {
  const latest = latestLedgerEntry(ledger, stepId);
  if (!latest || latest.status !== 'pending') {
    return null;
  }
  const entry: OperationLedgerEntry = { ...latest, status: 'confirmed', confirmedAt };
  return { ledger: replaceLedgerEntry(ledger, entry), entry };
}

/** 人工处置：重开后对待确认条目补成或标记失败；非待确认条目返回 null。 */
export function resolveEntry(
  ledger: OperationLedgerEntry[],
  stepId: string,
  resolution: 'confirmed' | 'failed',
  resolvedAt: string,
): LedgerTransition | null {
  const latest = latestLedgerEntry(ledger, stepId);
  if (!latest || latest.status !== 'pending') {
    return null;
  }
  const entry: OperationLedgerEntry =
    resolution === 'confirmed'
      ? { ...latest, status: 'confirmed', confirmedAt: resolvedAt }
      : { ...latest, status: 'failed' };
  return { ledger: replaceLedgerEntry(ledger, entry), entry };
}

export function stepLedgerState(change: ChangeRequest, stepId: string): StepLedgerState {
  if (!change.ledger) {
    return 'legacy';
  }
  return latestLedgerEntry(change.ledger, stepId)?.status ?? 'idle';
}

export function hasPendingLedger(change: ChangeRequest): boolean {
  return (change.ledger ?? []).some((entry) => entry.status === 'pending');
}

export function hasFailedLedger(change: ChangeRequest): boolean {
  return (change.ledger ?? []).some((entry) => entry.status === 'failed');
}

export function confirmedStepCount(change: ChangeRequest): number {
  const ledger = change.ledger;
  if (!ledger) {
    return 0;
  }
  return change.steps.filter((step) => latestLedgerEntry(ledger, step.id)?.status === 'confirmed')
    .length;
}

export function pendingStepCount(change: ChangeRequest): number {
  return (change.ledger ?? []).filter((entry) => entry.status === 'pending').length;
}

export interface RollbackPlanItem {
  stepId: string;
  title: string;
  owner: string;
  confirmedAt: string;
}

export interface RollbackPlan {
  /** 已确认的执行类动作，按确认时间从后往前排列。 */
  items: RollbackPlanItem[];
  /** 方案预定义的回滚步骤，按定义顺序。 */
  rollbackSteps: ChangeStep[];
}

/**
 * 生成回滚顺序：以每个步骤最新底账为准，仅纳入已确认的执行类动作，
 * 从后往前排列；准备动作与未执行（未下发/待确认/已失败）动作不混入。
 */
export function buildRollbackPlan(change: ChangeRequest): RollbackPlan {
  const ledger = change.ledger ?? [];
  const items = change.steps
    .map((step, stepIndex) => ({ step, stepIndex, entry: latestLedgerEntry(ledger, step.id) }))
    .filter(
      (
        candidate,
      ): candidate is { step: ChangeStep; stepIndex: number; entry: OperationLedgerEntry } =>
        candidate.entry !== undefined &&
        candidate.entry.status === 'confirmed' &&
        candidate.step.phase === 'execute',
    )
    .sort((left, right) => {
      const byConfirmedAt = (right.entry.confirmedAt ?? '').localeCompare(
        left.entry.confirmedAt ?? '',
      );
      return byConfirmedAt !== 0 ? byConfirmedAt : right.stepIndex - left.stepIndex;
    })
    .map(({ step, entry }) => ({
      stepId: step.id,
      title: step.title,
      owner: step.owner,
      confirmedAt: entry.confirmedAt ?? '',
    }));

  return {
    items,
    rollbackSteps: change.steps.filter((step) => step.phase === 'rollback'),
  };
}
