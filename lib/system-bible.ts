import type { SystemBible } from "@/lib/elsa-types";

export const SYSTEM_BIBLE_URL = "https://brain.pin-yi.uk/api/system/bible";

export async function getSystemBible(): Promise<SystemBible> {
  let response: Response;
  try {
    response = await fetch(SYSTEM_BIBLE_URL, { headers: { Accept: "application/json" } });
  } catch {
    throw new Error("無法讀取公開系統架構狀態。");
  }
  if (!response.ok) throw new Error(`系統架構服務回應 ${response.status}。`);
  const payload = await response.json() as SystemBible;
  if (!payload.title || !Array.isArray(payload.services)) throw new Error("系統架構服務回傳格式不正確。");
  return payload;
}
