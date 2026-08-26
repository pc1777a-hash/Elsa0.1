# 艾西永動腦任務與可觀測契約

## 目的

App 的對話功能只能經由 `POST /ask` 取得文字回覆，**不得把回覆視為任務已執行**。編碼、研究與三機維護應由 N1 的永動腦工作者處理；手機僅建立任務、查詢真實進度、要求取消，以及在需要時確認部署。

截至 2026-08-18，公開探測顯示 `/api/autocode` 支援 `POST`，但 `GET /api/autocode` 回傳 `405`，尚未取得任務提交或狀態資料的 JSON 契約。候選路由 `GET /api/perpetual/status` 回傳 `404`，`GET /api/system/resources` 未在限定時間內回應；因此 App 必須顯示「未回報」，不能宣稱永動腦已執行或 GPU 資源足夠。`elsa-selfevolve` 的「停止」狀態也只來自主人提供的靜態脈絡，不能在 App 顯示為即時狀態。

## 執行方式比較

| 方式 | 適用情境 | 優點 | 限制 |
| --- | --- | --- | --- |
| N1 永動腦工作者 | 需要使用本機 Ollama、專案工作區、Git 與三機網格時 | 使用現有大腦與資料；手機不保存憑證 | N1 必須保持開機；需要提供受控任務 API |
| 外部持續工作者 | 只需要雲端 API、長時間排程與通知時 | 不依賴家中桌機持續連線 | 無法直接使用 N1 本機 GPU／檔案，並需要額外部署與憑證管理 |

本專案以 **N1 永動腦工作者** 為預設。它不是 App 的背景程序；App 只能觀測和發送受控任務。

## 最小 API 契約

| 路由 | 方法 | 安全用途 | 必須回傳 |
| --- | --- | --- | --- |
| `/api/perpetual/status` | `GET` | 目前永動腦是否存活 | `online`、`loop_state`、`last_heartbeat`、`active_task_id`、`queue_depth`、`worker_version` |
| `/api/perpetual/tasks` | `GET` | 讀取任務佇列與歷史 | 任務陣列，不含秘密值或完整私鑰／Token |
| `/api/perpetual/tasks` | `POST` | 建立 `code`、`research` 或 `maintenance` 任務 | `task_id`、`state`、`created_at` |
| `/api/perpetual/tasks/:id` | `GET` | 讀取單一任務實際狀態 | `state`、`step`、`tool_events`、`test_summary`、`git_summary`、`failure_reason` |
| `/api/perpetual/tasks/:id/cancel` | `POST` | 停止尚未完成的任務 | `task_id`、`state`、`cancelled_at` |
| `/api/perpetual/tasks/:id/approve-deploy` | `POST` | 明確允許已通過測試的部署 | `task_id`、`state`、`approval_at` |
| `/api/system/resources` | `GET` | 回報 N1 實際資源，不暴露檔案內容或憑證 | `gpu`、`disk`、`loaded_models`、`queue_depth`、`captured_at` |

## 任務請求格式

```json
{
  "kind": "code",
  "title": "改善記憶檢索摘要",
  "objective": "在既有測試通過前提下改善摘要品質",
  "scope": ["/media/ollama/n1/brain"],
  "acceptance_criteria": ["新增或更新測試", "輸出 Git diff 摘要", "不直接部署"],
  "deployment_policy": "require_approval"
}
```

`code` 任務可以寫入由永動腦管理的工作分支與執行測試；它不可將 Git、SSH、雲端或交易所憑證回傳給 App。任何真正部署、服務重啟、配置覆寫或交易行為都必須以明確狀態及可追蹤任務 ID 回報。

## App 呈現規則

| 條件 | App 顯示 |
| --- | --- |
| 沒有 `/api/perpetual/status` | 「永動腦回報端點未就緒」，不可顯示執行中 |
| `online: false` 或逾時 | 「永動腦未執行／心跳逾時」與最後回報時間 |
| 任務 `queued` 或 `running` | 任務 ID、目前步驟、工具事件與開始時間 |
| 任務 `needs_approval` | 測試與 Git 摘要，以及「等待部署確認」 |
| 任務 `failed` | 實際失敗原因；不以「艾西已收到」取代失敗資訊 |

## 與現有 `/api/autocode` 的關係

永動腦工作者可在其內部使用既有 `/api/autocode`，但應由工作者保存並回傳任務 ID、步驟、測試與 Git 結果。App 在未驗證 `POST /api/autocode` 的請求／回應契約之前，**不得直接從手機呼叫該路由**。

## 策略生命週期與獨立交易執行器

永動腦可以調用編碼工具來建立、修改、回測與評估策略；實際交易由獨立執行器依已部署版本和固定風控規則執行。兩者不可共用「聊天已回覆」作為執行依據。

| 狀態 | 擁有者 | 需要的實際證據 | App 顯示 |
| --- | --- | --- | --- |
| `draft` | 永動腦 | 任務 ID 與工作分支 | 草案進行中 |
| `testing` | 永動腦 | 測試／回測摘要與提交版本 | 正在驗證 |
| `candidate` | 永動腦 | 風險、測試和 Git 摘要 | 等待核准 |
| `deployed` | 部署控制器 | 部署版本、時間和環境 | 目前已部署策略 |
| `running` | 交易執行器 | 心跳、策略版本、風控與最近循環 | 執行器運行中 |
| `halted` | 交易執行器 | 熔斷／風控原因與時間 | 執行器已停止 |

建議的唯讀狀態路由為 `GET /api/perpetual/strategy-status`。它至少應回傳 `development_task`、`candidate_version`、`deployed_version`、`executor_state`、`executor_heartbeat`、`risk_guard_state` 與 `last_cycle`。App 在缺少這些欄位時只顯示「服務端未回報」，不從模型回答或交易訊號推論策略是否已部署或正在執行。

## N1 資源回報

N1 可持續工作取決於模型、GPU 顯存、磁碟與佇列是否有餘裕；這些數據不能由 App 固定寫死。`GET /api/system/resources` 應以簡潔的唯讀摘要回傳，例如：

```json
{
  "captured_at": "2026-08-18T08:00:00Z",
  "gpu": {"name": "…", "memory_used_mb": 0, "memory_total_mb": 0},
  "disk": {"used_gb": 0, "total_gb": 0},
  "loaded_models": ["…"],
  "queue_depth": 0
}
```

當 `memory_used_mb` 或 `disk.used_gb` 缺失時，App 只能呈現「資源未回報」。對長篇影片、模型微調或大量原始影片研究，永動腦應建立外部儲存／雲端工作項目，而非把素材、模型與向量索引無限制堆入 N1。
