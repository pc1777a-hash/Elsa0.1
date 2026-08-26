import type { CapabilityInventoryNode, CapabilityInventoryScan, CapabilityServiceSignal, InventoryReportState, StorageImportSource, StorageInventoryNode, StorageInventoryVolume, SystemCapabilityInventory, SystemStorageInventory } from "@/lib/elsa-types";

type JsonRecord = Record<string, unknown>;
const NODE_IDS = new Set(["N1", "N2", "N3"]);
const REPORT_STATES = new Set<InventoryReportState>(["reported", "stale", "probe_failed", "unreported"]);

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("盤點端點回傳的資料結構無法辨識。");
  return value as JsonRecord;
}

function boundedText(value: unknown, limit: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit ? value : null;
}

function requiredTimestamp(value: unknown, label: string): string {
  const timestamp = boundedText(value, 64);
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) throw new Error(`${label}缺少有效擷取時間。`);
  return timestamp;
}

function nonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function readCountMap(value: unknown): Record<string, number> {
  const raw = asRecord(value ?? {});
  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(raw)) {
    if (key.length <= 48) {
      const valid = nonnegative(count);
      if (valid !== null) result[key] = valid;
    }
  }
  return result;
}

function parseState(value: unknown): InventoryReportState {
  if (typeof value !== "string" || !REPORT_STATES.has(value as InventoryReportState)) throw new Error("盤點端點缺少有效回報狀態。");
  return value as InventoryReportState;
}

function parseNodeId(value: unknown): "N1" | "N2" | "N3" {
  if (typeof value !== "string" || !NODE_IDS.has(value)) throw new Error("盤點端點包含未知節點。");
  return value as "N1" | "N2" | "N3";
}

function parseVolumes(value: unknown): StorageInventoryVolume[] {
  if (!Array.isArray(value)) throw new Error("儲存盤點缺少 volumes 陣列。");
  return value.map((item) => {
    const raw = asRecord(item);
    const mountPath = boundedText(raw.mount_path, 240);
    const filesystemType = boundedText(raw.filesystem_type, 48);
    const totalBytes = nonnegative(raw.total_bytes);
    const usedBytes = nonnegative(raw.used_bytes);
    const availableBytes = nonnegative(raw.available_bytes);
    const usagePercent = raw.usage_percent === null ? null : nonnegative(raw.usage_percent);
    if (!mountPath || !filesystemType || totalBytes === null || totalBytes <= 0 || usedBytes === null || usedBytes > totalBytes || availableBytes === null || usagePercent === null && raw.usage_percent !== null) {
      throw new Error("儲存盤點包含不完整磁碟資訊。");
    }
    return { mountPath, filesystemType, totalBytes, usedBytes, availableBytes, usagePercent };
  });
}

function parseImportSources(value: unknown): StorageImportSource[] {
  if (!Array.isArray(value)) throw new Error("儲存盤點缺少 import_sources 陣列。");
  return value.map((item) => {
    const raw = asRecord(item);
    const id = boundedText(raw.id, 48);
    const label = boundedText(raw.label, 96);
    if (!id || !label || (raw.state !== "available" && raw.state !== "unreported") || (raw.access !== "user_selected" && raw.access !== "manual_only")) {
      throw new Error("儲存盤點包含不完整匯入來源。");
    }
    return { id, label, state: raw.state, access: raw.access };
  });
}

function parseStorageNode(value: unknown): StorageInventoryNode {
  const raw = asRecord(value);
  const system = asRecord(raw.system ?? {});
  return {
    nodeId: parseNodeId(raw.node_id),
    reportState: parseState(raw.report_state),
    capturedAt: raw.captured_at === null ? null : requiredTimestamp(raw.captured_at, "儲存盤點"),
    hostname: boundedText(system.hostname, 96),
    platform: boundedText(system.platform, 48),
    release: boundedText(system.release, 96),
    volumes: parseVolumes(raw.volumes),
    importSources: parseImportSources(raw.import_sources),
    errorSummary: raw.error_summary === null ? null : boundedText(raw.error_summary, 240),
  };
}

function parseScan(value: unknown): CapabilityInventoryScan {
  const raw = asRecord(value ?? {});
  const numberOrNull = (item: unknown) => item === null ? null : nonnegative(item);
  if ((raw.truncated !== null && typeof raw.truncated !== "boolean")) throw new Error("能力盤點的截斷狀態無法辨識。");
  return {
    maxEntries: numberOrNull(raw.max_entries),
    scannedFiles: numberOrNull(raw.scanned_files),
    excludedSensitiveOrCache: numberOrNull(raw.excluded_sensitive_or_cache),
    truncated: raw.truncated === null ? null : raw.truncated as boolean,
  };
}

function parseSignals(value: unknown): CapabilityServiceSignal[] {
  if (!Array.isArray(value)) throw new Error("能力盤點缺少 service_signals 陣列。");
  return value.map((item) => {
    const raw = asRecord(item);
    const manager = boundedText(raw.manager, 32);
    const name = boundedText(raw.name, 96);
    const state = boundedText(raw.state, 96);
    if (!manager || !name || !state) throw new Error("能力盤點包含不完整服務訊號。");
    return { manager, name, state };
  });
}

function parseCapabilityNode(value: unknown): CapabilityInventoryNode {
  const raw = asRecord(value);
  const candidateCounts = readCountMap(raw.candidate_counts);
  const allowedCandidates = Object.fromEntries(Object.entries(candidateCounts).filter(([key]) => key === "reuse_candidate" || key === "completion_candidate" || key === "unknown"));
  return {
    nodeId: parseNodeId(raw.node_id),
    reportState: parseState(raw.report_state),
    capturedAt: raw.captured_at === null ? null : requiredTimestamp(raw.captured_at, "能力盤點"),
    scan: parseScan(raw.scan),
    assetCounts: readCountMap(raw.asset_counts),
    capabilityCounts: readCountMap(raw.capability_counts),
    candidateCounts: allowedCandidates,
    serviceSignals: parseSignals(raw.service_signals),
    errorSummary: raw.error_summary === null ? null : boundedText(raw.error_summary, 240),
  };
}

function parseThreeNodes<T>(value: unknown, mapper: (node: unknown) => T & { nodeId: string }): T[] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error("盤點端點必須明確回報 N1、N2、N3 三個節點。");
  const nodes = value.map(mapper);
  if (new Set(nodes.map((node) => node.nodeId)).size !== 3) throw new Error("盤點端點包含重複節點。");
  return nodes;
}

export function parseSystemStorageInventory(value: unknown): SystemStorageInventory {
  const raw = asRecord(value);
  if (raw.source !== "n1-storage-inventory/1") throw new Error("儲存盤點來源契約不符。");
  return { capturedAt: requiredTimestamp(raw.captured_at, "儲存盤點"), source: "n1-storage-inventory/1", nodes: parseThreeNodes(raw.nodes, parseStorageNode) };
}

export function parseSystemCapabilityInventory(value: unknown): SystemCapabilityInventory {
  const raw = asRecord(value);
  if (raw.source !== "n1-capability-inventory/1") throw new Error("能力盤點來源契約不符。");
  return { capturedAt: requiredTimestamp(raw.captured_at, "能力盤點"), source: "n1-capability-inventory/1", nodes: parseThreeNodes(raw.nodes, parseCapabilityNode) };
}
