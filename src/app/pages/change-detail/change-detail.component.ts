import { DatePipe, NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ClarityModule } from '@clr/angular';
import { Store } from '@ngrx/store';
import { AuditTrailComponent } from '../../components/audit-trail/audit-trail.component';
import { DependencyGraphComponent } from '../../components/dependency-graph/dependency-graph.component';
import { ValidationPanelComponent } from '../../components/validation-panel/validation-panel.component';
import { WindowGanttComponent } from '../../components/window-gantt/window-gantt.component';
import {
  ApprovalStage,
  ChangeRequest,
  ChangeStep,
  DeviationRecord,
  PHASE_LABELS,
  RESOURCE_LABELS,
  RISK_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
  validateChange,
} from '../../models/change-request.model';
import {
  ExecutionLedgerEntry,
  RollbackPlanItem,
  StepExecutionState,
  buildRollbackPlan,
  formatDuration,
  getStepExecutionState,
  isLegacyExecution,
} from '../../models/execution-ledger.model';
import { ChangeRequestService } from '../../services/change-request.service';
import { ChangeRequestActions } from '../../store/change-request.actions';
import { selectAllChanges } from '../../store/change-request.selectors';

type DetailTab = 'overview' | 'dependency' | 'window' | 'execution' | 'approval' | 'audit';

