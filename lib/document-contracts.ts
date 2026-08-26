import type { DocumentArtifact, DocumentArtifactStatus, DocumentOutputFormat, DocumentProductionReport, DocumentTask, DocumentTaskStatus } from "@/lib/elsa-types";

type JsonRecord = Record<string, unknown>;

const FORMATS = new Set<DocumentOutputFormat>(["markdown", "txt", "docx", "pdf"]);
const TASK_STATES = new Set<DocumentTaskStatus>(["draft", "queued", "producing", "verified", "indexed", "archived", "failed"]);
const ARTIFACT_STATES = new Set<DocumentArtifactStatus>(["produced", "verified", "indexed", "archived", "failed"]);
const INDEX_STATES = new Set<NonNullable<DocumentArtifact["indexState"]>>(["pending_n1_index", "indexed_n1", "archived_r2", "failed"]);
const R2_STATES = new Set<NonNullable<DocumentArtifact["r2State"]>>(["pending", "archived", "failed", "unreported"]);

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("文件產製端點回傳的資料結構無法辨識。");
  return value as JsonRecord;
}

function text(value: unknown, limit: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit ? value.trim() : null;
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, 64);
  if (!result || Number.isNaN(Date.parse(result))) throw new Error(`${label}缺少有效時間。`);
  return result;
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return timestamp(value, label);
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label}必須是非負整數。`);
  return value;
}

function optionalHttpsUrl(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = text(value, 1800);
  if (!raw) throw new Error("文件下載連結格式無法辨識。");
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new Error("文件下載連結必須為 HTTPS。 ");
  }
}

function documentFormats(value: unknown): DocumentOutputFormat[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) throw new Error("文件任務缺少有效輸出格式。 ");
  const formats = value.map((item) => {
    if (typeof item !== "string" || !FORMATS.has(item as DocumentOutputFormat)) throw new Error("文件任務包含未知輸出格式。 ");
    return item as DocumentOutputFormat;
  });
  if (new Set(formats).size !== formats.length) throw new Error("文件任務輸出格式不可重複。 ");
  return formats;
}

function parseTask(value: unknown): DocumentTask {
  const raw = record(value);
  const id = text(raw.document_task_id, 96);
  const title = text(raw.title, 160);
  const purpose = text(raw.purpose, 2000);
  if (!id || !title || !purpose || typeof raw.state !== "string" || !TASK_STATES.has(raw.state as DocumentTaskStatus)) {
    throw new Error("文件產製回報包含不完整任務。 ");
  }
  const failureReason = raw.failure_reason === null || raw.failure_reason === undefined ? undefined : text(raw.failure_reason, 480);
  if (raw.failure_reason !== null && raw.failure_reason !== undefined && !failureReason) throw new Error("文件任務失敗原因無法辨識。 ");
  const sourceTaskId = raw.source_task_id === null || raw.source_task_id === undefined ? undefined : text(raw.source_task_id, 96);
  const n1TaskId = raw.n1_task_id === null || raw.n1_task_id === undefined ? undefined : text(raw.n1_task_id, 96);
  return {
    id,
    title,
    purpose,
    requestedFormats: documentFormats(raw.requested_formats),
    status: raw.state as DocumentTaskStatus,
    createdAt: timestamp(raw.created_at, "文件任務"),
    updatedAt: timestamp(raw.updated_at, "文件任務"),
    ...(sourceTaskId ? { sourceTaskId } : {}),
    ...(n1TaskId ? { n1TaskId } : {}),
    ...(failureReason ? { failureReason } : {}),
  };
}

function parseArtifact(value: unknown): DocumentArtifact {
  const raw = record(value);
  const artifactId = text(raw.artifact_id, 96);
  const documentTaskId = text(raw.document_task_id, 96);
  const fileName = text(raw.file_name, 180);
  const sha256 = text(raw.sha256, 64);
  if (!artifactId || !documentTaskId || !fileName || !sha256 || !/^[a-f0-9]{64}$/i.test(sha256) || typeof raw.format !== "string" || !FORMATS.has(raw.format as DocumentOutputFormat) || typeof raw.status !== "string" || !ARTIFACT_STATES.has(raw.status as DocumentArtifactStatus)) {
    throw new Error("文件產物回報不完整或雜湊格式無效。 ");
  }
  const indexState = raw.index_state === null || raw.index_state === undefined ? undefined : raw.index_state;
  const r2State = raw.r2_state === null || raw.r2_state === undefined ? undefined : raw.r2_state;
  if (indexState !== undefined && (typeof indexState !== "string" || !INDEX_STATES.has(indexState as NonNullable<DocumentArtifact["indexState"]>))) throw new Error("文件產物索引狀態無法辨識。 ");
  if (r2State !== undefined && (typeof r2State !== "string" || !R2_STATES.has(r2State as NonNullable<DocumentArtifact["r2State"]>))) throw new Error("文件產物封存狀態無法辨識。 ");
  const failureReason = raw.failure_reason === null || raw.failure_reason === undefined ? undefined : text(raw.failure_reason, 480);
  if (raw.failure_reason !== null && raw.failure_reason !== undefined && !failureReason) throw new Error("文件產物失敗原因無法辨識。 ");
  return {
    artifactId,
    documentTaskId,
    fileName,
    format: raw.format as DocumentOutputFormat,
    status: raw.status as DocumentArtifactStatus,
    sizeBytes: positiveInteger(raw.size_bytes, "文件產物大小"),
    sha256: sha256.toLowerCase(),
    createdAt: timestamp(raw.created_at, "文件產物"),
    ...(optionalTimestamp(raw.verified_at, "文件產物驗證") ? { verifiedAt: optionalTimestamp(raw.verified_at, "文件產物驗證") } : {}),
    ...(indexState !== undefined ? { indexState: indexState as DocumentArtifact["indexState"] } : {}),
    ...(r2State !== undefined ? { r2State: r2State as DocumentArtifact["r2State"] } : {}),
    ...(optionalHttpsUrl(raw.download_url) ? { downloadUrl: optionalHttpsUrl(raw.download_url) } : {}),
    ...(failureReason ? { failureReason } : {}),
  };
}

/** Rejects a report if N1 does not explicitly identify its source, time, tasks and artifacts. */
export function parseDocumentProductionReport(value: unknown): DocumentProductionReport {
  const raw = record(value);
  if (raw.source !== "n1-document-production/1") throw new Error("文件產製來源契約不符。 ");
  if (!Array.isArray(raw.tasks) || !Array.isArray(raw.artifacts)) throw new Error("文件產製端點缺少任務或產物陣列。 ");
  const tasks = raw.tasks.slice(0, 50).map(parseTask);
  const artifacts = raw.artifacts.slice(0, 100).map(parseArtifact);
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length || new Set(artifacts.map((artifact) => artifact.artifactId)).size !== artifacts.length) {
    throw new Error("文件產製端點包含重複識別碼。 ");
  }
  const taskIds = new Set(tasks.map((task) => task.id));
  if (artifacts.some((artifact) => !taskIds.has(artifact.documentTaskId))) throw new Error("文件產物缺少對應任務。 ");
  return { capturedAt: timestamp(raw.captured_at, "文件產製"), source: "n1-document-production/1", tasks, artifacts };
}
