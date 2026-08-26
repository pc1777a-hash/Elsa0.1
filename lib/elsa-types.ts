export type ServiceState = "unknown" | "connected" | "disconnected";

export interface ServiceSettings {
  baseUrl: string;
  lastCheckedAt: string | null;
  lastStatus: ServiceState;
}

export interface Plugin {
  id: string;
  name: string;
  icon: string;
  cat: string;
  desc: string;
  enabled: boolean;
  config: Record<string, string>;
}

export interface ExchangeStatus {
  supported: string[];
  selected: string;
  keys: Record<string, boolean>;
}

export interface ExchangeBalance {
  balance: string;
}

export interface NativeHealth {
  status: string;
}

export interface TradePositions {
  positions: Array<Record<string, unknown>>;
}

export interface ServiceMemoryStats {
  active: number;
  backend: string;
  deep: number;
  embed_model: string;
  ok: boolean;
  total: number;
}

export interface ServiceMemoryItem {
  content: string;
  id: string;
  kind: string;
}

export interface ServiceMemoryRecent {
  memories: ServiceMemoryItem[];
  ok: boolean;
}

export interface TradeAutoLogItem {
  ema20: number;
  ema50: number;
  ok: boolean;
  paper: boolean;
  price: number;
  rsi: number;
  signal: string;
  strength: number;
  symbol: string;
  tf: string;
}

export interface TradeAutoStatus {
  active: boolean;
  configured: boolean;
  cycles: number;
  last: string;
  log: TradeAutoLogItem[];
  ok: boolean;
  paper: boolean;
  timestamp: string;
}

/**
 * Proposed N1 worker status contract. The App only accepts this shape when
 * the desktop worker returns an explicit boolean `online` field.
 */
export interface PerpetualBrainStatus {
  online: boolean;
  loopState?: string;
  lastHeartbeat?: string;
  activeTaskId?: string | null;
  queueDepth?: number;
  workerVersion?: string;
}

/** Public, credential-free execution metadata returned by N1 task routes. */
export interface PerpetualTask {
  taskId: string;
  kind: "code" | "research" | "maintenance";
  title: string;
  objective: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  currentStep?: string;
  failureReason?: string;
  testSummary?: string;
  gitSummary?: string;
  deploymentPolicy?: string;
  executorMode?: string;
}

/** Validated N1 `GET /api/perpetual/strategy-status` result. */
export interface PerpetualStrategyStatus {
  developmentTask: PerpetualTask | null;
  candidateVersion: string | null;
  deployedVersion: string | null;
  executorState: string;
  executorHeartbeat: string | null;
  riskGuardState: string;
  lastCycle: string | null;
}

/**
 * A voluntary, explicit self-report from N1. It is not inferred from a chat
 * reply, task contents, or any other service state.
 */
export interface AixiSelfReport {
  reportedAt: string;
  source: string;
  currentMood: string | null;
  currentFocus: string | null;
  nearTermIntent: string | null;
  longTermWishes: string[];
}

export interface SystemGpuResources {
  name: string;
  memoryUsedMb: number;
  memoryTotalMb: number;
}

/** Validated payload from N1 `GET /api/system/resources`. */
export interface SystemResources {
  capturedAt: string;
  gpu: SystemGpuResources | null;
  diskUsedGb: number;
  diskTotalGb: number;
  loadedModels: string[];
  queueDepth: number;
}

/** Explicit state emitted by a per-node N1 inventory report. */
export type InventoryReportState = "reported" | "stale" | "probe_failed" | "unreported";

export interface StorageInventoryVolume {
  mountPath: string;
  filesystemType: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number | null;
}

export interface StorageImportSource {
  id: string;
  label: string;
  state: "available" | "unreported";
  access: "user_selected" | "manual_only";
}

/** Sanitized, metadata-only report for one N1, N2, or N3 node. */
export interface StorageInventoryNode {
  nodeId: "N1" | "N2" | "N3";
  reportState: InventoryReportState;
  capturedAt: string | null;
  hostname: string | null;
  platform: string | null;
  release: string | null;
  volumes: StorageInventoryVolume[];
  importSources: StorageImportSource[];
  errorSummary: string | null;
}

export interface SystemStorageInventory {
  capturedAt: string;
  source: "n1-storage-inventory/1";
  nodes: StorageInventoryNode[];
}

export interface CapabilityInventoryScan {
  maxEntries: number | null;
  scannedFiles: number | null;
  excludedSensitiveOrCache: number | null;
  truncated: boolean | null;
}

