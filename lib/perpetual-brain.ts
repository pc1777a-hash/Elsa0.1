import type { PerpetualBrainStatus } from "./elsa-types";

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Converts only an explicit N1 worker response into a runtime status. A chat
 * response, a plan, or an arbitrary JSON object can never mean “executing”.
 */
export function parsePerpetualBrainStatus(payload: unknown): PerpetualBrainStatus {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof (payload as { online?: unknown }).online !== "boolean") {
    throw new Error("永動腦狀態端點未回傳可驗證的 online 欄位。");
  }

  const value = payload as Record<string, unknown>;
  const taskId = value.active_task_id;
  return {
    online: value.online as boolean,
    loopState: readOptionalString(value.loop_state),
    lastHeartbeat: readOptionalString(value.last_heartbeat),
    activeTaskId: typeof taskId === "string" ? taskId : taskId === null ? null : undefined,
    queueDepth: readOptionalNumber(value.queue_depth),
    workerVersion: readOptionalString(value.worker_version),
  };
}
