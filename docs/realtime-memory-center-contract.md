# 即時記憶中心資料契約

## 目標

記憶中心是 ELSA 永動腦的**即時脈絡與系統結構面板**。所有動態資料必須由 N1 回報，並帶有擷取時間與來源；手機 App 只呈現資料，不直接登入 N2／N3、執行 SSH、讀取 R2 憑證或修改主機設定。

## 已可讀取的 N1 回報

| 區塊 | 路由 | 已知內容 | App 顯示規則 |
| --- | --- | --- | --- |
| 永動腦 | `GET /api/perpetual/status` | `online`、`loop_state`、`active_task_id`、`queue_depth` | `online: true` 才顯示執行中；其他情況不推論為運作中。 |
| N1 資源 | `GET /api/system/resources` | GPU 名稱／顯存、磁碟、已載入模型、佇列、擷取時間 | 以 `captured_at` 顯示最後更新；無欄位即未回報。 |
| 策略生命週期 | `GET /api/perpetual/strategy-status` | 開發任務、候選／部署版本、執行器與風控回報 | `null` 或 `unreported` 必須保留原狀。 |
| 服務端記憶 | `GET /api/memory/stats`、`GET /api/memory/recent` | 後端、嵌入模型、記憶統計與近期項目 | 只列出服務實際回傳的記憶。 |

## 待 N1 補充的即時回報

| 區塊 | 建議唯讀路由 | 必要欄位 | 不可誤用的資料 |
| --- | --- | --- | --- |
| 三機 inventory | `GET /api/system/inventory` | `captured_at`、節點 ID、角色、連線狀態、服務摘要、最後驗證時間、來源 | App 內的手動拓撲快照不得取代此回報。 |
| 設備保護 | `GET /api/system/protection` | GPU 溫度／功耗／顯存、磁碟餘量、`elsa-watchdog` 心跳、保護狀態、暫停原因、擷取時間 | `elsa-watchdog` 線上不等於已觸發保護；必須回傳明確狀態。 |
| 結構版本 | `GET /api/system/structure` | 結構版本、節點關係、服務與資料流、最後驗證時間 | 固定文件只能作為「已知結構」，不能宣稱即時。 |
| 記憶分層 | `GET /api/memory/sync-status` | N1 索引狀態、待處理數、已去重數、R2 同步狀態／物件計數、最後同步與錯誤摘要 | 不得把本機研究筆記標示成已 N1 索引或已 R2 封存。 |

## 自動更新機制

App 在「記憶」頁處於前景時，以 **30 秒**為預設週期刷新上述唯讀端點，並允許下拉立即刷新。每個卡片各自處理成功、逾時與缺失回報，不以任一端點失敗中斷其他區塊。背景持續收集、SSH 盤點、R2 寫入、去重與向量化由 N1 的受控工作者處理；啟用排程前必須先確認白名單命令、保留期限、磁碟門檻與失敗告警。

## 記憶單元

每一筆可檢索記憶至少包含：

- `id`、`kind`、`summary`、`source_provenance`、`source_hash`
- `device_id` 或任務 ID（如適用）
- `captured_at`、`indexed_at`、`expires_at`、`confidence`
- `dedupe_key`、`version`、`supersedes`
- N1 本機索引位置與選用的 R2 物件鍵

原始文件、圖片與影片保留在 R2 或既有資料位置；N1 儲存摘要、metadata、雜湊與向量，避免把大量原始媒體或憑證暴露給 App 或佔用模型顯存。