export interface CapabilityServiceSignal {
  manager: string;
  name: string;
  state: string;
}

/** Aggregate-only report. It deliberately excludes paths, file content and secrets. */
export interface CapabilityInventoryNode {
  nodeId: "N1" | "N2" | "N3";
  reportState: InventoryReportState;
  capturedAt: string | null;
  scan: CapabilityInventoryScan;
  assetCounts: Record<string, number>;
  capabilityCounts: Record<string, number>;
  candidateCounts: Partial<Record<"reuse_candidate" | "completion_candidate" | "unknown", number>>;
  serviceSignals: CapabilityServiceSignal[];
  errorSummary: string | null;
}

export interface SystemCapabilityInventory {
  capturedAt: string;
  source: "n1-capability-inventory/1";
  nodes: CapabilityInventoryNode[];
}

/** Explicit N1 worker event; never inferred from a chat response or task title. */
export type ProactiveEventKind = "system_report" | "chat_invite" | "status_card";
export type ProactiveEventSeverity = "info" | "attention" | "warning" | "error";

export interface ProactiveEventVisual {
  kind: "portrait_card" | "generated_scene" | "memory_echo";
  label: string;
  isVisualization: true;
  generatedAt?: string;
  imageUrl?: string;
  imageOrigin?: "new_generation" | "memory_echo";
  characterReferenceVersion?: string;
  promptDigest?: string;
  memorySourceId?: string;
  memoryIntent?: string;
}

export interface ProactiveEvent {
  eventId: string;
  kind: ProactiveEventKind;
  severity: ProactiveEventSeverity;
  createdAt: string;
  source: string;
  trigger: string;
  title: string;
  body: string;
  verificationState: "reported" | "verified";
  relatedTaskId?: string;
  relatedReportId?: string;
  visual?: ProactiveEventVisual;
}

export interface ProactiveEventFeed {
  capturedAt: string;
  source: "n1-proactive-events/1";
  events: ProactiveEvent[];
}

export interface ServiceModelConfig {
  models: {
    autocoder: string;
    chat: string;
    default: string;
    embedding: string;
  };
}

export interface ServiceModels {
  models: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status?: "sending" | "sent" | "failed";
}

export interface StrategyDraftTask {
  id: string;
  market: string;
  timeframe: string;
  objective: string;
  riskLimit: string;
  status: "drafting" | "draft_ready" | "failed";
  createdAt: string;
  updatedAt: string;
  responseExcerpt?: string;
}

export interface ResearchTask {
  id: string;
  topic: string;
  status: "researching" | "saved" | "failed";
  createdAt: string;
  updatedAt: string;
  objective?: string;
  priority?: "critical" | "high" | "normal" | "low";
  acceptanceCriteria?: string;
  steps?: string[];
  dependencies?: string[];
  sourceProvenance?: string;
  indexState?: "local_only" | "pending_n1_index" | "indexed_n1" | "archived_r2" | "failed";
  r2ObjectKey?: string;
  responseExcerpt?: string;
  result?: string;
}

export type DocumentOutputFormat = "markdown" | "txt" | "docx" | "pdf";
export type DocumentTaskStatus = "draft" | "queued" | "producing" | "verified" | "indexed" | "archived" | "failed";
export type DocumentArtifactStatus = "produced" | "verified" | "indexed" | "archived" | "failed";

/** A request is not an artifact. Artifacts appear only after an explicit N1 report. */
export interface DocumentTask {
  id: string;
  title: string;
  purpose: string;
  requestedFormats: DocumentOutputFormat[];
  status: DocumentTaskStatus;
  createdAt: string;
  updatedAt: string;
  sourceTaskId?: string;
  n1TaskId?: string;
  failureReason?: string;
}

/** Sanitized N1 document result; file paths and document bodies are never returned. */
export interface DocumentArtifact {
  artifactId: string;
  documentTaskId: string;
  fileName: string;
  format: DocumentOutputFormat;
  status: DocumentArtifactStatus;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  verifiedAt?: string;
  indexState?: "pending_n1_index" | "indexed_n1" | "archived_r2" | "failed";
  r2State?: "pending" | "archived" | "failed" | "unreported";
  downloadUrl?: string;
  failureReason?: string;
}

export interface DocumentProductionReport {
  capturedAt: string;
  source: "n1-document-production/1";
  tasks: DocumentTask[];
  artifacts: DocumentArtifact[];
}

export interface SystemBible {
  title: string;
  version: string;
  status: string;
  timestamp: string;
  services: string[];
}
