# runtime_gold 唯讀整合計畫

## 目的

`/media/ollama/n1/runtime_gold` 已被盤點為一套具備協調器、執行器、工作區、記憶、狀態、專案與儲存目錄的既有 runtime。其模組清單顯示有 `memory_manager`、`knowledge_graph`、`event_bus`、`health_monitor`、`task_queue`、`reflection`、`verifier`、`model_registry` 與 `resource_manager` 等候選能力。

本計畫的目標不是替換既有 ELSA N1 服務，也不是直接啟動 `runtime_gold`。第一階段只建立**唯讀事實層**，讓艾西可在記憶中心中知道哪些資料與工作者存在、其最後回報為何，以及哪些能力尚未接線。

## 分層邊界

| 層級 | 既有位置或模組 | 第一階段動作 | 禁止事項 |
|---|---|---|---|
| Runtime | `agents/orchestrator/server.js`、`agents/executor/server.js` | 讀取程序、入口與健康資訊 | 不自行啟動、停止、重啟或覆寫 |
| 記憶 | `memory`、`memory_manager`、`knowledge_graph`、`reflection` | 僅讀取結構、索引計數、最後修改時間與已回報摘要 | 不匯入、刪除、重建索引或讀取敏感原文 |
| 任務 | `task_queue`、`goal_manager`、`planner`、`executor_router` | 讀取佇列數、狀態分布與任務 ID | 不提交、取消或執行任務 |
| 驗證與健康 | `health_monitor`、`verifier`、`test_runner`、`system_status` | 讀取健康訊號、最近驗證時間及失敗摘要 | 不執行測試或修復程序 |
| 變更治理 | `patch_manager`、`self_repair`、`code_generator` | 盤點模組是否存在及其接線狀態 | 不產生補丁、不套用修復或修改任何程式 |

## 最小唯讀適配器契約

未來的 N1 適配器只可回傳下列可驗證欄位，不傳送原始記憶、程式碼、私密設定、工作區內容或憑證。

```json
{
  "captured_at": "ISO-8601 UTC",
  "source": "runtime-gold-readonly/1",
  "runtime": {
    "root": "/media/ollama/n1/runtime_gold",
    "entrypoints": [{ "role": "orchestrator", "state": "unknown" }],
    "workspace_state": "unknown"
  },
  "memory": {
    "state": "reported | unreported | probe_failed",
    "index_count": null,
    "last_updated_at": null
  },
  "tasks": {
    "state": "reported | unreported | probe_failed",
    "counts": { "queued": null, "running": null, "failed": null }
  },
  "modules": [
    { "id": "memory_manager", "state": "present", "connection_state": "unknown" }
  ],
  "error_summary": null
}
```

## 艾西使用記憶的閉環

艾西只能把有來源、時間、任務 ID 或健康快照的結果納入決策依據。新任務應先檢索已確認的成功條件、失敗原因、資源限制與主人核准紀錄，再提出可審閱的下一步。聊天回覆、檔名、模組名稱或程式存在本身，都不是任務完成或能力已接線的證據。

## 後續部署順序

1. 先執行 runtime_gold 唯讀盤點，確認入口、服務與資料夾擁有者。
2. 將盤點結果以新的唯讀 N1 回報路由寫入 ELSA，並通過 App 契約驗證。
3. 由主人審閱是否需要連接記憶摘要、任務計數與健康訊號。
4. 每一個寫入、部署、啟動或修復能力，都另行提出計畫、健康檢查與回滾點；不因本唯讀整合而自動啟用。
