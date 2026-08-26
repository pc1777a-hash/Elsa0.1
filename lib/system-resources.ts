import type { SystemGpuResources, SystemResources } from "@/lib/elsa-types";

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseGpu(value: unknown): SystemGpuResources | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("資源端點的 GPU 欄位格式無法辨識。");
  }

  const gpu = value as Record<string, unknown>;
  const used = readFiniteNumber(gpu.memory_used_mb);
  const total = readFiniteNumber(gpu.memory_total_mb);
  if (typeof gpu.name !== "string" || !gpu.name.trim() || used === null || total === null) {
    throw new Error("資源端點未回傳可驗證的 GPU 名稱或顯存數值。");
  }
  return { name: gpu.name, memoryUsedMb: used, memoryTotalMb: total };
}

/**
 * Accepts only an explicit N1 resource response. Missing or arbitrary JSON is
 * never rendered as live GPU, disk, model, or queue telemetry.
 */
export function parseSystemResources(payload: unknown): SystemResources {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("資源端點未回傳可驗證的資料物件。");
  }

  const value = payload as Record<string, unknown>;
  const disk = value.disk;
  const used = disk && typeof disk === "object" && !Array.isArray(disk)
    ? readFiniteNumber((disk as Record<string, unknown>).used_gb)
    : null;
  const total = disk && typeof disk === "object" && !Array.isArray(disk)
    ? readFiniteNumber((disk as Record<string, unknown>).total_gb)
    : null;
  const queueDepth = readFiniteNumber(value.queue_depth);
  if (typeof value.captured_at !== "string" || !value.captured_at || used === null || total === null || queueDepth === null || !Array.isArray(value.loaded_models) || !value.loaded_models.every((model) => typeof model === "string")) {
    throw new Error("資源端點缺少可驗證的時間、磁碟、模型或佇列欄位。");
  }

  return {
    capturedAt: value.captured_at,
    gpu: parseGpu(value.gpu),
    diskUsedGb: used,
    diskTotalGb: total,
    loadedModels: [...value.loaded_models],
    queueDepth,
  };
}