@Component({
  selector: 'app-change-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    NgClass,
    FormsModule,
    RouterLink,
    ClarityModule,
    AuditTrailComponent,
    DependencyGraphComponent,
    ValidationPanelComponent,
    WindowGanttComponent,
  ],
  template: `
    @if (change(); as item) {
      <section class="detail-heading">
        <div class="heading-main">
          <a routerLink="/" class="back-link">返回变更队列</a>
          <div class="title-row">
            <div>
              <span class="change-id">{{ item.id }}</span>
              <h1>{{ item.title }}</h1>
            </div>
            <span class="status" [class]="item.status">{{ statusLabel(item.status) }}</span>
          </div>
          <p>{{ item.summary || '尚未填写变更摘要。' }}</p>
        </div>
        <div class="heading-meta">
          <div>
            <span>负责人</span>
            <strong>{{ item.owner }}</strong>
          </div>
          <div>
            <span>风险</span>
            <strong>{{ riskLabel(item.risk) }}</strong>
          </div>
          <div>
            <span>更新</span>
            <strong>{{ item.updatedAt | date: 'MM-dd HH:mm' }}</strong>
          </div>
        </div>
      </section>

      <nav class="tab-nav" aria-label="变更详情">
        @for (tab of tabs; track tab.id) {
          <button
            type="button"
            [class.active]="selectedTab() === tab.id"
            (click)="selectedTab.set(tab.id)"
          >
            {{ tab.label }}
            @if (tab.id === 'approval' && pendingStage(); as stage) {
              <span class="nav-badge">{{ stageLabel(stage) }}</span>
            }
          </button>
        }
      </nav>

      @switch (selectedTab()) {
        @case ('overview') {
          <div class="content-grid">
            <section class="surface">
              <div class="surface-heading">
                <div>
                  <h2>方案概览</h2>
                  <span>影响范围、值班和执行边界</span>
                </div>
                <button
                  class="btn btn-sm"
                  type="button"
                  (click)="editing() ? cancelEdit() : beginEdit()"
                  [disabled]="item.status === 'executing' || item.status === 'completed'"
                >
                  {{ editing() ? '取消编辑' : '编辑方案' }}
                </button>
              </div>

              @if (editing()) {
                <div class="edit-form">
                  <clr-input-container>
                    <label>标题</label>
                    <input
                      clrInput
                      [ngModel]="draft()?.title"
                      (ngModelChange)="updateDraft('title', $event)"
                    />
                  </clr-input-container>
                  <clr-textarea-container>
                    <label>摘要</label>
                    <textarea
                      clrTextarea
                      rows="3"
                      [ngModel]="draft()?.summary"
                      (ngModelChange)="updateDraft('summary', $event)"
                    ></textarea>
                  </clr-textarea-container>
                  <div class="edit-grid">
                    <clr-input-container>
                      <label>窗口开始</label>
                      <input
                        clrInput
                        type="datetime-local"
                        [ngModel]="draft()?.window?.start"
                        (ngModelChange)="updateDraftWindow('start', $event)"
                      />
                    </clr-input-container>
                    <clr-input-container>
                      <label>窗口结束</label>
                      <input
                        clrInput
                        type="datetime-local"
                        [ngModel]="draft()?.window?.end"
                        (ngModelChange)="updateDraftWindow('end', $event)"
                      />
                    </clr-input-container>
                    <clr-input-container>
                      <label>观察窗口（分钟）</label>
                      <input
                        clrNumberInput
                        type="number"
                        [ngModel]="draft()?.window?.observationWindowMinutes"
                        (ngModelChange)="updateObservation($event)"
                      />
                    </clr-input-container>
                  </div>
                  <div class="edit-actions">
                    <button class="btn btn-primary" type="button" (click)="saveEdit()">保存方案</button>
                  </div>
                </div>
              } @else {
                <dl class="facts">
                  <div>
                    <dt>执行窗口</dt>
                    <dd>
                      {{ item.window.start | date: 'yyyy-MM-dd HH:mm' }} 至
                      {{ item.window.end | date: 'yyyy-MM-dd HH:mm' }}
                    </dd>
                  </div>
                  <div>
                    <dt>观察窗口</dt>
                    <dd>{{ item.window.observationWindowMinutes }} 分钟</dd>
                  </div>
                  <div>
                    <dt>值守人员</dt>
                    <dd>{{ item.onCall.join('、') }}</dd>
                  </div>
                  <div>
                    <dt>当前门禁</dt>
                    <dd>{{ pendingStage() ? stageLabel(pendingStage()!) + '待会签' : approvalGate() }}</dd>
                  </div>
                </dl>
              }
            </section>

            <app-validation-panel [change]="item" [allChanges]="changes()" />

            <section class="surface span-2">
              <div class="surface-heading">
                <div>
                  <h2>资源清单</h2>
                  <span>{{ item.resources.length }} 个对象，明确关键资源依赖</span>
                </div>
              </div>
              <div class="resource-table">
                @for (resource of item.resources; track resource.id) {
                  <article>
                    <span class="type">{{ resourceLabel(resource.type) }}</span>
                    <div>
                      <strong>{{ resource.name }}</strong>
                      <small>{{ resource.id }}</small>
                    </div>
                    <span>{{ resource.critical ? '关键资源' : '一般资源' }}</span>
                    <span>依赖 {{ resource.dependencies.length }} 项</span>
                  </article>
                } @empty {
                  <p class="empty">未配置资源。</p>
                }
              </div>
            </section>
          </div>
        }

        @case ('dependency') {
          <section class="surface">
            <div class="surface-heading">
              <div>
                <h2>依赖关系图</h2>
                <span>虚线表示依赖资源未纳入本次影响范围</span>
              </div>
            </div>
            <app-dependency-graph [change]="item" />
          </section>
        }

        @case ('window') {
          <section class="surface">
            <div class="surface-heading">
              <div>
                <h2>窗口与资源冲突</h2>
                <span>按 09-29 至 10-02 展示所有有效窗口</span>
              </div>
            </div>
            <app-window-gantt [changes]="changes()" [selectedId]="item.id" />
            <div class="conflict-notes">
              @for (issue of issues(); track issue.id) {
                @if (issue.code === 'WINDOW_CONFLICT') {
                  <article>
                    <strong>{{ issue.title }}</strong>
                    <p>{{ issue.detail }}</p>
                    <span>{{ issue.suggestedAction }}</span>
                  </article>
                }
              } @empty {
                <p class="empty">当前没有窗口冲突。</p>
              }
            </div>
          </section>
        }

        @case ('execution') {
          <div class="content-grid execution-grid">
            <section class="surface">
              <div class="surface-heading">
                <div>
                  <h2>执行步骤底账</h2>
                  <span>勾选只记“待确认”，命令回包到达才记完成；重复回包只认第一次</span>
                </div>
                @if (item.status === 'approved') {
                  <button class="btn btn-primary" type="button" (click)="startExecution()">
                    开始执行
                  </button>
                }
              </div>

              @if (item.ledger; as ledger) {
                @if (ledger.failure) {
                  <div class="ledger-banner failed">
                    <strong>执行已因失败冻结</strong>
                    <p>
                      待确认动作“{{ stepTitle(ledger.failure.stepId) }}”已标记失败：{{ ledger.failure.reason }}。
                      请按右侧回滚顺序从后往前处置。
                    </p>
                  </div>
                } @else {
                  <div class="ledger-banner pending">
                    <strong>弱网机房执行中</strong>
                    <p>
                      已下发 {{ ledger.entries.length }} 个动作，其中
                      {{ pendingEntries(item).length }} 个等待回包确认。
                      页面崩溃或重开不会丢失底账，可从待确认处继续。
                    </p>
                  </div>
                }
              } @else {
                @if (isLegacy(item)) {
                  <div class="ledger-banner legacy">
                    <strong>旧记录 · 只读展示</strong>
                    <p>
                      该记录产生于底账功能上线前，没有操作底账，勾选项不能当作已确认执行，
                      也不允许续接或生成回滚顺序，仅供查阅。
                    </p>
                  </div>
                }
              }

              <div class="step-list">
                @for (step of stepsBy(item); track step.id) {
                  @if (step.phase === 'rollback') {
                    <div class="step-row rollback-step" title="回滚步骤不入执行底账，失败后按右侧顺序执行">
                      <span class="step-state-icon">↺</span>
                      <span class="phase">{{ phaseLabel(step.phase) }}</span>
                      <div>
                        <strong>{{ step.title }}</strong>
                        <code>{{ step.command || '未填写命令' }}</code>
                      </div>
                      <span>{{ step.owner || '未指定' }}</span>
                    </div>
                  } @else {
                    @let state = stepState(item, step);
                    <div
                      class="step-row"
                      [class.confirmed]="state === 'confirmed'"
                      [class.pending]="state === 'pending'"
                      [class.failed]="state === 'failed'"
                      [class.legacy]="state === 'legacy'"
                    >
                      <span class="step-state-icon" [attr.aria-label]="stepStateLabel(state)">
                        @switch (state) {
                          @case ('confirmed') { ✓ }
                          @case ('pending') { ◔ }
                          @case ('failed') { ✕ }
                          @case ('legacy') { ◷ }
                          @default { ○ }
                        }
                      </span>
                      <span class="phase">{{ phaseLabel(step.phase) }}</span>
                      <div>
                        <strong>{{ step.title }}</strong>
                        <code>{{ step.command || '未填写命令' }}</code>
                        @switch (state) {
                          @case ('pending') {
                            @let entry = ledgerEntry(item, step.id);
                            <small class="meta">
                              命令已于 {{ entry?.dispatchedAt | date: 'MM-dd HH:mm:ss' }}
                              下发（第 {{ entry?.dispatchAttempts }} 次），等待回包…
                            </small>
                          }
                          @case ('confirmed') {
                            @let entry = ledgerEntry(item, step.id);
                            <small class="meta">
                              {{ entry?.confirmSource === 'manual' ? '人工补记完成' : '回包确认完成' }}
                              · 回包 {{ entry?.ackReceivedAt | date: 'MM-dd HH:mm:ss' }}
                              · 耗时 {{ formatEntryDuration(entry?.durationMs) }}
                            </small>
                          }
                          @case ('failed') {
                            @let entry = ledgerEntry(item, step.id);
                            <small class="meta">已标记失败：{{ entry?.failureReason }}</small>
                          }
                          @case ('legacy') {
                            <small class="meta">旧记录勾选，无底账佐证，只读</small>
                          }
                        }
                      </div>
                      <span class="step-actions">
                        @if (state === 'idle' && item.status === 'executing' && !item.ledger?.failure) {
                          <button class="btn btn-sm btn-primary" type="button" (click)="dispatch(step.id)">
                            勾选下发
                          </button>
                        }
                        @if (state === 'pending') {
                          <span class="state-tag">待确认</span>
                          @if (!item.ledger?.failure) {
                            <button class="btn btn-sm" type="button" (click)="injectAck(step.id)">
                              模拟回包到达
                            </button>
                            <button
                              class="btn btn-sm"
                              type="button"
                              (click)="beginFail(step.id)"
                            >
                              标记失败
                            </button>
                            <button
                              class="btn btn-sm confirm-btn"
                              type="button"
                              (click)="manualConfirm(step.id)"
                            >
                              补记完成
                            </button>
                          }
                          @if (failureTarget() === step.id) {
                            <span class="fail-inline">
                              <input
                                class="fail-input"
                                type="text"
                                placeholder="失败原因"
                                [ngModel]="failureReason()"
                                (ngModelChange)="failureReason.set($event)"
                              />
                              <button class="btn btn-sm btn-danger" type="button" (click)="confirmFail(step.id)">
                                确认失败
                              </button>
                              <button class="btn btn-sm" type="button" (click)="cancelFail()">取消</button>
                            </span>
                          }
                        }
                        @if (state === 'confirmed') {
                          <span class="state-tag ok">
                            {{ ledgerEntry(item, step.id)?.confirmSource === 'manual' ? '补记完成' : '已确认' }}
                          </span>
                        }
                        @if (state === 'failed') {
                          <span class="state-tag bad">失败</span>
                        }
                        @if (state === 'legacy') {
                          <span class="state-tag legacy-tag">旧记录</span>
                        }
                      </span>
                    </div>
                  }
                } @empty {
                  <p class="empty">没有执行步骤。</p>
                }
              </div>
            </section>

            <section class="surface">
              <div class="surface-heading">
                <div>
                  <h2>实时执行记录</h2>
                  <span>记录偏离并明确继续、暂停或回滚</span>
                </div>
                <a class="btn btn-sm" href="https://logs.example.internal/change/{{ item.id }}" target="_blank" rel="noopener">
                  打开实时日志
                </a>
              </div>
              @if (item.status === 'executing' && item.ledger && !item.ledger.failure) {
                <div class="deviation-form">
                  <clr-textarea-container>
                    <label>偏离说明</label>
                    <textarea
                      clrTextarea
                      rows="3"
                      [ngModel]="deviationText()"
                      (ngModelChange)="deviationText.set($event)"
                      placeholder="描述实际执行与方案差异"
                    ></textarea>
                  </clr-textarea-container>
                  <div class="deviation-actions">
                    <clr-select-container>
                      <label>处置决定</label>
                      <select
                        clrSelect
                        [ngModel]="deviationDecision()"
                        (ngModelChange)="deviationDecision.set($event)"
                      >
                        <option value="continue">继续观察</option>
                        <option value="pause">暂停执行</option>
                        <option value="rollback">立即回滚</option>
                      </select>
                    </clr-select-container>
                    <button class="btn" type="button" (click)="recordDeviation()">记录偏离</button>
                  </div>
                </div>
                <div class="completion-actions">
                  <button class="btn" type="button" (click)="complete('rolled_back')">判定回滚</button>
                  <button
                    class="btn btn-primary"
                    type="button"
                    (click)="complete('completed')"
                    [disabled]="!allForwardConfirmed(item)"
                  >
                    执行完成
                  </button>
                </div>
                @if (!allForwardConfirmed(item)) {
                  <p class="form-hint">仍有动作未确认，需全部收到回包或人工补记后才能判定完成。</p>
                }
              }
              @if (item.status === 'executing' && item.ledger && item.ledger.failure) {
                <p class="form-hint">执行已冻结，完成回滚顺序后在下方“判定回滚”归档。</p>
                <div class="completion-actions">
                  <button class="btn btn-primary" type="button" (click)="complete('rolled_back')">
                    回滚处置完成，归档
                  </button>
                </div>
              }
              <div class="deviation-list">
                @for (deviation of item.deviations; track deviation.id) {
                  <article>
                    <div>
                      <strong>{{ deviation.owner }}</strong>
                      <time>{{ deviation.recordedAt | date: 'MM-dd HH:mm' }}</time>
                    </div>
                    <p>{{ deviation.description }}</p>
                    <span>{{ decisionLabel(deviation.decision) }}</span>
                  </article>
                } @empty {
                  <p class="empty">尚无执行偏离。</p>
                }
              </div>
            </section>

            @if (item.ledger?.failure) {
              <section class="surface span-2">
                <div class="surface-heading">
                  <div>
                    <h2>回滚顺序</h2>
                    <span>仅含已确认动作，按确认时间从后往前；准备和未执行动作不混入</span>
                  </div>
                </div>
                @if (rollbackPlan(item).length) {
                  <ol class="rollback-plan">
                    @for (plan of rollbackPlan(item); track plan.stepId) {
                      <li>
                        <span class="rollback-order">{{ plan.order }}</span>
                        <div>
                          <strong>撤销：{{ plan.title }}</strong>
                          <small>
                            原动作确认于 {{ plan.confirmedAt | date: 'MM-dd HH:mm:ss' }}
                            · 耗时 {{ formatEntryDuration(plan.durationMs) }}
                          </small>
                          @if (plan.rollbackTitle || plan.rollbackCommand) {
                            <p class="rollback-cmd">
                              {{ plan.rollbackTitle }}
                              <code>{{ plan.rollbackCommand }}</code>
                              <span class="rollback-owner">责任人：{{ plan.rollbackOwner || '未指定' }}</span>
                            </p>
                          } @else {
                            <p class="rollback-cmd missing">方案中没有与该步骤关联的回滚步骤，请人工核对后处置。</p>
                          }
                        </div>
                      </li>
                    }
                  </ol>
                } @else {
                  <p class="empty">没有已确认的前向动作需要回滚（准备动作与未执行动作均不计入）。</p>
                }
              </section>
            }
          </div>
        }

        @case ('approval') {
          <div class="content-grid approval-grid">
            <section class="surface">
              <div class="surface-heading">
                <div>
                  <h2>顺序会签</h2>
                  <span>必须按网络、系统、安全、业务顺序完成</span>
                </div>
                @if (item.status === 'draft' || item.status === 'rejected') {
                  <button
                    class="btn btn-primary"
                    type="button"
                    (click)="submitForReview()"
                    [disabled]="hasBlockers()"
                  >
                    提交审批
                  </button>
                }
              </div>
              <ol class="approval-flow">
                @for (approval of item.approvals; track approval.stage) {
                  <li [ngClass]="approval.state">
                    <span class="flow-index">{{ $index + 1 }}</span>
                    <div>
                      <strong>{{ stageLabel(approval.stage) }}</strong>
                      <p>
                        {{ approval.comment || approvalStateText(approval.state) }}
                      </p>
                      @if (approval.approver) {
                        <small>
                          {{ approval.approver }} · {{ approval.decidedAt | date: 'MM-dd HH:mm' }}
                        </small>
                      }
                    </div>
                  </li>
                }
              </ol>
            </section>

            <section class="surface">
              <div class="surface-heading">
                <div>
                  <h2>会签操作</h2>
                  <span>只有当前顺位负责人可以签署</span>
                </div>
              </div>
              @if (pendingStage(); as stage) {
                @if (item.status === 'submitted' || item.status === 'rejected') {
                  <div class="approval-form">
                    <clr-input-container>
                      <label>审批人</label>
                      <input
                        clrInput
                        [ngModel]="approver()"
                        (ngModelChange)="approver.set($event)"
                      />
                    </clr-input-container>
                    <clr-textarea-container>
                      <label>意见</label>
                      <textarea
                        clrTextarea
                        rows="3"
                        [ngModel]="approvalComment()"
                        (ngModelChange)="approvalComment.set($event)"
                      ></textarea>
                    </clr-textarea-container>
                    <div class="approval-actions">
                      <button class="btn" type="button" (click)="reject(stage)">退回</button>
                      <button class="btn btn-primary" type="button" (click)="approve(stage)">
                        批准 {{ stageLabel(stage) }}
                      </button>
                    </div>
                  </div>
                } @else {
                  <p class="empty">当前状态不允许审批操作。</p>
                }
              } @else {
                <p class="approved-message">
                  会签已完成。开始执行后审批记录自动冻结，不允许修改。
                </p>
              }
            </section>

            <section class="surface span-2">
              <div class="surface-heading">
                <div>
                  <h2>审批冻结快照</h2>
                  <span>执行与复盘以冻结版本为准</span>
                </div>
              </div>
              <div class="freeze-strip">
                @for (approval of item.approvals; track approval.stage) {
                  <div>
                    <span>{{ stageLabel(approval.stage) }}</span>
                    <strong>{{ approvalStateText(approval.state) }}</strong>
                  </div>
                }
              </div>
            </section>
          </div>
        }

        @case ('audit') {
          <div class="content-grid audit-grid">
            <section class="surface">
              <div class="surface-heading">
                <div>
                  <h2>审计轨迹</h2>
                  <span>创建、编辑、会签、执行和回滚均记录</span>
                </div>
                <button class="btn btn-sm" type="button" (click)="exportRetrospective()">
                  导出复盘记录
                </button>
              </div>
              <app-audit-trail [records]="item.audit" />
            </section>
            <section class="surface">
              <div class="surface-heading">
                <div>
                  <h2>复盘摘要</h2>
                  <span>进入正式变更档案的事实记录</span>
                </div>
              </div>
              <dl class="facts compact">
                <div>
                  <dt>最终状态</dt>
                  <dd>{{ statusLabel(item.status) }}</dd>
                </div>
                <div>
                  <dt>执行偏离</dt>
                  <dd>{{ item.deviations.length }} 条</dd>
                </div>
                <div>
                  <dt>审计事件</dt>
                  <dd>{{ item.audit.length }} 条</dd>
                </div>
                <div>
                  <dt>完成步骤</dt>
                  <dd>{{ completedSteps(item) }} / {{ item.steps.length }}</dd>
                </div>
              </dl>
              <div class="retrospective-note">
                <strong>导出内容</strong>
                <p>包含变更窗口、资源范围、执行偏离、最终状态和完整审计轨迹。</p>
              </div>
            </section>
          </div>
        }
      }
    } @else {
      <section class="not-found">
        <h1>变更不存在</h1>
        <p>该记录可能已被删除，或链接中的编号无效。</p>
        <a class="btn btn-primary" routerLink="/">返回变更队列</a>
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .detail-heading {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 24px;
        padding: 20px 0 24px;
        border-bottom: 1px solid #d7d7d7;
      }

      .back-link {
        display: inline-block;
        margin-bottom: 14px;
        font-size: 12px;
      }

      .title-row {
        display: flex;
        align-items: center;
        gap: 14px;
      }

      .change-id {
        color: #266c91;
        font-size: 12px;
        font-weight: 600;
      }

      h1 {
        margin: 2px 0 0;
        font-size: 28px;
      }

      .heading-main > p {
        max-width: 760px;
        margin: 12px 0 0;
        color: #5e5e5e;
      }

      .heading-meta {
        display: grid;
        grid-template-columns: repeat(3, minmax(90px, 1fr));
        align-self: end;
        border: 1px solid #d7d7d7;
        background: #fff;
      }

      .heading-meta div {
        padding: 12px 16px;
        border-left: 1px solid #e1e1e1;
      }

      .heading-meta div:first-child {
        border-left: 0;
      }

      .heading-meta span,
      .heading-meta strong {
        display: block;
      }

      .heading-meta span {
        color: #6d6d6d;
        font-size: 11px;
      }

      .heading-meta strong {
        margin-top: 4px;
        font-size: 13px;
      }

      .status {
        padding: 3px 9px;
        border: 1px solid #9a9a9a;
        background: #f3f3f3;
        color: #474747;
        font-size: 12px;
      }

      .status.submitted,
      .status.approved {
        border-color: #5688a5;
        background: #eaf4f9;
        color: #1d5877;
      }

      .status.executing,
      .status.completed {
        border-color: #75a489;
        background: #edf7f0;
        color: #245f3d;
      }

      .status.rejected,
      .status.rolled_back {
        border-color: #d58d7e;
        background: #fbece8;
        color: #8e260f;
      }

      .tab-nav {
        display: flex;
        gap: 0;
        margin-bottom: 20px;
        border-bottom: 1px solid #d7d7d7;
        overflow-x: auto;
      }

      .tab-nav button {
        position: relative;
        padding: 13px 18px;
        border: 0;
        border-bottom: 3px solid transparent;
        background: transparent;
        color: #575757;
        cursor: pointer;
        white-space: nowrap;
      }

      .tab-nav button.active {
        border-bottom-color: #266c91;
        color: #174d6a;
        font-weight: 600;
      }

      .nav-badge {
        margin-left: 6px;
        padding: 1px 5px;
        background: #eaf4f9;
        color: #215a78;
        font-size: 10px;
      }

      .content-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px;
      }

      .surface {
        padding: 18px;
        border: 1px solid #d7d7d7;
        background: #fff;
      }

      .span-2 {
        grid-column: 1 / -1;
      }

      .surface-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding-bottom: 14px;
        border-bottom: 1px solid #e3e3e3;
      }

      .surface-heading h2 {
        margin: 0;
        font-size: 17px;
      }

      .surface-heading span {
        color: #666;
        font-size: 12px;
      }

      .facts {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1px;
        margin: 18px 0 0;
        background: #e1e1e1;
      }

      .facts div {
        padding: 14px;
        background: #fafafa;
      }

      .facts dt {
        color: #666;
        font-size: 12px;
      }

      .facts dd {
        margin: 5px 0 0;
        font-weight: 600;
      }

      .facts.compact {
        margin-top: 16px;
      }

      .edit-form {
        padding-top: 18px;
      }

      .edit-grid,
      .deviation-actions {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
      }

      .edit-actions,
      .completion-actions,
      .approval-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 16px;
      }

      .resource-table article {
        display: grid;
        grid-template-columns: 80px minmax(180px, 1fr) 100px 120px;
        align-items: center;
        gap: 14px;
        padding: 12px 4px;
        border-bottom: 1px solid #e6e6e6;
      }

      .resource-table article:last-child {
        border-bottom: 0;
      }

      .resource-table article div {
        display: flex;
        flex-direction: column;
      }

      .resource-table small,
      .resource-table article > span:last-child {
        color: #6b6b6b;
        font-size: 11px;
      }

      .type,
      .phase {
        display: inline-block;
        width: fit-content;
        padding: 2px 7px;
        background: #edf3f6;
        color: #205d7e;
        font-size: 11px;
      }

      .conflict-notes {
        margin-top: 16px;
      }

      .conflict-notes article {
        padding: 14px;
        border-left: 3px solid #c21d00;
        background: #fbece8;
      }

      .conflict-notes p {
        margin: 6px 0;
      }

      .conflict-notes span {
        color: #8e260f;
        font-size: 12px;
      }

      .step-row {
        display: grid;
        grid-template-columns: 24px 50px minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        padding: 14px 2px;
        border-bottom: 1px solid #e6e6e6;
      }

      .step-row.confirmed {
        background: #f5faf6;
      }

      .step-row.pending {
        background: #fff8ec;
      }

      .step-row.failed {
        background: #fbece8;
      }

      .step-row.legacy {
        background: #f4f4f4;
        opacity: 0.85;
      }

      .step-row.rollback-step {
        background: #f7f9fa;
        color: #5f5f5f;
      }

      .step-state-icon {
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border: 1px solid #b9b9b9;
        border-radius: 50%;
        color: #777;
        font-size: 12px;
      }

      .step-row.confirmed .step-state-icon {
        border-color: #4b8d65;
        background: #e8f5ed;
        color: #245f3d;
      }

      .step-row.pending .step-state-icon {
        border-color: #d0a251;
        background: #fff3dc;
        color: #9a6a12;
      }

      .step-row.failed .step-state-icon {
        border-color: #c21d00;
        background: #fbece8;
        color: #8e260f;
      }

      .step-row .meta {
        margin-top: 4px;
        color: #6b6b6b;
        font-size: 11px;
      }

      .step-row.failed .meta {
        color: #8e260f;
      }

      .step-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 6px;
      }

      .state-tag {
        padding: 2px 7px;
        background: #fff3dc;
        color: #9a6a12;
        font-size: 11px;
      }

      .state-tag.ok {
        background: #e8f5ed;
        color: #245f3d;
      }

      .state-tag.bad {
        background: #fbece8;
        color: #8e260f;
      }

      .state-tag.legacy-tag {
        background: #e6e6e6;
        color: #5f5f5f;
      }

      .confirm-btn {
        border-color: #4b8d65 !important;
        color: #245f3d !important;
      }

      .btn-danger {
        border-color: #c21d00 !important;
        color: #8e260f !important;
      }

      .fail-inline {
        display: flex;
        align-items: center;
        flex-basis: 100%;
        gap: 6px;
        margin-top: 6px;
      }

      .fail-input {
        flex: 1;
        min-width: 120px;
        padding: 4px 8px;
        border: 1px solid #c21d00;
      }

      .ledger-banner {
        margin: 14px 0;
        padding: 12px 14px;
        border-left: 3px solid #5688a5;
        background: #eaf4f9;
      }

      .ledger-banner strong {
        color: #1d5877;
      }

      .ledger-banner.pending {
        border-left-color: #d0a251;
        background: #fff8ec;
      }

      .ledger-banner.pending strong {
        color: #9a6a12;
      }

      .ledger-banner.failed {
        border-left-color: #c21d00;
        background: #fbece8;
      }

      .ledger-banner.failed strong {
        color: #8e260f;
      }

      .ledger-banner.legacy {
        border-left-color: #8a8a8a;
        background: #f4f4f4;
      }

      .ledger-banner.legacy strong,
      .ledger-banner.legacy p {
        color: #5f5f5f;
      }

      .ledger-banner p {
        margin: 6px 0 0;
        font-size: 12px;
      }

      .form-hint {
        margin: 10px 0 0;
        color: #8e260f;
        font-size: 12px;
      }

      .rollback-plan {
        margin: 16px 0 0;
        padding: 0;
        list-style: none;
        counter-reset: rollback;
      }

      .rollback-plan li {
        display: grid;
        grid-template-columns: 34px 1fr;
        gap: 12px;
        padding: 14px 0;
        border-bottom: 1px solid #e6e6e6;
      }

      .rollback-order {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border: 1px solid #c21d00;
        background: #fbece8;
        color: #8e260f;
        font-weight: 700;
      }

      .rollback-plan small {
        display: block;
        margin-top: 4px;
        color: #6b6b6b;
        font-size: 11px;
      }

      .rollback-cmd {
        margin: 8px 0 0;
        padding: 10px 12px;
        background: #f7f2f0;
        font-size: 12px;
      }

      .rollback-cmd code {
        display: block;
        margin: 4px 0;
        color: #8e260f;
      }

      .rollback-cmd.missing {
        background: #f4f4f4;
        color: #5f5f5f;
      }

      .rollback-owner {
        color: #6b6b6b;
      }

      .step-row div {
        display: flex;
        flex-direction: column;
      }

      .step-row code {
        margin-top: 4px;
        color: #666;
        font-size: 11px;
      }

      .deviation-form {
        padding: 16px 0;
        border-bottom: 1px solid #e3e3e3;
      }

      .deviation-actions {
        grid-template-columns: 1fr auto;
        align-items: end;
      }

      .deviation-list article {
        padding: 12px 0;
        border-bottom: 1px solid #e6e6e6;
      }

      .deviation-list article > div {
        display: flex;
        justify-content: space-between;
      }

      .deviation-list p {
        margin: 7px 0;
      }

      .deviation-list span {
        color: #8e260f;
        font-size: 11px;
      }

      .approval-flow {
        margin: 18px 0 0;
        padding: 0;
        list-style: none;
      }

      .approval-flow li {
        display: grid;
        grid-template-columns: 32px 1fr;
        gap: 12px;
        padding: 12px 0;
        border-bottom: 1px solid #e6e6e6;
      }

      .flow-index {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: 1px solid #9d9d9d;
        color: #555;
      }

      .approval-flow li.approved .flow-index {
        border-color: #4b8d65;
        background: #e8f5ed;
        color: #245f3d;
      }

      .approval-flow li.rejected .flow-index {
        border-color: #c21d00;
        background: #fbece8;
        color: #8e260f;
      }

      .approval-flow p {
        margin: 5px 0;
        color: #5f5f5f;
      }

      .approval-flow small {
        color: #737373;
      }

      .approval-form {
        padding-top: 16px;
      }

      .approved-message {
        margin: 18px 0 0;
        padding: 16px;
        border-left: 3px solid #4b8d65;
        background: #edf7f0;
        color: #245f3d;
      }

      .freeze-strip {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 1px;
        margin-top: 18px;
        background: #d7d7d7;
      }

      .freeze-strip div {
        display: flex;
        flex-direction: column;
        padding: 14px;
        background: #fafafa;
      }

      .freeze-strip span {
        color: #666;
        font-size: 11px;
      }

      .freeze-strip strong {
        margin-top: 4px;
      }

      .retrospective-note {
        margin-top: 18px;
        padding: 16px;
        background: #f4f6f7;
      }

      .retrospective-note p {
        margin: 6px 0 0;
        color: #5f5f5f;
      }

      .empty {
        color: #737373;
      }

      .not-found {
        margin-top: 50px;
        padding: 48px;
        text-align: center;
        border: 1px solid #d7d7d7;
        background: #fff;
      }

      @media (max-width: 1100px) {
        .detail-heading,
        .content-grid {
          grid-template-columns: 1fr;
        }

        .span-2 {
          grid-column: auto;
        }
      }

      @media (max-width: 700px) {
        .heading-meta,
        .facts,
        .edit-grid,
        .freeze-strip {
          grid-template-columns: 1fr;
        }

        .heading-meta div {
          border-left: 0;
          border-top: 1px solid #e1e1e1;
        }

        .resource-table article,
        .step-row {
          grid-template-columns: 1fr;
        }

        .tab-nav {
          padding-bottom: 4px;
        }
      }
    `,
  ],
})
export class ChangeDetailComponent {
  private readonly store = inject(Store);
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(ChangeRequestService);
  private readonly changeId = this.route.snapshot.paramMap.get('id') ?? '';

