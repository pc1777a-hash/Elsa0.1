import AsyncStorage from "@react-native-async-storage/async-storage";

export type ActivityKind = "success" | "error" | "info";
export type ActivitySource = "control" | "memory" | "strategy" | "trading";

export interface ActivityLogEntry {
  id: string;
  kind: ActivityKind;
  source: ActivitySource;
  title: string;
  detail: string;
  createdAt: string;
}

const ACTIVITY_LOG_KEY = "elsa-v5-activity-log";
const MAX_ENTRIES = 120;

export async function getActivityLog(): Promise<ActivityLogEntry[]> {
  const saved = await AsyncStorage.getItem(ACTIVITY_LOG_KEY);
  if (!saved) return [];

  try {
    const entries = JSON.parse(saved) as ActivityLogEntry[];
    return Array.isArray(entries) ? entries.filter(isEntry).slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

export async function appendActivityLog(entry: Omit<ActivityLogEntry, "id" | "createdAt">): Promise<ActivityLogEntry> {
  const nextEntry: ActivityLogEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  const previous = await getActivityLog();
  await AsyncStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify([nextEntry, ...previous].slice(0, MAX_ENTRIES)));
  return nextEntry;
}

export async function clearActivityLog(): Promise<void> {
  await AsyncStorage.removeItem(ACTIVITY_LOG_KEY);
}

function isEntry(value: unknown): value is ActivityLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<ActivityLogEntry>;
  return typeof entry.id === "string"
    && typeof entry.title === "string"
    && typeof entry.detail === "string"
    && typeof entry.createdAt === "string"
    && (entry.kind === "success" || entry.kind === "error" || entry.kind === "info")
    && (entry.source === "control" || entry.source === "memory" || entry.source === "strategy" || entry.source === "trading");
}
