# ELSA System Bible 缺口矩陣

**基準來源**：<https://brain.pin-yi.uk/api/system/bible> 與其已驗證的 N1 公開回報。此文件不將聊天回答、UI 文案或推測視為執行證據。

| 架構能力 | 目前證據 | App 現況 | 缺口與下一步 |
|---|---|---|---|
| 核心、交易、記憶、插件服務 | System Bible 顯示四類服務且 `operational` | 已有控制台、交易、記憶與插件畫面 | 以每個服務的健康端點補上服務級證據。 |
| 三機拓撲 | 結構端點只回傳角色；主人已驗證 N1 `100.101.100.77`（2222／22）、N2 `100.120.139.65:2223`、N3 `100.98.242.48:8022` 均可免密 SSH | 靜態快照仍有舊 N1 `localhost`、N2 `2222` 與待回報狀態 | 立即修正 App 快照；後續讓 N1 結構端點回傳已驗證地址／埠與驗證時間。 |
| 永動腦 API 佇列 | `/api/perpetual/status` 為 `n1-route-bridge/1`；任務 `pt-5b1abfe22c74` 未被認領 | 有狀態卡與任務清單 | 將 `elsa-selfevolve.py` 接到既有任務檔，回寫 claimed/running/tested/deployed 或 failed。 |
| 自主編碼與部署 | `autonomous_coder.run_task(task_desc)` 已實測：deepseek-coder 生成、語法檢查、PM2 部署、`/health` 成功 | App 尚未顯示該次產物與部署證據 | 建立任務回報契約，讓已實測的產物、PM2 名稱與 HTTP 健康結果可顯示。 |
| N1 資源 | GPU、磁碟、載入模型由 `/api/system/resources` 回傳 | 資源卡已存在 | 以即時 API 值優先；無回應時明確顯示未回報。 |
| 記憶與 R2 | 結構資料流有 n1_memory_index→r2_raw_archive；未見受控同步工作者證據 | 記憶卡可呈現統計資料 | 增加明確 memory-sync 回報，包含索引、去重、待處理與 R2 同步時間。 |
| runtime_gold | 已知為現有運行時資產，尚無公開唯讀狀態端點 | 只有整合計畫 | 新增唯讀 `/api/runtime-gold/status`，不啟動、不覆寫現有 runtime。 |
| 文件工坊 | App 已具嚴格報表解析器；N1 未回傳 `/api/documents/report` 證據 | 顯示待啟用 | 建立 N1 端報表產生器，僅呈現已產製且 HTTPS 可下載的文件。 |
| 多平台控制 | 已有治理與風控契約，沒有各平台授權與執行回報 | 顯示待 N1 接線 | 以平台隔離帳號、風控、批准與獨立交易證據為前提接線。 |
| 主動事件與自我狀態 | 主動事件端點已有資料；自我狀態必須來自明確檔案 | 已有事件卡和內在狀態卡 | 增加排程健康事件與顯式 self-status 工作者，不從聊天推論狀態。 |