  readonly changes = this.store.selectSignal(selectAllChanges);
  readonly change = computed(() => this.changes().find((item) => item.id === this.changeId));
  readonly selectedTab = signal<DetailTab>('overview');
  readonly editing = signal(false);
  readonly draft = signal<ChangeRequest | null>(null);
  readonly approver = signal('');
  readonly approvalComment = signal('');
  readonly deviationText = signal('');
  readonly deviationDecision = signal<DeviationRecord['decision']>('continue');
  readonly failureTarget = signal<string | null>(null);
  readonly failureReason = signal('');

  readonly tabs: Array<{ id: DetailTab; label: string }> = [
    { id: 'overview', label: '方案概览' },
    { id: 'dependency', label: '依赖关系' },
    { id: 'window', label: '窗口甘特' },
    { id: 'execution', label: '执行记录' },
    { id: 'approval', label: '审批会签' },
    { id: 'audit', label: '审计复盘' },
  ];

  readonly issues = computed(() => {
    const item = this.change();
    return item ? validateChange(item, this.changes()) : [];
  });

  readonly hasBlockers = computed(() =>
    this.issues().some((issue) => issue.severity === 'blocker'),
  );

  readonly pendingStage = computed<ApprovalStage | null>(() => {
    const item = this.change();
    if (!item || !['submitted', 'rejected'].includes(item.status)) {
      return null;
    }
    const rejected = item.approvals.find((approval) => approval.state === 'rejected');
    if (rejected) {
      return rejected.stage;
    }
    return item.approvals.find((approval) => approval.state === 'pending')?.stage ?? null;
  });

