export interface CurrentStrategy {
  name: string;
  source: string;
}

export interface StrategyDraftInput {
  market: string;
  timeframe: string;
  objective: string;
  riskLimit: string;
}

const STRATEGY_KEYS = ["active_strategy", "current_strategy", "strategy_name", "strategy"] as const;
const NESTED_KEYS = ["automation", "trading", "trade", "status", "config"] as const;

export function getCurrentStrategy(...sources: unknown[]): CurrentStrategy | null {
  for (const source of sources) {
    const found = extractStrategy(source);
    if (found) return found;
  }
  return null;
}

export function buildStrategyDraftPrompt(input: StrategyDraftInput): string {
  return [
    "請以 ELSA 的策略開發代理身分，建立一份可審閱的自主交易策略程式草案。",
    `市場：${input.market}`,
    `時間週期：${input.timeframe}`,
    `策略目標：${input.objective}`,
    `風險限制：${input.riskLimit}`,
    "輸出順序：1) 已知資料與假設；2) 策略規則與失效條件；3) 可放入 ELSA 策略模組的 Python 程式草案；4) 單元測試與回測步驟；5) 部署前檢查清單。",
    "這是草案任務：不得下單、不得啟動交易、不得掛載策略、不得覆寫桌機檔案。若原生工具可使用，只能建立隔離的草案檔並回報檔案路徑與測試結果，等待擁有者在桌機端明確確認後才可部署。",
  ].join("\n");
}

function extractStrategy(value: unknown, depth = 0): CurrentStrategy | null {
  if (depth > 2 || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  for (const key of STRATEGY_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return { name: candidate.trim(), source: key };
    }
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const nested = candidate as Record<string, unknown>;
      const name = [nested.name, nested.id, nested.label].find((item): item is string => typeof item === "string" && Boolean(item.trim()));
      if (name) return { name: name.trim(), source: key };
    }
  }

  for (const key of NESTED_KEYS) {
    const nested = extractStrategy(record[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}
