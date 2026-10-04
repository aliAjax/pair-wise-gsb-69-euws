import { createActionGroup, emptyProps, props } from '@ngrx/store';
import {
  ApprovalStage,
  ChangeRequest,
  DeviationRecord,
} from '../models/change-request.model';

export const ChangeRequestActions = createActionGroup({
  source: 'Change Request',
  events: {
    'Load Changes': emptyProps(),
    'Load Changes Success': props<{ changes: ChangeRequest[] }>(),
    'Load Changes Failure': props<{ error: string }>(),
    'Create Change': props<{ change: ChangeRequest }>(),
    'Update Change': props<{ change: ChangeRequest }>(),
    'Delete Draft': props<{ id: string }>(),
    'Submit For Review': props<{ id: string }>(),
    'Approve Stage': props<{ id: string; stage: ApprovalStage; approver: string; comment: string }>(),
    'Reject Stage': props<{ id: string; stage: ApprovalStage; approver: string; comment: string }>(),
    'Start Execution': props<{ id: string }>(),
    /** 勾选步骤：只在底账留下待确认动作，不记完成、不记耗时、不记审计 */
    'Dispatch Step': props<{ id: string; stepId: string }>(),
    /** 命令回包到达：待确认动作记完成；重复回包只认第一次 */
    'Ack Step': props<{ id: string; stepId: string; ackAt: string }>(),
    /** 重开后续接：把仍待确认的动作人工补记为完成 */
    'Confirm Pending Step': props<{ id: string; stepId: string; actor: string }>(),
    /** 重开后续接：把仍待确认的动作标记为失败，并进入回滚顺序生成 */
    'Fail Pending Step': props<{ id: string; stepId: string; reason: string; actor: string }>(),
    'Record Deviation': props<{ id: string; deviation: DeviationRecord }>(),
    'Complete Execution': props<{ id: string; result: 'completed' | 'rolled_back'; note: string }>(),
  },
});