  beginEdit(): void {
    const item = this.change();
    if (!item) {
      return;
    }
    this.draft.set(structuredClone(item));
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.draft.set(null);
  }

  updateDraft<K extends keyof ChangeRequest>(key: K, value: ChangeRequest[K]): void {
    this.draft.update((draft) => (draft ? { ...draft, [key]: value } : draft));
  }

  updateDraftWindow(key: 'start' | 'end', value: string): void {
    this.draft.update((draft) =>
      draft ? { ...draft, window: { ...draft.window, [key]: value } } : draft,
    );
  }

  updateObservation(value: string | number): void {
    this.draft.update((draft) =>
      draft
        ? {
            ...draft,
            window: { ...draft.window, observationWindowMinutes: Number(value) || 0 },
          }
        : draft,
    );
  }

  saveEdit(): void {
    const draft = this.draft();
    if (!draft) {
      return;
    }
    this.store.dispatch(ChangeRequestActions.updateChange({ change: draft }));
    this.editing.set(false);
    this.draft.set(null);
  }

  submitForReview(): void {
    if (!this.hasBlockers()) {
      this.store.dispatch(ChangeRequestActions.submitForReview({ id: this.changeId }));
    }
  }

  approve(stage: ApprovalStage): void {
    const approver = this.approver().trim() || '当前用户';
    const comment = this.approvalComment().trim() || '同意按方案执行。';
    this.store.dispatch(
      ChangeRequestActions.approveStage({
        id: this.changeId,
        stage,
        approver,
        comment,
      }),
    );
    this.clearApprovalForm();
  }

