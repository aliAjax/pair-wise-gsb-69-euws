import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, of, tap } from 'rxjs';
import { ChangeRequest } from '../models/change-request.model';
import {
  buildRollbackPlan,
  formatDuration,
  isLegacyExecution,
} from '../models/execution-ledger.model';

const STORAGE_KEY = 'pair-wise-gsb-69-changes';

@Injectable({ providedIn: 'root' })
export class ChangeRequestService {
  private readonly http = inject(HttpClient);

  load(): Observable<ChangeRequest[]> {
    const localValue = localStorage.getItem(STORAGE_KEY);
    if (localValue) {
      try {
        return of(JSON.parse(localValue) as ChangeRequest[]);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    return this.http.get<ChangeRequest[]>('/mock/change-requests.json').pipe(
      tap((changes) => this.save(changes)),
      catchError((error: unknown) => {
        console.error('Failed to load change requests', error);
        return of([]);
      }),
    );
  }

  save(changes: ChangeRequest[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changes));
  }

  exportRetrospective(change: ChangeRequest): string {
    const lines = [
      `# ${change.id} ${change.title} 复盘记录`,
      '',
      `状态：${change.status}`,
      `负责人：${change.owner}`,
      `窗口：${change.window.start} - ${change.window.end}`,
      `风险等级：${change.risk}`,
      '',
      '## 执行偏离',
      ...(change.deviations.length
        ? change.deviations.map(
            (item) =>
              `- ${item.recordedAt} ${item.owner} [${item.decision}] ${item.description}`,
          )
        : ['- 无']),
      '',
    ];

    if (change.ledger) {
      lines.push('## 执行底账（可续接）');
      change.ledger.entries.forEach((entry) => {
        const stateText =
          entry.status === 'confirmed'
            ? `${entry.confirmSource === 'manual' ? '人工补记完成' : '回包确认完成'}（耗时 ${formatDuration(entry.durationMs)}）`
            : entry.status === 'failed'
              ? `标记失败：${entry.failureReason}`
              : '待确认（未收到回包）';
        lines.push(
          `- [${entry.phase}] ${entry.stepId} 下发 ${entry.dispatchedAt} → ${stateText}`,
        );
      });
      lines.push('');

      if (change.ledger.failure) {
        lines.push('## 回滚顺序（已确认动作，从后往前）');
        const plan = buildRollbackPlan(change);
        if (plan.length) {
          plan.forEach((item) => {
            lines.push(
              `${item.order}. 撤销「${item.title}」` +
                (item.rollbackCommand ? `：${item.rollbackCommand}` : '（方案未关联回滚步骤，需人工处置）'),
            );
          });
        } else {
          lines.push('- 没有需要回滚的已确认动作（准备与未执行动作不计入）');
        }
        lines.push('');
      }
    } else if (isLegacyExecution(change)) {
      lines.push('## 执行底账');
      lines.push('- 旧记录无底账，历史勾选只读展示，不作为已确认执行依据。');
      lines.push('');
    }

    lines.push(
      '## 审计轨迹',
      ...change.audit.map(
        (item) => `- ${item.timestamp} ${item.actor} ${item.action}：${item.detail}`,
      ),
    );
    return lines.join('\n');
  }
}
