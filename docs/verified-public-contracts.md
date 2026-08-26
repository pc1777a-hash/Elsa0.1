# 已驗證的公開服務契約

本文件只記錄 App 可安全依賴的公開、唯讀回應；不包含任何憑證、SSH 金鑰或 Git Token。

| 來源 | 驗證時間 | 實際回應／結論 |
| --- | --- | --- |
| `https://brain.pin-yi.uk/api/system/bible` | 2026-08-18 | 回傳 `ELSA-V5 系統聖經`、版本 `1.0.0`、狀態 `operational`，服務為 `core`、`trading`、`memory`、`plugin`。未描述 Git、SSH、三機 inventory 或可讀寫記憶路由。 |
| `https://brain.pin-yi.uk/api/exchanges` | 2026-08-18 | 回傳選定交易所與金鑰布林值；未含策略欄位。 |
| `https://brain.pin-yi.uk/trade/balance` | 2026-08-18 | 回傳 `balance` 字串；未含策略欄位。 |
| `https://brain.pin-yi.uk/trade/positions` | 2026-08-18 | 回傳 `positions` 陣列；當次回應為空陣列。 |

因此，App 只能顯示已回傳的健康、交易所、餘額、持倉與公開架構資料。策略、受控部署、Git／SSH、三機維護、資料整理、長期記憶讀寫及事件串流，都需要由桌機端提供明確且受控的 API 契約後才能真正串接。