  reject(stage: ApprovalStage): void {
    const approver = this.approver().trim() || '当前用户';
    const comment = this.approvalComment().trim();
    if (!comment) {
      return;
    }
    this.store.dispatch(
      ChangeRequestActions.rejectStage({
        id: this.changeId,
        stage,
        approver,
        comment,
      }),
    );
    this.clearApprovalForm();
  }

  startExecution(): void {
    this.store.dispatch(ChangeRequestActions.startExecution({ id: this.changeId }));
  }

  /** 勾选：只下发命令、留下待确认动作；完成与否等回包 */
  dispatch(stepId: string): void {
    this.store.dispatch(ChangeRequestActions.dispatchStep({ id: this.changeId, stepId }));
  }

  /** 弱网联调：模拟迟到的命令回包；重复回包由 reducer 幂等丢弃 */
  injectAck(stepId: string): void {
    this.store.dispatch(
      ChangeRequestActions.ackStep({
        id: this.changeId,
        stepId,
        ackAt: new Date().toISOString(),
      }),
    );
  }

  /** 重开后续接：待确认动作经核实确实执行成功，人工补记完成 */
  manualConfirm(stepId: string): void {
    const actor = this.change()?.onCall[0] ?? '当前用户';
    this.store.dispatch(
      ChangeRequestActions.confirmPendingStep({ id: this.changeId, stepId, actor }),
    );
  }

