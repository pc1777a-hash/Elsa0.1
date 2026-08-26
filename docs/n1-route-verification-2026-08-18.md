# N1 路由接線驗證紀錄

**驗證時間：** 2026-08-18 11:20 UTC（端點回應的 `captured_at`）  
**資料來源：** `https://brain.pin-yi.uk` 的唯讀 JSON 端點

| 端點 | 驗證結果 | 已確認內容 |
|---|---|---|
| `/api/perpetual/events` | 已可讀取 | N1 寫入第一筆 `system_report`，事件 ID 為 `evt-20260818111907059269`，`verification_state=reported` |
| `/api/system/storage-inventory` | 已可讀取 | N1、N3 為 `reported`；N2 為 `probe_failed`，明確原因為 SSH 認證未被接受 |
| `/api/system/capability-inventory` | 已可讀取 | N1、N3 為 `reported`；兩者皆依 30,000 項上限截斷掃描；N2 的原因同上 |

## 重要狀態

N1 能力盤點已列出 `elsa-native`、`elsa-watchdog` 與 `cloudflared-agi` 為 `online`；`elsa-selfevolve` 為 `stopped`。Docker 亦回報 `memory-svc`、`orchestrator` 與 `qdrant` 正在運行。這些是盤點時點的觀測結果，不能替代後續健康回報或任何執行證據。

N1 盤點報告的預設輸出目錄已修正為 `runtime/perpetual_brain` 下的子目錄，以與 API 路由使用的 `STATE_DIR` 一致。舊安裝器曾將探針結果寫入 `.elsa_perpetual`，造成探針雖完成而 API 仍顯示未回報；修正後的重跑結果已由上述公開端點確認。

N3 探針的 Android 分割區條目包含系統唯讀／暫存掛載點，不能以其中的 100% 使用率直接推論使用者可用儲存空間。後續若要作出裝置容量決策，需在 N3 提供明確的使用者儲存掛載點與可用空間回報。

## 後續待處理

1. 修復 N1 至 N2 的 SSH 認證，才可使 N2 回報盤點。
2. 以新的唯讀適配器盤點 `runtime_gold`，不得直接啟動、停止或覆寫既有 runtime。
3. 由 N1 工作者定期寫入健康、任務與結果事件，使 App 不只顯示一次性的人工驗證事件。
