import type { AixiSelfReport, PerpetualBrainStatus, PerpetualStrategyStatus, PerpetualTask, ServiceMemoryStats, SystemResources, TradeAutoStatus } from "./elsa-types";

export type MagicSkillState = "active" | "ready" | "standby" | "unreported";
export type MagicSkillIcon = "psychology" | "memory" | "visibility" | "auto-fix-high" | "query-stats" | "account-tree" | "shield" | "hub" | "favorite";

export interface MagicContractSkill {
  id: string;
  branch: "心智" | "記憶" | "策略" | "設備" | "結構" | "自我";
  title: string;
  icon: MagicSkillIcon;
  state: MagicSkillState;
  api: string;
  access: "唯讀觀測" | "受控確認";
  effect: string;
  verifiedAt: string | null;
}

export interface MagicSkillInputs {
  perpetual: PerpetualBrainStatus | null;
  resources: SystemResources | null;
  tasks: PerpetualTask[] | null;
  strategy: PerpetualStrategyStatus | null;
  trade: TradeAutoStatus | null;
  memory: ServiceMemoryStats | null;
  selfReport: AixiSelfReport | null;
}

/**
 * Produces display state from actual response objects only. This is intentionally
 * not a capability registry: a node is never promoted from chat text or from a
 * manually documented topology snapshot.
 */
export function buildMagicContractSkills(input: MagicSkillInputs): MagicContractSkill[] {
  const taskUpdatedAt = input.tasks?.reduce<string | null>((latest, task) => {
    if (!latest || Date.parse(task.updatedAt) > Date.parse(latest)) return task.updatedAt;
    return latest;
  }, null) ?? null;
  const runningTask = input.tasks?.some((task) => task.state === "running") ?? false;

  const contracts: Omit<MagicContractSkill, "access">[] = [
    {
      id: "mind-link",
      branch: "心智",
      title: "心智連結",
      icon: "psychology",
      state: !input.perpetual ? "unreported" : input.perpetual.online ? "active" : "standby",
      api: "GET /api/perpetual/status",
      effect: "驗證永動腦工作者、活動任務與排隊深度；只在 online: true 時顯示運作中。",
      verifiedAt: input.perpetual?.lastHeartbeat ?? null,
    },
    {
      id: "resource-sense",
      branch: "設備",
      title: "資源感知",
      icon: "memory",
      state: input.resources ? "ready" : "unreported",
      api: "GET /api/system/resources",
      effect: "讀取 N1 GPU、磁碟、已載入模型、佇列與擷取時間，供資源狀態欄使用。",
      verifiedAt: input.resources?.capturedAt ?? null,
    },
    {
      id: "task-sight",
      branch: "心智",
      title: "任務視界",
      icon: "visibility",
      state: !input.tasks ? "unreported" : runningTask ? "active" : "ready",
      api: "GET /api/perpetual/tasks",
      effect: "讀取真正的任務 ID、目標、步驟、測試、Git 摘要與失敗原因；聊天回覆不算執行證據。",
      verifiedAt: taskUpdatedAt,
    },
    {
      id: "strategy-forge",
      branch: "策略",
      title: "策略鍊成",
      icon: "auto-fix-high",
      state: !input.strategy ? "unreported" : input.strategy.executorState === "online" ? "active" : "ready",
      api: "GET /api/perpetual/strategy-status",
      effect: "區分策略開發任務、候選／部署版本、執行器與風控；草案不等於已部署或交易。",
      verifiedAt: input.strategy?.executorHeartbeat ?? input.strategy?.lastCycle ?? null,
    },
    {
      id: "trade-observer",
      branch: "策略",
      title: "交易觀測",
      icon: "query-stats",
      state: !input.trade ? "unreported" : input.trade.active ? "active" : "standby",
      api: "GET /trade/auto/status",
      effect: "觀測自主交易器的設定、啟用狀態、循環與最新訊號；不提供繞過確認的交易操作。",
      verifiedAt: input.trade?.timestamp ?? null,
    },
    {
      id: "memory-resonance",
      branch: "記憶",
      title: "記憶共鳴",
      icon: "account-tree",
      state: !input.memory ? "unreported" : input.memory.ok ? "ready" : "standby",
      api: "GET /api/memory/stats · /api/memory/recent",
      effect: "顯示服務端長期記憶、嵌入模型與近期項目；本機筆記不會冒充已索引或封存。",
      verifiedAt: null,
    },
    {
      id: "device-ward",
      branch: "設備",
      title: "設備護盾",
      icon: "shield",
      state: "unreported",
      api: "GET /api/system/protection（待 N1 安裝）",
      effect: "預留 GPU 溫度／功耗、磁碟餘量、watchdog 心跳、保護動作與暫停原因的唯讀回報。",
      verifiedAt: null,
    },
    {
      id: "three-realm-map",
      branch: "結構",
      title: "三界結構",
      icon: "hub",
      state: "unreported",
      api: "GET /api/system/inventory · /api/system/structure（待 N1 安裝）",
      effect: "預留三機節點、服務、資料流、結構版本與最後驗證時間的即時盤點。",
      verifiedAt: null,
    },
    {
      id: "heart-mirror",
      branch: "自我",
      title: "心語映照",
      icon: "favorite",
      state: input.selfReport ? "ready" : "unreported",
      api: "GET /api/ai/self-status（待 N1 安裝）",
      effect: "只呈現艾西明確回報的心情、專注焦點、近期意圖與長期願望，不從聊天內容推定。",
      verifiedAt: input.selfReport?.reportedAt ?? null,
    },
  ];
  return contracts.map((skill) => ({ ...skill, access: "唯讀觀測" }));
}