  beginFail(stepId: string): void {
    this.failureTarget.set(stepId);
    this.failureReason.set('');
  }

  cancelFail(): void {
    this.failureTarget.set(null);
    this.failureReason.set('');
  }

  confirmFail(stepId: string): void {
    const reason = this.failureReason().trim();
    if (!reason) {
      return;
    }
    const actor = this.change()?.onCall[0] ?? '当前用户';
    this.store.dispatch(
      ChangeRequestActions.failPendingStep({ id: this.changeId, stepId, reason, actor }),
    );
    this.cancelFail();
  }

  recordDeviation(): void {
    const description = this.deviationText().trim();
    if (!description) {
      return;
    }
    const deviation: DeviationRecord = {
      id: `dev-${Date.now()}`,
      recordedAt: new Date().toISOString(),
      owner: this.change()?.onCall[0] ?? '当前用户',
      description,
      decision: this.deviationDecision(),
    };
    this.store.dispatch(ChangeRequestActions.recordDeviation({ id: this.changeId, deviation }));
    this.deviationText.set('');
  }

  complete(result: 'completed' | 'rolled_back'): void {
    const note =
      result === 'completed'
        ? '观察窗口内指标稳定，变更完成。'
        : '发现不可接受影响，按方案完成回滚。';
    this.store.dispatch(ChangeRequestActions.completeExecution({ id: this.changeId, result, note }));
  }

