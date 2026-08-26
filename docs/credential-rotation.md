# ELSA 桌機端憑證輪替與移除流程

此文件不包含任何密碼、Token、私鑰、連線字串或其他憑證值。若任何憑證曾出現在聊天、截圖、公開網址、紀錄檔或版本控制中，應視為**已暴露**並立即在原始供應商端撤銷與重建。

| 類別 | 處理順序 | 完成判定 |
| --- | --- | --- |
| 交易所 API 金鑰 | 先建立最小權限的新金鑰、更新桌機端秘密管理、驗證唯讀帳戶與自主交易狀態、再撤銷舊金鑰 | `/trade/balance` 與 `/trade/auto/status` 正常，舊金鑰已失效 |
| Git／雲端 Token | 建立新 Token，僅保留需要的 repository 與 scope，更新桌機端秘密管理後撤銷舊 Token | 由桌機端完成預期的 clone／pull／受控 push 測試 |
| SSH 金鑰 | 新建用途分離的金鑰對、將新公開金鑰放入目標主機的 `authorized_keys`，以受限帳戶測試後移除舊金鑰 | N1 受控代理可讀取必要 inventory，舊金鑰無法登入 |
| 隧道、儲存與 Bot 憑證 | 在各供應商端輪替，更新桌機端秘密管理，測試健康與通知路徑後撤銷舊值 | 服務健康檢查與必要通知正常，舊憑證遭拒絕 |

## 桌機端最低風險處置

先停止把秘密值放入 System Bible、App 原始碼、日誌與 Git。以環境變數或系統秘密管理服務保存憑證，並限制只有 N1 的受控服務帳戶可讀取。手機 App 只呼叫 HTTPS 服務路由，不保存任何交易、SSH、Git、雲端或 Bot 憑證。

## 變更後驗證

依序檢查 `/health`、`/api/memory/stats`、`/trade/balance`、`/trade/positions`、`/trade/auto/status`、`/api/config` 與 `/api/models`。發現舊憑證仍能使用時，應再次檢查桌機端環境檔、服務管理器設定、殘留 shell history、備份檔與版本控制歷史。
