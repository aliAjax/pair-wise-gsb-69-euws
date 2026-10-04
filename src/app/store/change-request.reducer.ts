import { createReducer, on } from '@ngrx/store';
import {
  ApprovalStage,
  ChangeRequest,
  APPROVAL_ORDER,
  createAudit,
} from '../models/change-request.model';
import {
  ackStep,
  confirmPendingStep,
  createLedger,
  dispatchStep,
  failPendingStep,
} from '../models/execution-ledger.model';
import { ChangeRequestActions } from './change-request.actions';

export interface ChangeRequestState {
  changes: ChangeRequest[];
  loading: boolean;
  error: string | null;
}

export const initialChangeRequestState: ChangeRequestState = {
  changes: [],
  loading: false,
  error: null,
};

function touch(change: ChangeRequest): ChangeRequest {
  return { ...change, updatedAt: new Date().toISOString() };
}

function nextPendingStage(change: ChangeRequest): ApprovalStage | null {
  return APPROVAL_ORDER.find((stage) =>
    change.approvals.some((approval) => approval.stage === stage && approval.state === 'pending'),
  ) ?? null;
}

export const changeRequestReducer = createReducer(
  initialChangeRequestState,
  on(ChangeRequestActions.loadChanges, (state) => ({ ...state, loading: true, error: null })),
  on(ChangeRequestActions.loadChangesSuccess, (state, { changes }) => ({
    ...state,
    changes,
    loading: false,
  })),
  on(ChangeRequestActions.loadChangesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(ChangeRequestActions.createChange, (state, { change }) => ({
    ...state,
    changes: [
      {
        ...change,
        audit: [createAudit('创建草稿', `创建变更 ${change.id}`), ...change.audit],
      },
      ...state.changes,
    ],
  })),
  on(ChangeRequestActions.updateChange, (state, { change }) => ({
    ...state,
    changes: state.changes.map((item) =>
      item.id === change.id
        ? touch({
            ...change,
            audit: [
              createAudit('保存变更方案', '更新资源、步骤或窗口信息'),
              ...change.audit,
            ],
          })
        : item,
    ),
  })),
  on(ChangeRequestActions.deleteDraft, (state, { id }) => ({
    ...state,
    changes: state.changes.filter((change) => change.id !== id || change.status !== 'draft'),
  })),
  on(ChangeRequestActions.submitForReview, (state, { id }) => ({
    ...state,
    changes: state.changes.map((change) =>
      change.id === id && ['draft', 'rejected'].includes(change.status)
        ? touch({
            ...change,
            status: 'submitted',
            approvals: change.approvals.map((approval) =>
              approval.stage === 'network'
                ? { ...approval, state: 'pending' }
                : { ...approval, state: 'pending' },
            ),
            audit: [createAudit('提交审批', '方案冻结后进入网络、系统、安全、业务顺序会签'), ...change.audit],
          })
        : change,
    ),
  })),
  on(ChangeRequestActions.approveStage, (state, { id, stage, approver, comment }) => ({
    ...state,
    changes: state.changes.map((change) => {
      if (change.id !== id || nextPendingStage(change) !== stage) {
        return change;
      }

      const approvals = change.approvals.map((approval) =>
        approval.stage === stage
          ? {
              ...approval,
              state: 'approved' as const,
              approver,
              comment,
              decidedAt: new Date().toISOString(),
            }
          : approval,
      );
      const allApproved = approvals.every((approval) =>
        approval.stage === stage ? true : approval.state === 'approved',
      );

      return touch({
        ...change,
        status: allApproved ? 'approved' : 'submitted',
        approvals,
        audit: [createAudit('阶段会签', `${stage} 已由 ${approver} 批准：${comment}`), ...change.audit],
      });
    }),
  })),
  on(ChangeRequestActions.rejectStage, (state, { id, stage, approver, comment }) => ({
    ...state,
    changes: state.changes.map((change) =>
      change.id === id
        ? touch({
            ...change,
            status: 'rejected',
            approvals: change.approvals.map((approval) =>
              approval.stage === stage
                ? {
                    ...approval,
                    state: 'rejected',
                    approver,
                    comment,
                    decidedAt: new Date().toISOString(),
                  }
                : approval,
            ),
            audit: [createAudit('审批退回', `${stage} 由 ${approver} 退回：${comment}`), ...change.audit],
          })
        : change,
    ),
  })),
  on(ChangeRequestActions.startExecution, (state, { id }) => ({
    ...state,
    changes: state.changes.map((change) => {
      if (change.id !== id || change.status !== 'approved') {
        return change;
      }
      const now = new Date().toISOString();
      // 建立可续接操作底账；此后所有前向步骤都经“待确认 → 回包确认”入账
      const started: ChangeRequest = {
        ...change,
        status: 'executing',
        approvals: change.approvals.map((approval) => ({ ...approval, state: 'frozen' })),
        ledger: createLedger(change, now),
        updatedAt: now,
        audit: [createAudit('开始执行', '审批记录已冻结，建立可续接执行底账'), ...change.audit],
      };
      return started;
    }),
  })),
  on(ChangeRequestActions.dispatchStep, (state, { id, stepId }) => ({
    ...state,
    changes: state.changes.map((change) => {
      if (change.id !== id) {
        return change;
      }
      return dispatchStep(change, stepId, new Date().toISOString()) ?? change;
    }),
  })),
  on(ChangeRequestActions.ackStep, (state, { id, stepId, ackAt }) => ({
    ...state,
    changes: state.changes.map((change) =>
      change.id === id ? ackStep(change, stepId, ackAt) ?? change : change,
    ),
  })),
  on(ChangeRequestActions.confirmPendingStep, (state, { id, stepId, actor }) => ({
    ...state,
    changes: state.changes.map((change) =>
      change.id === id
        ? confirmPendingStep(change, stepId, actor, new Date().toISOString()) ?? change
        : change,
    ),
  })),
  on(ChangeRequestActions.failPendingStep, (state, { id, stepId, reason, actor }) => ({
    ...state,
    changes: state.changes.map((change) =>
      change.id === id
        ? failPendingStep(change, stepId, reason, actor, new Date().toISOString()) ?? change
        : change,
    ),
  })),
  on(ChangeRequestActions.recordDeviation, (state, { id, deviation }) => ({
    ...state,
    changes: state.changes.map((change) =>
      change.id === id
        ? touch({
            ...change,
            deviations: [deviation, ...change.deviations],
            audit: [
              createAudit('记录执行偏离', `${deviation.owner}：${deviation.description}`),
              ...change.audit,
            ],
          })
        : change,
    ),
  })),
  on(ChangeRequestActions.completeExecution, (state, { id, result, note }) => ({
    ...state,
    changes: state.changes.map((change) => {
      if (change.id !== id || change.status !== 'executing') {
        return change;
      }
      // 底账已记录失败时不允许判定“完成”，只能落到已回滚
      const effectiveResult = change.ledger?.failure && result === 'completed' ? 'rolled_back' : result;
      return touch({
        ...change,
        status: effectiveResult,
        audit: [
          createAudit(effectiveResult === 'completed' ? '执行完成' : '执行回滚', note),
          ...change.audit,
        ],
      });
    }),
  })),
);
