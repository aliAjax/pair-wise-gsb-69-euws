import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { EMPTY, catchError, concatMap, delay, map, of, switchMap, tap, withLatestFrom } from 'rxjs';
import { ChangeRequestService } from '../services/change-request.service';
import { ChangeRequestActions } from './change-request.actions';
import { selectAllChanges } from './change-request.selectors';

@Injectable()
export class ChangeRequestEffects {
  private readonly actions$ = inject(Actions);
  private readonly service = inject(ChangeRequestService);
  private readonly store = inject(Store);

  loadChanges$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChangeRequestActions.loadChanges),
      switchMap(() =>
        this.service.load().pipe(
          map((changes) => ChangeRequestActions.loadChangesSuccess({ changes })),
          catchError((error: unknown) =>
            of(
              ChangeRequestActions.loadChangesFailure({
                error: error instanceof Error ? error.message : '变更数据加载失败',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  // 弱网模拟：勾选下发后回包延迟到达；约三成回包丢失，值守人员重开页面后
  // 该动作仍是“待确认”，可人工补记完成或标记失败。reducer 对重复回包幂等。
  simulateCommandAck$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChangeRequestActions.dispatchStep),
      withLatestFrom(this.store.select(selectAllChanges)),
      concatMap(([{ id, stepId }, changes]) => {
        const change = changes.find((item) => item.id === id);
        const entry = change?.ledger?.entries.find((item) => item.stepId === stepId);
        if (!entry) {
          return EMPTY;
        }
        if (Math.random() < 0.3) {
          return EMPTY;
        }
        const latencyMs = 1200 + Math.random() * 2600;
        return of(ChangeRequestActions.ackStep({
          id,
          stepId,
          ackAt: new Date().toISOString(),
        })).pipe(delay(latencyMs));
      }),
    ),
  );

  persistChanges$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          ChangeRequestActions.createChange,
          ChangeRequestActions.updateChange,
          ChangeRequestActions.deleteDraft,
          ChangeRequestActions.submitForReview,
          ChangeRequestActions.approveStage,
          ChangeRequestActions.rejectStage,
          ChangeRequestActions.startExecution,
          ChangeRequestActions.dispatchStep,
          ChangeRequestActions.ackStep,
          ChangeRequestActions.confirmPendingStep,
          ChangeRequestActions.failPendingStep,
          ChangeRequestActions.recordDeviation,
          ChangeRequestActions.completeExecution,
        ),
        withLatestFrom(this.store.select(selectAllChanges)),
        tap(([, changes]) => this.service.save(changes)),
      ),
    { dispatch: false },
  );
}
