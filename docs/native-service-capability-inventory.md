# ELSA 原生服務能力盤點（去識別化）

來源：主人於 2026-08-18 提供的桌機環境與路由清單。此文件**刻意不保留**貼文中出現的任何交易所、雲端、儲存、隧道、Bot、SSH 私鑰或 API 憑證值。

| 類別 | 已列出的路由／能力 | App 可新增的安全用途 | 前置驗證 |
| --- | --- | --- | --- |
| 記憶 | `GET /api/memory/search`、`/api/memory/recent`、`/api/memory/stats` | 服務端記憶搜尋、近期知識、統計卡片 | 需要確認每個回應 JSON 結構與搜尋參數 |
| 記憶寫入 | `POST /api/memory/remember`、`/api/memory/recall`、`/api/memory/forget`、`/api/chat/memory` | 將艾西研究筆記轉入服務端長期記憶 | 寫入或刪除前必須顯示內容摘要並要求確認 |
| 自主交易 | `GET /trade/auto/status`、`GET /trade/signal`、`GET /trade/positions_v2` | 目前模式、策略／訊號、持倉與待確認顯示 | 僅先串接唯讀路由；不得根據路由名稱假設欄位 |
| 自主交易控制 | `/trade/auto/cycle`（GET/POST） | 未來受控循環／執行確認 | 不在手機端預設呼叫 `POST`，需契約與主人確認 |
| 模型與設定 | `GET /api/config`、`GET /api/models` | 顯示目前艾西模型、模型清單與安全設定摘要 | 只呈現經過資料遮罩的安全欄位 |
| 模型／插件變更 | `POST /api/config/model`、`/api/plugins/toggle`、`/api/plugins/config`、`/api/plugins/test` | 未來建立可審閱的配置變更工作流 | 必須先看到請求／回應契約，並提供變更摘要與確認 |
| 程式任務 | `POST /api/autocode` | 將 App 內策略或維護需求交給艾西產生程式任務 | 先確認是否為草案、是否會寫檔／執行／部署，預設只送草案任務 |

## 公開狀態摘要

路由清單同時顯示 `elsa-native`、`cloudflared-agi` 與 `elsa-watchdog` 為運行中，`elsa-selfevolve` 為停止。App 可以把這些視為**主人提供的靜態脈絡**，不可自行把它當成即時健康資料；即時狀態仍應由受控健康或 inventory API 回傳。

## 憑證處置

附件含多組高度敏感憑證與可能可操作服務的設定值。這些值不應再被複製到聊天、截圖、App、記錄、文件或版本控制。應立即在各供應商端撤銷／旋轉對應憑證、更新桌機端的安全儲存設定，並確認 `.env` 已被忽略且不會出現在 Git 歷史中。
