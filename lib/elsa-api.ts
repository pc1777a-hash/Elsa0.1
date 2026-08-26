import { getServiceSettings } from "@/lib/elsa-storage";
import type { AixiSelfReport, DocumentProductionReport, ExchangeBalance, ExchangeStatus, NativeHealth, PerpetualBrainStatus, PerpetualStrategyStatus, PerpetualTask, Plugin, ProactiveEventFeed, ServiceMemoryRecent, ServiceMemoryStats, ServiceModelConfig, ServiceModels, SystemCapabilityInventory, SystemResources, SystemStorageInventory, TradeAutoStatus, TradePositions } from "@/lib/elsa-types";
import { speak } from "@/lib/tts-service";
import { parseDocumentProductionReport } from "@/lib/document-contracts";
import { parseSystemCapabilityInventory, parseSystemStorageInventory } from "@/lib/inventory-contracts";
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '未知錯誤';
}

