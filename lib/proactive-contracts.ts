import type { ProactiveEvent, ProactiveEventFeed, ProactiveEventKind, ProactiveEventSeverity, ProactiveEventVisual } from "@/lib/elsa-types";

const MAX_EVENTS = 80;
const MAX_TITLE_LENGTH = 180;
const MAX_BODY_LENGTH = 1_200;

function asRecord(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new Error(`永動腦主動事件的${field}無法驗證。`);
  return value.trim();
}

function optionalBoundedString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return boundedString(value, field, maxLength);
}

function optionalHttpsUrl(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const url = boundedString(value, "視覺影像 URL", 1_500);
  try {
    if (new URL(url).protocol !== "https:") throw new Error("invalid protocol");
  } catch {
    throw new Error("永動腦主動事件的視覺影像 URL 必須為 HTTPS。 ");
  }
  return url;
}

function parseKind(value: unknown): ProactiveEventKind {
  if (value === "system_report" || value === "chat_invite" || value === "status_card") return value;
  throw new Error("永動腦主動事件種類不在允許契約內。");
}

function parseSeverity(value: unknown): ProactiveEventSeverity {
  if (value === "info" || value === "attention" || value === "warning" || value === "error") return value;
  throw new Error("永動腦主動事件缺少可驗證的嚴重度。");
}

function parseVisual(value: unknown): ProactiveEventVisual | undefined {
  if (value === undefined || value === null) return undefined;
  const visual = asRecord(value, "永動腦主動事件的視覺狀態無法驗證。");
  const kind = visual.kind;
  if (kind !== "portrait_card" && kind !== "generated_scene" && kind !== "memory_echo") throw new Error("永動腦主動事件的視覺種類不在允許契約內。");
  if (visual.is_visualization !== true) throw new Error("永動腦主動事件的視覺狀態缺少視覺化標記。");
  const imageUrl = optionalHttpsUrl(visual.image_url);
  const imageOrigin = visual.image_origin === undefined || visual.image_origin === null
    ? undefined
    : visual.image_origin === "new_generation" || visual.image_origin === "memory_echo"
      ? visual.image_origin
      : (() => { throw new Error("永動腦主動事件的影像來源不在允許契約內。"); })();
  const generatedAt = optionalBoundedString(visual.generated_at, "視覺生成時間", 80);
  const characterReferenceVersion = optionalBoundedString(visual.character_reference_version, "角色參考版本", 120);
  const promptDigest = optionalBoundedString(visual.prompt_digest, "提示摘要", 320);
  const memorySourceId = optionalBoundedString(visual.memory_source_id, "記憶來源 ID", 160);
  const memoryIntent = optionalBoundedString(visual.memory_intent, "回憶意圖", 320);

  if (imageUrl && kind === "memory_echo") {
    if (imageOrigin !== "memory_echo" || !memorySourceId || !memoryIntent) {
      throw new Error("記憶回響舊圖必須具備記憶來源與回憶意圖。 ");
    }
  }

  if (imageUrl && kind !== "memory_echo") {
    if (imageOrigin !== "new_generation" || !generatedAt || !characterReferenceVersion || !promptDigest) {
      throw new Error("即時狀態圖必須明確回報為新生成，並具備角色參考、提示摘要與生成時間。 ");
    }
  }

  return {
    kind,
    label: boundedString(visual.label, "視覺標籤", 120),
    isVisualization: true,
    generatedAt,
    imageUrl,
    imageOrigin,
    characterReferenceVersion,
    promptDigest,
    memorySourceId,
    memoryIntent,
  };
}

export function parseProactiveEvent(value: unknown): ProactiveEvent {
  const event = asRecord(value, "永動腦主動事件資料不是物件。");
  const verification = event.verification_state;
  if (verification !== "reported" && verification !== "verified") throw new Error("永動腦主動事件缺少驗證狀態。");
  return {
    eventId: boundedString(event.event_id, "事件 ID", 128),
    kind: parseKind(event.kind),
    severity: parseSeverity(event.severity),
    createdAt: boundedString(event.created_at, "建立時間", 80),
    source: boundedString(event.source, "來源", 160),
    trigger: boundedString(event.trigger, "觸發原因", 500),
    title: boundedString(event.title, "標題", MAX_TITLE_LENGTH),
    body: boundedString(event.body, "內容", MAX_BODY_LENGTH),
    verificationState: verification,
    relatedTaskId: optionalBoundedString(event.related_task_id, "關聯任務 ID", 128),
    relatedReportId: optionalBoundedString(event.related_report_id, "關聯報告 ID", 128),
    visual: parseVisual(event.visual),
  };
}

/**
 * Only explicit N1 worker events are accepted. Chat replies and unstructured
 * task output must never be converted into an apparent proactive action.
 */
export function parseProactiveEventFeed(payload: unknown): ProactiveEventFeed {
  const response = asRecord(payload, "永動腦主動收件匣端點未回傳可驗證資料。");
  if (response.source !== "n1-proactive-events/1") throw new Error("永動腦主動事件來源契約不符。");
  const capturedAt = boundedString(response.captured_at, "擷取時間", 80);
  if (!Array.isArray(response.events) || response.events.length > MAX_EVENTS) throw new Error("永動腦主動收件匣缺少受限事件陣列。");
  return {
    capturedAt,
    source: "n1-proactive-events/1",
    events: response.events.map(parseProactiveEvent),
  };
}
