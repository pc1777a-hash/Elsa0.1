import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ChatMessage, DocumentTask, ResearchTask, ServiceSettings, StrategyDraftTask } from "@/lib/elsa-types";

const SETTINGS_KEY = "elsa-v5-service-settings";
const CHAT_KEY = "elsa-v5-chat-history";
const AIXI_VOICE_MUTED_KEY = "elsa-v5-aixi-voice-muted";
const STRATEGY_TASK_KEY = "elsa-v5-latest-strategy-task";
const RESEARCH_TASK_KEY = "elsa-v5-research-tasks";
const DOCUMENT_TASK_KEY = "elsa-v5-document-tasks";
const INITIAL_SETTINGS: ServiceSettings = {
  baseUrl: "https://elsa.pin-yi.uk",
  lastCheckedAt: null,
  lastStatus: "unknown",
};

export async function getServiceSettings(): Promise<ServiceSettings> {
  const saved = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!saved) return INITIAL_SETTINGS;

  try {
    return { ...INITIAL_SETTINGS, ...JSON.parse(saved) } as ServiceSettings;
  } catch {
    return INITIAL_SETTINGS;
  }
}

export async function saveServiceSettings(settings: ServiceSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function getChatHistory(): Promise<ChatMessage[]> {
  const saved = await AsyncStorage.getItem(CHAT_KEY);
  if (!saved) return [];

  try {
    return JSON.parse(saved) as ChatMessage[];
  } catch {
    return [];
  }
}

export async function saveChatHistory(messages: ChatMessage[]): Promise<void> {
  await AsyncStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-60)));
}

export async function clearChatHistory(): Promise<void> {
  await AsyncStorage.removeItem(CHAT_KEY);
}

/** The owner can silence device output without removing Aixi's voice choice from a reply. */
export async function getAixiVoiceMuted(): Promise<boolean> {
  return (await AsyncStorage.getItem(AIXI_VOICE_MUTED_KEY)) === "true";
}

export async function saveAixiVoiceMuted(muted: boolean): Promise<void> {
  await AsyncStorage.setItem(AIXI_VOICE_MUTED_KEY, String(muted));
}

export async function getLatestStrategyTask(): Promise<StrategyDraftTask | null> {
  const saved = await AsyncStorage.getItem(STRATEGY_TASK_KEY);
  if (!saved) return null;

  try {
    const task = JSON.parse(saved) as StrategyDraftTask;
    return isStrategyTask(task) ? task : null;
  } catch {
    return null;
  }
}

export async function saveLatestStrategyTask(task: StrategyDraftTask): Promise<void> {
  await AsyncStorage.setItem(STRATEGY_TASK_KEY, JSON.stringify(task));
}

export async function getResearchTasks(): Promise<ResearchTask[]> {
  const saved = await AsyncStorage.getItem(RESEARCH_TASK_KEY);
  if (!saved) return [];
  try {
    const tasks = JSON.parse(saved) as ResearchTask[];
    return Array.isArray(tasks) ? tasks.filter(isResearchTask).slice(0, 30) : [];
  } catch {
    return [];
  }
}

export async function saveResearchTask(task: ResearchTask): Promise<void> {
  const existing = await getResearchTasks();
  const next = [task, ...existing.filter((item) => item.id !== task.id)].slice(0, 30);
  await AsyncStorage.setItem(RESEARCH_TASK_KEY, JSON.stringify(next));
}

export async function getDocumentTasks(): Promise<DocumentTask[]> {
  const saved = await AsyncStorage.getItem(DOCUMENT_TASK_KEY);
  if (!saved) return [];
  try {
    const tasks = JSON.parse(saved) as DocumentTask[];
    return Array.isArray(tasks) ? tasks.filter(isDocumentTask).slice(0, 30) : [];
  } catch {
    return [];
  }
}

export async function saveDocumentTask(task: DocumentTask): Promise<void> {
  const existing = await getDocumentTasks();
  const next = [task, ...existing.filter((item) => item.id !== task.id)].slice(0, 30);
  await AsyncStorage.setItem(DOCUMENT_TASK_KEY, JSON.stringify(next));
}

export async function clearLocalPreferences(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(SETTINGS_KEY),
    AsyncStorage.removeItem(CHAT_KEY),
    AsyncStorage.removeItem(AIXI_VOICE_MUTED_KEY),
    AsyncStorage.removeItem(STRATEGY_TASK_KEY),
    AsyncStorage.removeItem(RESEARCH_TASK_KEY),
    AsyncStorage.removeItem(DOCUMENT_TASK_KEY),
  ]);
}

function isStrategyTask(value: unknown): value is StrategyDraftTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<StrategyDraftTask>;
  return typeof task.id === "string"
    && typeof task.market === "string"
    && typeof task.timeframe === "string"
    && typeof task.objective === "string"
    && typeof task.riskLimit === "string"
    && typeof task.createdAt === "string"
    && typeof task.updatedAt === "string"
    && (task.status === "drafting" || task.status === "draft_ready" || task.status === "failed");
}

function isResearchTask(value: unknown): value is ResearchTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<ResearchTask>;
  return typeof task.id === "string"
    && typeof task.topic === "string"
    && typeof task.createdAt === "string"
    && typeof task.updatedAt === "string"
    && (task.status === "researching" || task.status === "saved" || task.status === "failed");
}

function isDocumentTask(value: unknown): value is DocumentTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<DocumentTask>;
  const statuses: DocumentTask["status"][] = ["draft", "queued", "producing", "verified", "indexed", "archived", "failed"];
  const formats: DocumentTask["requestedFormats"][number][] = ["markdown", "txt", "docx", "pdf"];
  return typeof task.id === "string"
    && typeof task.title === "string"
    && typeof task.purpose === "string"
    && Array.isArray(task.requestedFormats)
    && task.requestedFormats.length > 0
    && task.requestedFormats.every((format) => formats.includes(format))
    && typeof task.createdAt === "string"
    && typeof task.updatedAt === "string"
    && statuses.includes(task.status as DocumentTask["status"]);
}
