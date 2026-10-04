import {
  ChangeRequest,
  ChangeStep,
  StepPhase,
  createAudit,
} from './change-request.model';

/**
 * 底账条目的状态：
 * - pending   勾选后已下发命令、等待回包确认（弱网崩溃重开后仍停留于此）
 * - confirmed 回包到达（或值守人员人工补记），动作才算真正完成
 * - failed    待确认动作经核实标记为失败
 */
export type LedgerEntryStatus = 'pending' | 'confirmed' | 'failed';

export type LedgerConfirmSource = 'ack' | 'manual';

export interface LedgerDispatchRecord {
  at: string;
}

export interface ExecutionLedgerEntry {
  stepId: string;
  phase: StepPhase;
  /** 下发时的命令快照，重开后可凭此核对回包归属 */
  command: string;
  status: LedgerEntryStatus;
  dispatchedAt: string;
  /** 下发次数，初次下发为 1，失败重发后递增 */
  dispatchAttempts: number;
  dispatchHistory: LedgerDispatchRecord[];
  /** 回包实际到达时间（人工补记时与确认时间相同） */
  ackReceivedAt?: string;
  confirmedAt?: string;
  confirmSource?: LedgerConfirmSource;
  /** 只在确认时计算一次，重复回包不多记 */
  durationMs?: number;
  failedAt?: string;
  failureReason?: string;
}

export interface ExecutionLedger {
  changeId: string;
  startedAt: string;
  /** 一个前向步骤只对应一条底账；回滚步骤不入底账 */
  entries: ExecutionLedgerEntry[];
  failure: {
    stepId: string;
    reason: string;
    failedAt: string;
  } | null;
}

export interface RollbackPlanItem {
  order: number;
  stepId: string;
  phase: StepPhase;
  title: string;
  /** 已确认动作执行完成的时间，用于倒序排列 */
  confirmedAt: string;
  durationMs?: number;
  rollbackStepId?: string;
  rollbackTitle?: string;
  rollbackCommand?: string;
  rollbackOwner?: string;
}

export function createLedger(change: ChangeRequest, startedAt: string): ExecutionLedger {
  return {
    changeId: change.id,
    startedAt,
    entries: [],
    failure: null,
  };
}

export function getLedgerEntry(
  change: ChangeRequest,
  stepId: string,
): ExecutionLedgerEntry | undefined {
  return change.ledger?.entries.find((entry) => entry.stepId === stepId);
}

/**
 * 旧记录（底账功能上线前产生、或从未开始执行就带有历史勾选）没有底账，
 * 其 step.completed 只能只读展示，不能当作已确认执行。
 */
export function isLegacyExecution(change: ChangeRequest): boolean {
  return (
    !change.ledger &&
    ['executing', 'completed', 'rolled_back'].includes(change.status)
  );
}

export type StepExecutionState =
  | 'confirmed'
  | 'pending'
  | 'failed'
  | 'legacy'
  | 'idle';

export function getStepExecutionState(
  change: ChangeRequest,
  step: ChangeStep,
): StepExecutionState {
  if (change.ledger) {
    const entry = getLedgerEntry(change, step.id);
    return entry ? entry.status : 'idle';
  }
  if (isLegacyExecution(change) && step.completed) {
    return 'legacy';
  }
  return 'idle';
}

/**
 * 生成失败后的回滚顺序：
 * 仅取已确认（confirmed）的前向动作，按确认时间从后往前排列；
 * 准备阶段（prepare）与未执行/待确认/失败动作一律不混入。
 */
export function buildRollbackPlan(change: ChangeRequest): RollbackPlanItem[] {
  if (!change.ledger) {
    return [];
  }

  const stepMap = new Map(change.steps.map((step) => [step.id, step]));
  const rollbackSteps = change.steps.filter((step) => step.phase === 'rollback');

  return change.ledger.entries
    .filter(
      (entry) => entry.status === 'confirmed' && entry.phase !== 'prepare',
    )
    .sort((left, right) =>
      (right.confirmedAt ?? '').localeCompare(left.confirmedAt ?? ''),
    )
    .map((entry, index) => {
      const step = stepMap.get(entry.stepId);
      const rollbackStep =
        rollbackSteps.find((candidate) => candidate.revertStepId === entry.stepId) ??
        undefined;

      return {
        order: index + 1,
        stepId: entry.stepId,
        phase: entry.phase,
        title: step?.title ?? entry.stepId,
        confirmedAt: entry.confirmedAt ?? '',
        durationMs: entry.durationMs,
        rollbackStepId: rollbackStep?.id,
        rollbackTitle: rollbackStep?.title,
        rollbackCommand: rollbackStep?.command,
        rollbackOwner: rollbackStep?.owner,
      };
    });
}

export function formatDuration(durationMs?: number): string {
  if (durationMs === undefined) {
    return '-';
  }
  if (durationMs < 1000) {
    return `${durationMs} 毫秒`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} 秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return `${minutes} 分 ${restSeconds} 秒`;
}

const FORWARD_PHASES: StepPhase[] = ['prepare', 'execute', 'verify'];

