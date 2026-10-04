import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of, tap, timer } from 'rxjs';
import { ChangeRequest } from '../models/change-request.model';

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

  /**
   * 模拟弱网机房的命令网关：回包延迟到达。
   * 页面在回包前崩溃或刷新则回包丢失，待确认底账已持久化，
   * 重开后由值班人员补成或标记失败。
   */
  sendCommand(changeId: string, stepId: string): Observable<{ changeId: string; stepId: string }> {
    return timer(1500).pipe(map(() => ({ changeId, stepId })));
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
      '## 审计轨迹',
      ...change.audit.map(
        (item) => `- ${item.timestamp} ${item.actor} ${item.action}：${item.detail}`,
      ),
    ];
    return lines.join('\n');
  }
}
