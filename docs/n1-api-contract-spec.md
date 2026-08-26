# ELSA 控制台 N1 API 契約完整規格

| 屬性 | 值 |
|---|---|
| 文件版本 | 1.0.0 |
| 更新日期 | 2026-08-18 |
| 正式基底位址 | `https://brain.pin-yi.uk` |
| 消費端 | ELSA 控制台（React Native / Expo） |
| 契約範圍 | 20 個 `GET` 路由及 2 個 `POST` 路由 |
| 資料格式 | Request / response 均為 JSON；wire key 使用 `snake_case` |

本文件是 ELSA 控制台與 N1 原生服務的可驗證資料契約。範例中的值為結構示例，不表示 App 可以用範例值代替即時資料。App 會將 wire format 轉換為 TypeScript 的 `camelCase` 模型，但 N1 必須維持本文件列出的 `snake_case` 欄位、enum 與 `null` 語義。[1] [2]

> **執行證據原則：** 對話端點 `/ask` 的文字只代表聊天回應。它不能作為永動腦在線、任務被認領、策略已部署、主動事件已發出或艾西內在狀態已回報的證據；這些狀態只可由各自的顯式 API 回傳。[1] [3]

## 1. 通用傳輸、錯誤與「未回報」規則

成功請求使用 JSON；帶 request body 的路由必須帶 `Content-Type: application/json`。服務端可對非成功情況回傳下列錯誤物件，App 對所有非 2xx 回應都視為該端點本次未回報。

```json
{
  "error": "human-readable error detail"
}
```

除非端點章節明確列出 `"unreported"` enum 或 `null` 欄位，N1 不需要為每個路由新增虛構的 `state` 包裝。以下是 App 的本機未回報視圖模型，**不是**要求 N1 回傳的 wire payload。

```json
{
  "availability": "unreported",
  "endpoint": "/api/example",
  "reason": "route_missing | http_error | invalid_json | contract_invalid | network_unreachable",
  "observed_at": "2026-08-18T12:00:00.000Z"
}
```

| 原因 | 判定 | App 行為 |
|---|---|---|
| `route_missing` | HTTP 404 或路由尚未安裝 | 顯示「未回報」，不由其他 API 推論。 |
| `http_error` | 任何非 2xx 回應 | 顯示「未回報」與安全的錯誤摘要。 |
| `invalid_json` | 回應無法解析為 JSON | 顯示「未回報」。 |
| `contract_invalid` | 必填欄位、enum、時間、數值、URL 或完整性規則不符 | 拒絕此端點的整份資料，顯示「未回報」。 |
| `network_unreachable` | 網路、TLS 或連線失敗 | 顯示「未回報」與連線失敗。 |

凡標記為 ISO 8601 的時間字串都必須可由標準日期解析器解析，例如 `2026-08-18T11:19:07.068277Z`。未回報卡片之間是獨立的：某個端點失效不得影響另一個端點已驗證的資料。[2] [4] [5]

## 2. 路由清單

| # | Method | Path | 成功根欄位 | 主要用途 |
|---:|---|---|---|---|
| 1 | `GET` | `/health` | `status` | 原生服務健康檢查。 |
| 2 | `GET` | `/api/plugins` | `plugins` | 外掛清單與啟用狀態。 |
| 3 | `GET` | `/api/exchanges` | `supported`, `selected`, `keys` | 交易所設定摘要。 |
| 4 | `GET` | `/trade/balance` | `balance` | 唯讀餘額。 |
| 5 | `GET` | `/trade/positions` | `positions` | 唯讀持倉。 |
| 6 | `GET` | `/trade/auto/status` | `active`, `configured`, `log` | 自主交易狀態與訊號。 |
| 7 | `GET` | `/api/memory/stats` | `ok`, `active`, `total` | 記憶統計。 |
| 8 | `GET` | `/api/memory/recent` | `ok`, `memories` | 最近記憶摘要。 |
| 9 | `GET` | `/api/perpetual/status` | `online` | 永動腦工作者狀態。 |
| 10 | `GET` | `/api/perpetual/tasks` | `tasks` | 任務佇列。 |
| 11 | `POST` | `/api/perpetual/tasks` | `task` 或任務物件 | 建立永動腦任務。 |
| 12 | `GET` | `/api/perpetual/strategy-status` | `development_task` 等 | 策略生命週期。 |
| 13 | `GET` | `/api/ai/self-status` | `reported_at`, `long_term_wishes` | 艾西自我回報。 |
| 14 | `GET` | `/api/perpetual/events` | `source`, `events` | 主動事件收件匣。 |
| 15 | `GET` | `/api/system/resources` | `captured_at`, `disk`, `loaded_models` | N1 資源遙測。 |
| 16 | `GET` | `/api/system/storage-inventory` | `source`, `nodes` | N1/N2/N3 儲存盤點。 |
| 17 | `GET` | `/api/system/capability-inventory` | `source`, `nodes` | N1/N2/N3 能力盤點。 |
| 18 | `GET` | `/api/documents/report` | `tasks`, `artifacts` | 文件工坊回報。 |
| 19 | `GET` | `/api/config` | `models` | 模型角色設定。 |
| 20 | `GET` | `/api/models` | `models` | 已知模型清單。 |
| 21 | `POST` | `/ask` | `reply` / `response` / `message` | 文字對話。 |
| 22 | `GET` | `/api/system/bible` | `title`, `services` | 公開架構聖經。 |