function syncStepCompleted(change: ChangeRequest): ChangeStep[] {
  return change.steps.map((step) => {
    const entry = change.ledger?.entries.find((item) => item.stepId === step.id);
    const completed = entry?.status === 'confirmed';
    if (completed === step.completed) {
      return step;
    }
    return {
      ...step,
      completed,
      completedAt: completed ? entry?.confirmedAt : undefined,
    };
  });
}

/** 在底账变更后同步步骤勾选态，供旧的完成数统计/导出继续工作 */
export function withLedger(
  change: ChangeRequest,
  ledger: ExecutionLedger,
  now: string,
): ChangeRequest {
  const next: ChangeRequest = { ...change, ledger, updatedAt: now };
  return { ...next, steps: syncStepCompleted(next) };
}

/**
 * 勾选步骤：前向步骤、尚无底账条目时才允许下发。
 * 只留下“待确认”动作，不写审计、不记耗时。
 */
export function dispatchStep(
  change: ChangeRequest,
  stepId: string,
  now: string,
): ChangeRequest | null {
  if (change.status !== 'executing' || !change.ledger || change.ledger.failure) {
    return null;
  }
  const step = change.steps.find((item) => item.id === stepId);
  if (!step || !FORWARD_PHASES.includes(step.phase)) {
    return null;
  }
  if (change.ledger.entries.some((entry) => entry.stepId === stepId)) {
    return null;
  }

  const entry: ExecutionLedgerEntry = {
    stepId,
    phase: step.phase,
    command: step.command,
    status: 'pending',
    dispatchedAt: now,
    dispatchAttempts: 1,
    dispatchHistory: [{ at: now }],
  };
  return withLedger(
    change,
    { ...change.ledger, entries: [...change.ledger.entries, entry] },
    now,
  );
}

/**
 * 回包到达：待确认 → 已确认，记录回包时间和一次性耗时；
 * 已确认/失败的条目收到重复回包一律忽略（只认第一次）。
 */
export function ackStep(
  change: ChangeRequest,
  stepId: string,
  ackAt: string,
): ChangeRequest | null {
  if (!change.ledger) {
    return null;
  }
  const entry = change.ledger.entries.find((item) => item.stepId === stepId);
  if (!entry || entry.status !== 'pending') {
    return null;
  }

  const confirmedEntry: ExecutionLedgerEntry = {
    ...entry,
    status: 'confirmed',
    ackReceivedAt: ackAt,
    confirmedAt: ackAt,
    confirmSource: 'ack',
    durationMs: Math.max(0, new Date(ackAt).getTime() - new Date(entry.dispatchedAt).getTime()),
  };
  const step = change.steps.find((item) => item.id === stepId);
  const audited = {
    ...change,
    audit: [
      createAudit('命令回包确认', `步骤“${step?.title ?? stepId}”回包到达，动作确认完成`),
      ...change.audit,
    ],
  };
  return withLedger(
    audited,
    {
      ...change.ledger,
      entries: change.ledger.entries.map((item) =>
        item.stepId === stepId ? confirmedEntry : item,
      ),
    },
    ackAt,
  );
}

/** 重开后续接：人工把待确认动作补记为完成，需留下人工补记审计 */
export function confirmPendingStep(
  change: ChangeRequest,
  stepId: string,
  actor: string,
  now: string,
): ChangeRequest | null {
  if (!change.ledger) {
    return null;
  }
  const entry = change.ledger.entries.find((item) => item.stepId === stepId);
  if (!entry || entry.status !== 'pending') {
    return null;
  }

  const confirmedEntry: ExecutionLedgerEntry = {
    ...entry,
    status: 'confirmed',
    confirmedAt: now,
    confirmSource: 'manual',
  };
  const step = change.steps.find((item) => item.id === stepId);
  const audited = {
    ...change,
    audit: [
      createAudit(
        '待确认动作补记完成',
        `步骤“${step?.title ?? stepId}”未见回包，值守人员经核实补记为完成`,
        actor,
      ),
      ...change.audit,
    ],
  };
  return withLedger(
    audited,
    {
      ...change.ledger,
      entries: change.ledger.entries.map((item) =>
        item.stepId === stepId ? confirmedEntry : item,
      ),
    },
    now,
  );
}

/** 重开后续接：把待确认动作标记为失败并冻结执行，随后按已确认动作倒序回滚 */
export function failPendingStep(
  change: ChangeRequest,
  stepId: string,
  reason: string,
  actor: string,
  now: string,
): ChangeRequest | null {
  if (!change.ledger || change.ledger.failure) {
    return null;
  }
  const entry = change.ledger.entries.find((item) => item.stepId === stepId);
  if (!entry || entry.status !== 'pending') {
    return null;
  }

  const failedEntry: ExecutionLedgerEntry = {
    ...entry,
    status: 'failed',
    failedAt: now,
    failureReason: reason,
  };
  const step = change.steps.find((item) => item.id === stepId);
  const audited = {
    ...change,
    audit: [
      createAudit(
        '待确认动作标记失败',
        `步骤“${step?.title ?? stepId}”标记失败：${reason}；按已确认动作从后往前生成回滚顺序`,
        actor,
      ),
      ...change.audit,
    ],
  };
  return withLedger(
    audited,
    {
      ...change.ledger,
      entries: change.ledger.entries.map((item) =>
        item.stepId === stepId ? failedEntry : item,
      ),
      failure: { stepId, reason, failedAt: now },
    },
    now,
  );
}