  exportRetrospective(): void {
    const item = this.change();
    if (!item) {
      return;
    }
    const blob = new Blob([this.service.exportRetrospective(item)], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${item.id}-retrospective.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  stepsBy(change: ChangeRequest): ChangeStep[] {
    const order: ChangeStep['phase'][] = ['prepare', 'execute', 'verify', 'rollback'];
    return [...change.steps].sort((left, right) => {
      const phase = order.indexOf(left.phase) - order.indexOf(right.phase);
      return phase || left.id.localeCompare(right.id);
    });
  }

  isLegacy(change: ChangeRequest): boolean {
    return isLegacyExecution(change);
  }

  stepState(change: ChangeRequest, step: ChangeStep): StepExecutionState {
    return getStepExecutionState(change, step);
  }

  ledgerEntry(change: ChangeRequest, stepId: string): ExecutionLedgerEntry | undefined {
    return change.ledger?.entries.find((entry) => entry.stepId === stepId);
  }

  pendingEntries(change: ChangeRequest): ExecutionLedgerEntry[] {
    return change.ledger?.entries.filter((entry) => entry.status === 'pending') ?? [];
  }

  rollbackPlan(change: ChangeRequest): RollbackPlanItem[] {
    return buildRollbackPlan(change);
  }

  allForwardConfirmed(change: ChangeRequest): boolean {
    if (!change.ledger) {
      return false;
    }
    return this.stepsBy(change)
      .filter((step) => step.phase !== 'rollback')
      .every(
        (step) =>
          this.ledgerEntry(change, step.id)?.status === 'confirmed',
      );
  }

  stepTitle(stepId: string): string {
    return this.change()?.steps.find((step) => step.id === stepId)?.title ?? stepId;
  }

  stepStateLabel(state: StepExecutionState): string {
    return {
      confirmed: '已确认',
      pending: '待确认',
      failed: '失败',
      legacy: '旧记录只读',
      idle: '未下发',
    }[state];
  }

  formatEntryDuration(durationMs?: number): string {
    return formatDuration(durationMs);
  }

  completedSteps(change: ChangeRequest): number {
    if (change.ledger) {
      return change.ledger.entries.filter((entry) => entry.status === 'confirmed').length;
    }
    return change.steps.filter((step) => step.completed).length;
  }

  statusLabel(status: ChangeRequest['status']): string {
    return STATUS_LABELS[status];
  }

  riskLabel(risk: ChangeRequest['risk']): string {
    return RISK_LABELS[risk];
  }

  resourceLabel(type: ChangeRequest['resources'][number]['type']): string {
    return RESOURCE_LABELS[type];
  }

  stageLabel(stage: ApprovalStage): string {
    return STAGE_LABELS[stage];
  }

  phaseLabel(phase: ChangeStep['phase']): string {
    return PHASE_LABELS[phase];
  }

  approvalStateText(state: ChangeRequest['approvals'][number]['state']): string {
    return {
      pending: '等待签署',
      approved: '已批准',
      rejected: '已退回',
      frozen: '已冻结',
    }[state];
  }

  approvalGate(): string {
    const item = this.change();
    if (!item) {
      return '-';
    }
    if (item.status === 'approved') {
      return '已批准，等待执行';
    }
    if (['executing', 'completed', 'rolled_back'].includes(item.status)) {
      return '审批已冻结';
    }
    return '方案草稿';
  }

  decisionLabel(decision: DeviationRecord['decision']): string {
    return {
      continue: '继续观察',
      pause: '暂停执行',
      rollback: '立即回滚',
    }[decision];
  }

  private clearApprovalForm(): void {
    this.approver.set('');
    this.approvalComment.set('');
  }
}