## 3. 基礎服務與交易

### 3.1 `GET /health`

```json
{
  "status": "healthy"
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `status` | string | 是 | 非空健康描述；已使用值為 `healthy`。 |

路由缺失、非 JSON 或 `status` 非字串時顯示未回報。Cloudflare Tunnel 可達或其他路由成功，均不得代替此路由的健康結果。[1]

### 3.2 `GET /api/plugins`

```json
{
  "plugins": [
    {
      "id": "memory",
      "name": "Memory Service",
      "icon": "memory",
      "cat": "core",
      "desc": "N1 記憶索引服務",
      "enabled": true,
      "config": {
        "backend": "qdrant"
      }
    }
  ]
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `plugins` | array | 是 | 外掛物件陣列；可為空。 |
| `id`, `name`, `icon`, `cat`, `desc` | string | 是 | 外掛識別、名稱、圖示、分類與說明。 |
| `enabled` | boolean | 是 | 顯式啟用狀態。 |
| `config` | object | 是 | 可公開的設定摘要；不得含密鑰、token 或私密路徑。 |

`enabled: false` 是已回報的停用狀態，而非未回報。整體 payload 缺失或失效時，外掛卡才呈現未回報。

### 3.3 `GET /api/exchanges`

```json
{
  "supported": ["binance", "bitget"],
  "selected": "binance",
  "keys": {
    "binance": true,
    "bitget": false
  }
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `supported` | string[] | 是 | 支援的交易所識別字。 |
| `selected` | string | 是 | 目前選取交易所。 |
| `keys` | `Record<string, boolean>` | 是 | 僅回報設定可用性；不得回傳 API key、secret 或 passphrase。 |

`keys[exchange]: false` 代表已明確回報「未設定」。端點本身不可用才顯示未回報。

### 3.4 `GET /trade/balance`

```json
{
  "balance": "1234.56"
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `balance` | string | 是 | 餘額字串；App 不假設法幣、幣別或小數精度。 |

本端點沒有獨立的 `unreported` wire format；HTTP 或契約失敗時使用通用未回報視圖。餘額不可被用來推定自主交易已啟動。

### 3.5 `GET /trade/positions`

```json
{
  "positions": [
    {
      "symbol": "BTCUSDT",
      "side": "long",
      "size": "0.001",
      "entry_price": "62000"
    }
  ]
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `positions` | array<object> | 是 | 交易服務提供的持倉物件，可因交易所而擴充。 |

`positions: []` 是已回報的零持倉；不可用空陣列掩蓋連線或解析失敗。

### 3.6 `GET /trade/auto/status`

```json
{
  "ok": true,
  "active": true,
  "configured": true,
  "paper": false,
  "cycles": 42,
  "last": "2026-08-18T11:19:07.068277Z",
  "timestamp": "2026-08-18T11:19:08.000Z",
  "log": [
    {
      "ok": true,
      "paper": false,
      "symbol": "BTCUSDT",
      "tf": "15m",
      "signal": "hold",
      "strength": 0.62,
      "price": 62000.5,
      "ema20": 61950.0,
      "ema50": 61840.0,
      "rsi": 53.7
    }
  ]
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `ok`, `active`, `configured`, `paper` | boolean | 是 | 查詢、交易迴圈、配置與模擬模式的顯式狀態。 |
| `cycles` | number | 是 | 已報告迴圈數。 |
| `last`, `timestamp` | string | 是 | 最近週期與本次狀態時間。 |
| `log` | array | 是 | 最近訊號清單，可為空。 |
| `log[].ok`, `log[].paper` | boolean | 是 | 訊號工作結果與模擬旗標。 |
| `log[].symbol`, `tf`, `signal` | string | 是 | 商品、時間框架、訊號。 |
| `log[].strength`, `price`, `ema20`, `ema50`, `rsi` | number | 是 | 量化技術訊號。 |

`active: false` 與 `configured: false` 都是已回報狀態，不是未回報。持倉、聊天與任務資料不可反推 `active`。

## 4. 記憶、模型與對話

### 4.1 `GET /api/memory/stats`

```json
{
  "ok": true,
  "active": 24,
  "backend": "qdrant",
  "deep": 12,
  "embed_model": "nomic-embed-text",
  "total": 336
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `ok` | boolean | 是 | 記憶服務查詢結果。 |
| `active`, `deep`, `total` | number | 是 | 記憶統計計數。 |
| `backend`, `embed_model` | string | 是 | 後端與嵌入模型識別字。 |

`ok: false` 是已回報的服務狀態。回應遺失或 schema 無效時才是記憶統計未回報。

### 4.2 `GET /api/memory/recent`

```json
{
  "ok": true,
  "memories": [
    {
      "id": "mem-20260818-001",
      "kind": "system_note",
      "content": "N1 儲存與能力盤點已完成回報。"
    }
  ]
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `ok` | boolean | 是 | 查詢結果。 |
| `memories` | array | 是 | 最近記憶摘要，可為空。 |
| `id`, `kind`, `content` | string | 是 | 可呈現在 App 的識別碼、種類與摘要。 |

空陣列代表沒有近期記憶，不代表端點未回報。

### 4.3 `GET /api/config`

```json
{
  "models": {
    "autocoder": "deepseek-coder:6.7b",
    "chat": "qwen2.5:7b",
    "default": "qwen2.5:7b",
    "embedding": "nomic-embed-text"
  }
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `models` | object | 是 | N1 已宣告的模型角色映射。 |
| `models.autocoder`, `chat`, `default`, `embedding` | string | 是 | 編碼、對話、預設與嵌入模型。 |

這是設定觀測，不代表模型目前已載入，也不代表工作者正在使用它。

### 4.4 `GET /api/models`

```json
{
  "models": [
    "deepseek-coder:6.7b",
    "qwen2.5:7b",
    "nomic-embed-text"
  ]
}
```

`models` 必須是字串陣列。空陣列表示已回報但沒有可列出模型；缺失或非陣列才顯示未回報。

### 4.5 `POST /ask`

**Request**

```json
{
  "message": "請摘要目前 N1 健康狀態。",
  "type": "text"
}
```

| Request 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `message` | string | 是 | 使用者文字訊息。 |
| `type` | literal string | 是 | 本版為 `text`。 |

**Success response：三種相容格式任一即可。** App 的讀取優先序為 `reply`、`response`、`message`。[1]

```json
{
  "reply": "請以 /health 和資源路由的實際回應確認 N1 狀態。"
}
```

```json
{
  "response": "替代相容的回覆欄位。"
}
```

```json
{
  "message": "第三種相容的回覆欄位。"
}
```

三個回覆欄位都缺失時，這次對話顯示失敗 / 未回報。聊天回覆永遠不能點亮任務、策略、永動腦、自我回報或主動事件的 API 魔法契約節點。

## 5. 永動腦、任務與策略

### 5.1 `GET /api/perpetual/status`

```json
{
  "online": true,
  "loop_state": "idle",
  "last_heartbeat": "2026-08-18T11:19:07.068277Z",
  "active_task_id": null,
  "queue_depth": 0,
  "worker_version": "perpetual-brain/1"
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `online` | boolean | 是 | 唯一必要的永動腦在線證據。 |
| `loop_state`, `last_heartbeat`, `worker_version` | string | 否 | 存在時必須為非空字串。 |
| `active_task_id` | string 或 `null` | 否 | `null` 是已回報的無活動任務。 |
| `queue_depth` | finite number | 否 | 已回報佇列深度。 |

`online` 缺失、為 `null`、字串 `"true"` 或其他非 boolean 時，整個永動腦卡必須顯示未回報。`online: false` 是已回報的離線狀態。[3]

### 5.2 `GET /api/perpetual/tasks`

```json
{
  "tasks": [
    {
      "task_id": "task-20260818-001",
      "kind": "code",
      "title": "建立健康檢查服務",
      "objective": "產生並驗證最小 Flask /health 服務。",
      "state": "verified",
      "created_at": "2026-08-18T10:00:00.000Z",
      "updated_at": "2026-08-18T10:05:00.000Z",
      "current_step": "HTTP health verified",
      "test_summary": "py_compile and HTTP /health passed",
      "git_summary": "not requested",
      "deployment_policy": "local_test_only",
      "executor_mode": "autonomous_coder"
    }
  ]
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `tasks` | array | 是 | 任務陣列，可為空。 |
| `task_id`, `title`, `objective`, `state` | string | 是 | 非空文字。 |
| `kind` | enum | 是 | 僅 `code`、`research`、`maintenance`。 |
| `created_at`, `updated_at` | string | 是 | 建立及更新時間。 |
| `current_step`, `failure_reason`, `test_summary`, `git_summary`, `deployment_policy`, `executor_mode` | string | 否 | 已明確回報的執行資訊。 |

任一任務的必要欄位缺失、`kind` 不在允許 enum，或 `tasks` 非陣列時，App 拒絕整份回應。`tasks: []` 是已回報的空佇列。[2]

### 5.3 `POST /api/perpetual/tasks`

此路由只建立任務。受理、排隊或 `queued` 都不等於工作者已認領、執行、測試或部署；後續證據必須來自 `GET /api/perpetual/tasks` 和 `GET /api/perpetual/status`。

**Request**

```json
{
  "kind": "maintenance",
  "title": "盤點 N2 儲存資訊",
  "objective": "以唯讀方式回報 N2 的儲存裝置與服務能力摘要。"
}
```

| Request 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `kind` | enum | 是 | `code`、`research`、`maintenance`。 |
| `title`, `objective` | string | 是 | 非空任務標題與目標。 |

**Success response：直接回傳任務物件，或用 `task` 包裝。**

```json
{
  "task": {
    "task_id": "task-20260818-002",
    "kind": "maintenance",
    "title": "盤點 N2 儲存資訊",
    "objective": "以唯讀方式回報 N2 的儲存裝置與服務能力摘要。",
    "state": "queued",
    "created_at": "2026-08-18T12:00:00.000Z",
    "updated_at": "2026-08-18T12:00:00.000Z"
  }
}
```

回傳任務必須符合第 5.2 節 schema。後端拒絕、回應缺 `task_id` 或格式不合時，App 顯示提交失敗 / 未回報。

### 5.4 `GET /api/perpetual/strategy-status`

```json
{
  "development_task": null,
  "candidate_version": null,
  "deployed_version": "strategy-v3",
  "executor_state": "online",
  "executor_heartbeat": "2026-08-18T11:19:07.068277Z",
  "risk_guard_state": "armed",
  "last_cycle": "2026-08-18T11:18:00.000Z"
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `development_task` | PerpetualTask 或 `null` | 是 | 非空時完全遵守第 5.2 節任務 schema。 |
| `candidate_version`, `deployed_version` | string 或 `null` | 是 | 策略候選版與已部署版。 |
| `executor_state`, `risk_guard_state` | string | 是 | 顯式執行器與風控狀態。 |
| `executor_heartbeat`, `last_cycle` | string 或 `null` | 是 | 執行器心跳與最近週期。 |

`null` 是刻意保留的已回報空值，不等於未回報。以上七個欄位之一缺失，或 `development_task` 不合格時，整個策略生命週期卡顯示未回報。[2]

### 5.5 `GET /api/ai/self-status`

```json
{
  "reported_at": "2026-08-18T11:19:07.068277Z",
  "source": "n1-self-report/1",
  "current_mood": "專注",
  "current_focus": "整理三機盤點資料",
  "near_term_intent": "產出可驗證的系統摘要",
  "long_term_wishes": [
    "維持可追溯的記憶結構",
    "讓所有設備狀態都有明確回報"
  ]
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `reported_at`, `source` | string | 是 | 自我回報時間與來源。 |
| `current_mood`, `current_focus`, `near_term_intent` | string 或 `null` | 是 | 可刻意為 `null` 的當下狀態。 |
| `long_term_wishes` | string[] | 是 | 每個元素均為非空字串；可為空陣列。 |

404、缺少欄位、不是字串陣列或不合格字串，均使「艾西內在狀態」顯示未回報。聊天、記憶與任務不得補造此面板內容。[2]

## 6. N1 資源與三機盤點

### 6.1 `GET /api/system/resources`

```json
{
  "captured_at": "2026-08-18T11:19:07.068277Z",
  "gpu": {
    "name": "NVIDIA GeForce GTX 1080 Ti",
    "memory_used_mb": 359,
    "memory_total_mb": 11264
  },
  "disk": {
    "used_gb": 506.0,
    "total_gb": 1150.0
  },
  "loaded_models": ["nomic-embed-text"],
  "queue_depth": 0
}
```

**GPU 子系統未回報、但資源端點本身仍有效的格式：**

```json
{
  "captured_at": "2026-08-18T11:19:07.068277Z",
  "gpu": null,
  "disk": {
    "used_gb": 506.0,
    "total_gb": 1150.0
  },
  "loaded_models": [],
  "queue_depth": 0
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `captured_at` | string | 是 | 資源擷取時間。 |
| `gpu` | object 或 `null` | 是 | `null` 僅代表 GPU 子系統未回報。 |
| `gpu.name` | string | 條件 | `gpu` 為 object 時必填。 |
| `gpu.memory_used_mb`, `gpu.memory_total_mb` | finite number | 條件 | `gpu` 為 object 時必填。 |
| `disk.used_gb`, `disk.total_gb` | finite number | 是 | N1 可用磁碟統計。 |
| `loaded_models` | string[] | 是 | 已載入模型，可為空。 |
| `queue_depth` | finite number | 是 | N1 回報的佇列深度。 |

`captured_at`、`disk`、`loaded_models` 或 `queue_depth` 缺失 / 無效時，整個資源端點為未回報。`gpu: null` 只使 GPU 欄位呈現未回報，不得掩蓋已驗證的磁碟或模型資料。[4]

### 6.2 `GET /api/system/storage-inventory`

```json
{
  "captured_at": "2026-08-18T11:19:07.068277Z",
  "source": "n1-storage-inventory/1",
  "nodes": [
    {
      "node_id": "N1",
      "report_state": "reported",
      "captured_at": "2026-08-18T11:19:07.068277Z",
      "system": {
        "hostname": "n1-master",
        "platform": "Linux",
        "release": "6.8.0-90-generic"
      },
      "volumes": [
        {
          "mount_path": "/media/ollama/n1",
          "filesystem_type": "ext4",
          "total_bytes": 983547510784,
          "used_bytes": 445602856960,
          "available_bytes": 488000000000,
          "usage_percent": 48
        }
      ],
      "import_sources": [
        {
          "id": "r2",
          "label": "R2 archive",
          "state": "unreported",
          "access": "user_selected"
        }
      ],
      "error_summary": null
    },
    {
      "node_id": "N2",
      "report_state": "probe_failed",
      "captured_at": null,
      "system": {
        "hostname": null,
        "platform": null,
        "release": null
      },
      "volumes": [],
      "import_sources": [],
      "error_summary": "SSH inventory probe did not return a report."
    },
    {
      "node_id": "N3",
      "report_state": "unreported",
      "captured_at": null,
      "system": {
        "hostname": null,
        "platform": null,
        "release": null
      },
      "volumes": [],
      "import_sources": [],
      "error_summary": "No controlled storage report is available."
    }
  ]
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `source` | literal string | 是 | 必須精確為 `n1-storage-inventory/1`。 |
| `captured_at` | ISO 8601 string | 是 | 全域盤點時間。 |
| `nodes` | array | 是 | 必須剛好 3 筆，且唯一的 `node_id` 必為 N1、N2、N3。 |
| `node_id` | enum | 是 | `N1`、`N2`、`N3`。 |
| `report_state` | enum | 是 | `reported`、`stale`、`probe_failed`、`unreported`。 |
| `nodes[].captured_at` | ISO 8601 string 或 `null` | 是 | 節點報告時間。 |
| `system.hostname`, `platform`, `release` | string 或 `null` | 是 | 節點系統摘要。 |
| `volumes` | array | 是 | 磁碟卷清單，可為空。 |
| `volumes[].mount_path`, `filesystem_type` | string | 條件 | 每個卷必填。 |
| `total_bytes` | positive number | 條件 | 必須大於零。 |
| `used_bytes`, `available_bytes` | nonnegative number | 條件 | `used_bytes` 不得大於 `total_bytes`。 |
| `usage_percent` | nonnegative number 或 `null` | 條件 | 用量百分比。 |
| `import_sources` | array | 是 | 使用者可控的匯入來源，可為空。 |
| `import_sources[].state` | enum | 條件 | `available` 或 `unreported`。 |
| `import_sources[].access` | enum | 條件 | `user_selected` 或 `manual_only`。 |
| `error_summary` | string 或 `null` | 是 | 無資料或探針失敗的摘要。 |

| `report_state` | JSON 型態 | 精確語義 |
|---|---|---|
| `reported` | 可含有效時間與盤點資料；常搭配 `error_summary: null`。 | 節點已成功回報。 |
| `stale` | 保留最後資料及時間，可含錯誤摘要。 | 有可讀資料，但不是新鮮回報。 |
| `probe_failed` | 常用 `captured_at: null`、空陣列與錯誤摘要。 | 已嘗試探針，但沒有可驗證資料。 |
| `unreported` | `captured_at: null`、空結構與可選摘要。 | 節點尚未回傳受控報告。 |

`source` 不符、`nodes` 非三筆、節點重複 / 未知或任一節點資料違約時，App 拒絕整個儲存盤點；不得只渲染部分節點。[5]

### 6.3 `GET /api/system/capability-inventory`

```json
{
  "captured_at": "2026-08-18T11:19:07.068277Z",
  "source": "n1-capability-inventory/1",
  "nodes": [
    {
      "node_id": "N1",
      "report_state": "reported",
      "captured_at": "2026-08-18T11:19:07.068277Z",
      "scan": {
        "max_entries": 5000,
        "scanned_files": 482,
        "excluded_sensitive_or_cache": 17,
        "truncated": false
      },
      "asset_counts": {
        "python": 44,
        "documentation": 32
      },
      "capability_counts": {
        "trading": 5,
        "memory": 3
      },
      "candidate_counts": {
        "reuse_candidate": 8,
        "completion_candidate": 2,
        "unknown": 1
      },
      "service_signals": [
        {
          "manager": "pm2",
          "name": "elsa-native",
          "state": "online"
        }
      ],
      "error_summary": null
    },
    {
      "node_id": "N2",
      "report_state": "unreported",
      "captured_at": null,
      "scan": {
        "max_entries": null,
        "scanned_files": null,
        "excluded_sensitive_or_cache": null,
        "truncated": null
      },
      "asset_counts": {},
      "capability_counts": {},
      "candidate_counts": {},
      "service_signals": [],
      "error_summary": "No controlled capability report is available."
    },
    {
      "node_id": "N3",
      "report_state": "reported",
      "captured_at": "2026-08-18T11:19:00.000Z",
      "scan": {
        "max_entries": null,
        "scanned_files": 0,
        "excluded_sensitive_or_cache": 0,
        "truncated": false
      },
      "asset_counts": {},
      "capability_counts": {},
      "candidate_counts": {},
      "service_signals": [],
      "error_summary": null
    }
  ]
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `source` | literal string | 是 | 必須精確為 `n1-capability-inventory/1`。 |
| `captured_at`, `nodes` | string, array | 是 | 同第 6.2 節之時間與三機完整性規則。 |
| `report_state` | enum | 是 | `reported`、`stale`、`probe_failed`、`unreported`。 |
| `scan.max_entries`, `scanned_files`, `excluded_sensitive_or_cache` | nonnegative number 或 `null` | 是 | 掃描計數可被明確保留為 `null`。 |
| `scan.truncated` | boolean 或 `null` | 是 | 是否因限制截斷。 |
| `asset_counts`, `capability_counts` | object | 是 | 短鍵名到非負有限數字的聚合計數。 |
| `candidate_counts` | object | 是 | 僅允許 `reuse_candidate`、`completion_candidate`、`unknown` 鍵。 |
| `service_signals` | array | 是 | `{manager, name, state}` 非空字串物件陣列。 |
| `error_summary` | string 或 `null` | 是 | 節點資料不足或探針失敗摘要。 |

能力盤點的四種 `report_state` 語義與第 6.2 節完全一致。服務不得輸出掃描到的原始文件內容、私密完整路徑或秘密值。[5]

## 7. 主動事件與文件工坊

### 7.1 `GET /api/perpetual/events`

```json
{
  "captured_at": "2026-08-18T11:19:07.068277Z",
  "source": "n1-proactive-events/1",
  "events": [
    {
      "event_id": "evt-20260818111907059269",
      "kind": "system_report",
      "severity": "info",
      "created_at": "2026-08-18T11:19:07.059282Z",
      "source": "n1-perpetual-worker",
      "trigger": "manual post-install verification",
      "title": "N1 盤點與健康回報已啟用",
      "body": "N1 與 N3 的儲存及能力盤點已完成回報。",
      "verification_state": "reported"
    }
  ]
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `source` | literal string | 是 | 必須為 `n1-proactive-events/1`。 |
| `captured_at` | string | 是 | 收件匣擷取時間。 |
| `events` | array | 是 | 長度必須介於 0 與 80。 |
| `event_id` | string | 是 | 最長 128 字元。 |
| `kind` | enum | 是 | `system_report`、`chat_invite`、`status_card`。 |
| `severity` | enum | 是 | `info`、`attention`、`warning`、`error`。 |
| `created_at`, `source`, `trigger`, `title`, `body` | string | 是 | 非空；`trigger` 最長 500、`title` 最長 180、`body` 最長 1200。 |
| `verification_state` | enum | 是 | `reported` 或 `verified`。 |
| `related_task_id`, `related_report_id` | string | 否 | 可選關聯識別字。 |
| `visual` | object | 否 | 視覺狀態卡，適用下列條件。 |

**新生成狀態圖：**

```json
{
  "kind": "generated_scene",
  "label": "艾西正在盤點 N1",
  "is_visualization": true,
  "image_url": "https://cdn.example.invalid/aixi-status-001.webp",
  "image_origin": "new_generation",
  "generated_at": "2026-08-18T11:19:07.000Z",
  "character_reference_version": "aixi-v5",
  "prompt_digest": "dark command center, focused expression"
}
```

**記憶回響：**

```json
{
  "kind": "memory_echo",
  "label": "回憶先前的部署測試",
  "is_visualization": true,
  "image_url": "https://cdn.example.invalid/aixi-memory-001.webp",
  "image_origin": "memory_echo",
  "memory_source_id": "mem-20260818-001",
  "memory_intent": "回顧此前已驗證的部署成果"
}
```

| 視覺條件 | 嚴格規則 |
|---|---|
| 共通 | `kind` 僅 `portrait_card`、`generated_scene`、`memory_echo`；`label` 非空且最長 120；`is_visualization` 必須精確為 `true`。 |
| 影像 URL | 若提供 `image_url`，必須 HTTPS，且最長 1500 字元。 |
| 新生成圖 | `kind` 不是 `memory_echo` 且有圖片時，必須有 `image_origin: "new_generation"`、`generated_at`、`character_reference_version`、`prompt_digest`。 |
| 回用舊圖 | `kind: "memory_echo"` 且有圖片時，必須有 `image_origin: "memory_echo"`、`memory_source_id`、`memory_intent`。 |
| 禁止混用 | 不可將舊圖說成新生成，也不可無來源與意圖地把舊圖說成記憶回響。 |

空 `events` 陣列是已回報的無事件。`source` 不符、事件超過 80、enum 不符、字串過長或視覺來源違規時，App 拒絕整份事件 feed 並顯示未回報。[6]

### 7.2 `GET /api/documents/report`

```json
{
  "captured_at": "2026-08-18T11:19:07.068277Z",
  "source": "n1-document-production/1",
  "tasks": [
    {
      "document_task_id": "doc-task-001",
      "title": "N1 資源摘要",
      "purpose": "建立目前 N1 資源與模型狀態的摘要文件。",
      "requested_formats": ["markdown", "pdf"],
      "state": "verified",
      "created_at": "2026-08-18T10:00:00.000Z",
      "updated_at": "2026-08-18T10:10:00.000Z",
      "source_task_id": "task-20260818-001",
      "n1_task_id": "task-20260818-001"
    }
  ],
  "artifacts": [
    {
      "artifact_id": "artifact-001",
      "document_task_id": "doc-task-001",
      "file_name": "n1-resource-summary.pdf",
      "format": "pdf",
      "status": "verified",
      "size_bytes": 126400,
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "created_at": "2026-08-18T10:10:00.000Z",
      "verified_at": "2026-08-18T10:10:02.000Z",
      "index_state": "indexed_n1",
      "r2_state": "unreported",
      "download_url": "https://files.example.invalid/n1-resource-summary.pdf"
    }
  ]
}
```

| 任務欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `document_task_id` | string | 是 | 最長 96。 |
| `title`, `purpose` | string | 是 | 非空；上限為 160 與 2000。 |
| `requested_formats` | enum[] | 是 | 非空、最多 4、不得重複；僅 `markdown`、`txt`、`docx`、`pdf`。 |
| `state` | enum | 是 | `draft`、`queued`、`producing`、`verified`、`indexed`、`archived`、`failed`。 |
| `created_at`, `updated_at` | ISO 8601 string | 是 | 任務時間。 |
| `source_task_id`, `n1_task_id`, `failure_reason` | string | 否 | 關聯或失敗摘要；失敗摘要最長 480。 |

| 產物欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `artifact_id`, `document_task_id` | string | 是 | 最長 96；後者必須指向同一份回應內任務。 |
| `file_name` | string | 是 | 非空，最長 180。 |
| `format` | enum | 是 | `markdown`、`txt`、`docx`、`pdf`。 |
| `status` | enum | 是 | `produced`、`verified`、`indexed`、`archived`、`failed`。 |
| `size_bytes` | nonnegative safe integer | 是 | 產物大小。 |
| `sha256` | string | 是 | 精確 64 個十六進位字元；App 正規化為小寫。 |
| `created_at` | ISO 8601 string | 是 | 產物建立時間。 |
| `verified_at` | ISO 8601 string | 否 | 驗證時間。 |
| `index_state` | enum | 否 | `pending_n1_index`、`indexed_n1`、`archived_r2`、`failed`。 |
| `r2_state` | enum | 否 | `pending`、`archived`、`failed`、`unreported`。 |
| `download_url` | string | 否 | 只接受 HTTPS，長度上限 1800。 |
| `failure_reason` | string | 否 | 最長 480。 |

| 整體條件 | 規則 |
|---|---|
| 來源 | `source` 必須精確為 `n1-document-production/1`。 |
| 上限 | `tasks` 最多 50；`artifacts` 最多 100。 |
| 唯一性 | 任務 ID 與產物 ID 都不得重複。 |
| 參照完整性 | 每個 artifact 的 `document_task_id` 都必須在同回應的 `tasks` 出現。 |
| R2 未回報 | `r2_state: "unreported"` 是已回報但暫無封存狀態；不是整體路由失敗。 |

任務 `queued` 不代表文件已產出。只有通過 SHA-256、HTTPS、唯一性及任務關聯檢查的 `artifacts` 才可顯示為可用文件。[7]

## 8. 公開架構聖經

### 8.1 `GET /api/system/bible`

此路由使用固定公開位址 `https://brain.pin-yi.uk/api/system/bible`。App 至少驗證 `title` 為真值字串且 `services` 是陣列。[8]

```json
{
  "title": "ELSA System Bible",
  "version": "5.0",
  "status": "active",
  "timestamp": "2026-08-18T11:19:07.068277Z",
  "services": [
    "core",
    "trading",
    "memory",
    "plugin"
  ]
}
```

| 欄位 | 型別 | 必填 | 規則 |
|---|---|---:|---|
| `title` | string | 是 | 系統架構文件標題。 |
| `version`, `status`, `timestamp` | string | 建議 | 版本、狀態與時間。 |
| `services` | string[] | 是 | 架構服務清單。 |

HTTP 404、無法解析 JSON、沒有 `title` 或 `services` 非陣列時，僅 System Bible 卡顯示未回報，不影響其他 N1 API 的獨立狀態。

## 9. 實作相容性要求

| 主題 | 強制要求 |
|---|---|
| 獨立證據 | 每張 App 卡片只能信任其對應 API，不跨端點補值。 |
| `null` 與 `unreported` | 契約中明定的 `null` 或 `unreported` 是有意義的資料，必須原樣保存其語義。 |
| 任務狀態 | `queued`、`running`、`verified` 等只能由任務 API 顯式回報；聊天不能代替。 |
| 交易與密鑰 | App 不接收 SSH key、Git token、交易 API key、雲端 secret 或任何可重建憑證的內容。 |
| 主動視覺 | 新圖必須聲明 `new_generation` 並包含生成元資料；舊圖只能以有來源及意圖的 `memory_echo` 回用。 |
| 文件 | App 只呈現有正確雜湊、HTTPS URL、唯一 ID 與有效任務關聯的 artifact。 |

任何重大不相容變更應以新路由或版本化 `source` 識別字發布，不得靜默改變現有 payload 形狀。三機盤點、主動事件與文件工坊均使用嚴格解析器；無效資料會被刻意拒絕，而非部分渲染。[5] [6] [7]

## References

[1]: ../lib/elsa-api.ts "ELSA N1 API client"
[2]: ../lib/perpetual-contracts.ts "永動腦任務、策略與自我回報嚴格解析器"
[3]: ../lib/perpetual-brain.ts "永動腦狀態嚴格解析器"
[4]: ../lib/system-resources.ts "N1 系統資源嚴格解析器"
[5]: ../lib/inventory-contracts.ts "三機儲存與能力盤點嚴格解析器"
[6]: ../lib/proactive-contracts.ts "主動事件與視覺來源嚴格解析器"
[7]: ../lib/document-contracts.ts "文件任務與產物嚴格解析器"
[8]: ../lib/system-bible.ts "公開 System Bible 取用器"
