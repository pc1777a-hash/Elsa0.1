# 多平台集中視圖與並行任務契約

## 目的

本契約定義 ELSA App 如何以一個集中視圖顯示由 N1 控制平面協調的多個已授權平台。它支援同時追蹤多個平台、同一平台上的多個工作區與多個任務，但**不代表任何平台已接線、已登入或已執行**。在 N1 沒有明確回報前，App 一律顯示「待啟用」或「未回報」。

| 層級 | 責任 | App 可見內容 | 禁止事項 |
|---|---|---|---|
| ELSA App | 集中觀測、提出任務意圖、顯示核准與結果 | 平台摘要、任務隊列、證據、錯誤與取消能力 | 不保存帳密、Token、Cookie、SSH 金鑰或平台私密設定 |
| N1 控制平面 | 管理平台連線、權限範圍、排程、健康檢查與審計 | 已脫敏的狀態、任務 ID、事件、輸出摘要與證據雜湊 | 不將聊天文字當作完成證據 |
| 平台工作者 | 以各平台 API、官方工具或受控瀏覽器執行已核准任務 | 平台執行 ID、開始／結束時間、輸出與失敗原因 | 不跨帳號、跨工作區或越過能力白名單執行 |

## 平台與工作區身分

每個平台必須先由 N1 建立一筆**平台帳戶配置**，再允許出現在集中視圖。平台名稱只是顯示名稱；所有操作依固定 ID、工作區範圍與能力白名單判定。

```json
{
  "platform_id": "video-production",
  "display_name": "影片製作平台",
  "workspace_id": "studio-primary",
  "connection_state": "connected",
  "capabilities": ["job_submit", "job_status", "artifact_read"],
  "allowed_actions": ["draft", "render"],
  "reported_at": "2026-08-18T10:00:00Z",
  "source": "n1-platform-report/1"
}
```

| 欄位 | 規則 |
|---|---|
| `platform_id` | 小寫固定識別碼；不得由顯示名稱推論。 |
| `workspace_id` | 平台內帳號、專案、頻道或租戶的已脫敏範圍 ID；缺失時不得提交任務。 |
| `connection_state` | `unconfigured`、`connecting`、`connected`、`degraded`、`revoked` 或 `failed`。 |
| `capabilities` | N1 已驗證的最小能力集合，不能因模型文字自行點亮。 |
| `allowed_actions` | 在該工作區被允許的動作白名單；空集合代表唯讀。 |
| `source`、`reported_at` | 必填，用以區分新鮮回報、舊快照與未回報。 |

## 並行任務編排

艾西可以提出多個平台任務，但 N1 必須依每個平台、工作區和能力各自建立任務。每個任務都需要明確核准策略與可驗證結果。並行只是多個獨立任務同時處於執行狀態，**不能共用憑證、混合輸出或跳過核准**。

```json
{
  "task_id": "platform-task-20260818-001",
  "platform_id": "video-production",
  "workspace_id": "studio-primary",
  "action": "render",
  "approval_state": "approved",
  "state": "running",
  "submitted_at": "2026-08-18T10:01:00Z",
  "started_at": "2026-08-18T10:02:00Z",
  "platform_execution_id": "redacted-execution-id",
  "evidence": {
    "kind": "platform_job_status",
    "digest": "sha256:...",
    "observed_at": "2026-08-18T10:02:04Z"
  }
}
```

| 狀態 | 含義 | App 呈現要求 |
|---|---|---|
| `draft` | 艾西已提出意圖，尚未送出 | 顯示「草案」，不得寫成執行中。 |
| `awaiting_approval` | 具目標與影響範圍，等待主人確認 | 可列出動作與工作區，但不顯示為平台操作已發生。 |
| `queued` | N1 已接受並等待工作者 | 顯示任務 ID 與排隊時間。 |
| `running` | 工作者已取得平台執行證據 | 必須有 `platform_execution_id` 或等價的可驗證事件。 |
| `succeeded` | 平台明確回覆成功，且輸出可追溯 | 顯示摘要、產物或雜湊；聊天說「完成」無效。 |
| `failed` | 平台或工作者回傳失敗 | 顯示安全的失敗原因和可重試／回滾能力。 |
| `cancelled`、`rolled_back` | 任務被取消或已復原 | 顯示取消或回滾時間與執行證據。 |

