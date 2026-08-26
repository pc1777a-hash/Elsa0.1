import type { AixiSelfReport, PerpetualStrategyStatus, PerpetualTask } from "./elsa-types";

function asRecord(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, error: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(error);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function nullableString(value: unknown, error: string): string | null {
  if (value === null) return null;
  return requiredString(value, error);
}

export function parsePerpetualTask(value: unknown): PerpetualTask {
  const task = asRecord(value, "永動腦任務端點回傳了無法驗證的任務資料。");
  const kind = requiredString(task.kind, "永動腦任務缺少種類。");
  if (kind !== "code" && kind !== "research" && kind !== "maintenance") {
    throw new Error("永動腦任務種類不在允許契約內。");
  }

  return {
    taskId: requiredString(task.task_id, "永動腦任務缺少 ID。"),
    kind,
    title: requiredString(task.title, "永動腦任務缺少標題。"),
    objective: requiredString(task.objective, "永動腦任務缺少目標。"),
    state: requiredString(task.state, "永動腦任務缺少狀態。"),
    createdAt: requiredString(task.created_at, "永動腦任務缺少建立時間。"),
    updatedAt: requiredString(task.updated_at, "永動腦任務缺少更新時間。"),
    currentStep: optionalString(task.current_step),
    failureReason: optionalString(task.failure_reason),
    testSummary: optionalString(task.test_summary),
    gitSummary: optionalString(task.git_summary),
    deploymentPolicy: optionalString(task.deployment_policy),
    executorMode: optionalString(task.executor_mode),
  };
}

export function parsePerpetualTasks(payload: unknown): PerpetualTask[] {
  const response = asRecord(payload, "永動腦任務端點未回傳物件。");
  if (!Array.isArray(response.tasks)) throw new Error("永動腦任務端點缺少 tasks 陣列。");
  return response.tasks.map(parsePerpetualTask);
}

/** Keeps deliberate null and `unreported` values intact rather than inventing strategy state. */
export function parsePerpetualStrategyStatus(payload: unknown): PerpetualStrategyStatus {
  const response = asRecord(payload, "策略生命週期端點未回傳可驗證的資料。 ");
  const development = response.development_task;
  return {
    developmentTask: development === null ? null : parsePerpetualTask(development),
    candidateVersion: nullableString(response.candidate_version, "策略候選版本欄位無法驗證。"),
    deployedVersion: nullableString(response.deployed_version, "策略部署版本欄位無法驗證。"),
    executorState: requiredString(response.executor_state, "策略執行器狀態未回報。"),
    executorHeartbeat: nullableString(response.executor_heartbeat, "策略執行器心跳欄位無法驗證。"),
    riskGuardState: requiredString(response.risk_guard_state, "策略風控狀態未回報。"),
    lastCycle: nullableString(response.last_cycle, "策略最後循環欄位無法驗證。"),
  };
}

/**
 * Future N1 `GET /api/ai/self-status` contract. All thought-like text must be
 * explicitly returned here, with a source and timestamp, before the App shows it.
 */
export function parseAixiSelfReport(payload: unknown): AixiSelfReport {
  const response = asRecord(payload, "艾西自我回報端點未回傳可驗證的資料。 ");
  const wishes = response.long_term_wishes;
  if (!Array.isArray(wishes) || wishes.some((wish) => typeof wish !== "string" || !wish.trim())) {
    throw new Error("艾西自我回報缺少可驗證的長期願望清單。");
  }
  return {
    reportedAt: requiredString(response.reported_at, "艾西自我回報缺少時間。"),
    source: requiredString(response.source, "艾西自我回報缺少來源。"),
    currentMood: nullableString(response.current_mood, "艾西心情欄位無法驗證。"),
    currentFocus: nullableString(response.current_focus, "艾西專注焦點欄位無法驗證。"),
    nearTermIntent: nullableString(response.near_term_intent, "艾西近期意圖欄位無法驗證。"),
    longTermWishes: wishes,
  };
}