## 集中報告與 App 路由

第一版集中視圖預定只讀取 N1 彙整報告。建議由 N1 提供 `GET /api/platforms/report`，並固定外層來源為 `n1-platform-report/1`。報告應回傳平台列表、工作區、能力、任務摘要、健康狀態與最近事件；不得回傳平台 Token、Cookie、API Key、交易憑證、使用者私訊或未脫敏工作內容。

任務提交、取消與重試在第一版只保留契約位置。預定使用 `POST /api/platforms/tasks`、`POST /api/platforms/tasks/:taskId/cancel` 與 `POST /api/platforms/tasks/:taskId/retry`；N1 必須在每筆請求上檢查平台能力、工作區範圍、核准狀態、速率限制與操作日誌。未安裝這些路由時，App 只能顯示集中視圖的待啟用卡，不可假裝具備多平台執行權。

## 策略達標後的跨平台擴展

「策略還行」不能由聊天評語、單筆獲利或檔案名稱判定。N1 必須對**指定策略版本**回報回測、模擬、實盤觀察和目前風控的結構化證據；每個目標平台與帳戶仍各自建立任務並等待核准。這讓同一策略可以在多個已授權平台**並行協調**，但不把任一平台的成功自動外推為其他平台可以直接下單。

| 擴展前證據 | N1 最低回報欄位 | App 顯示 | 未回報時處理 |
|---|---|---|---|
| 策略身分 | `strategy_id`、版本或 Git 摘要、策略雜湊、報告時間 | 已驗證版本或未回報 | 不建立跨平台任務。 |
| 回測與模擬 | 市場／時間範圍、成本假設、交易筆數、最大回撤、績效摘要、模擬時間 | 研究／模擬證據 | 不使用「可擴展」標籤。 |
| 實盤觀察 | 平台、帳戶範圍、觀察期、已結束交易摘要、滑價／拒單／連線錯誤 | 僅顯示明確回報的觀察資料 | 不以餘額或持倉推測策略可用。 |
| 帳戶風控 | 可用資金、部位上限、每日風險額度、槓桿／交易對限制、停止條件 | 每平台風控卡 | 不允許共享其他平台的上限。 |
| 主人核准 | `approval_id`、核准範圍、核准時間、有效期限 | 「已核准」或「等待核准」 | 不送出目標平台任務。 |

```json
{
  "strategy_id": "trend-breakout-v4",
  "strategy_digest": "sha256:...",
  "qualification_state": "eligible_for_review",
  "evidence": {
    "backtest_report_id": "report-...",
    "paper_report_id": "report-...",
    "live_observation_report_id": "report-...",
    "observed_at": "2026-08-18T10:00:00Z"
  },
  "target_assignments": [
    {
      "platform_id": "exchange-a",
      "workspace_id": "account-primary",
      "risk_profile_id": "risk-primary-v1",
      "approval_state": "awaiting_approval"
    }
  ],
  "source": "n1-strategy-qualification/1"
}
```

`qualification_state: eligible_for_review` 只表示 N1 已具備足以供主人審閱的資料，**不是自動下單授權**。唯有每個 `target_assignment` 具有自己的風控檔與有效核准後，N1 才能建立該平台的獨立執行任務。取消、風控停止或單一平台失敗必須限制在對應任務／帳戶，不影響其他平台的執行狀態。

## 失敗隔離與安全邊界

某平台離線、限流、授權撤銷或任務失敗時，其他平台任務應繼續維持各自的狀態。N1 必須回報失敗範圍、重新嘗試策略、取消能力與最後健康檢查時間。平台之間不能以共用工作區 ID、共用隊列結果或模型猜測補齊缺失欄位。

> 艾西的角色是協調已授權能力與說明結果；平台真正執行的唯一證據，仍是 N1 受控工作者回傳的任務 ID、平台執行 ID、時間與可驗證輸出。
