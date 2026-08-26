# System Bible 公開回應記錄

來源：<https://brain.pin-yi.uk/api/system/bible>

擷取時間：2026-08-18T20:32:59.005835

```json
{
  "services": ["core", "trading", "memory", "plugin"],
  "status": "operational",
  "timestamp": "2026-08-18T20:32:59.005835",
  "title": "ELSA-V5 系統聖經",
  "version": "1.0.0"
}
```

此公開端點目前只回報服務分類與整體運作狀態，沒有包含三機 IP、SSH 連接埠、工作者執行細節或部署規格；這些欄位必須改以其各自已驗證的 N1 回報路由或主人提供的實測輸出核對，不能由此端點推測。

## 同次 N1 公開回報

來源：

- <https://brain.pin-yi.uk/api/system/structure>
- <https://brain.pin-yi.uk/api/perpetual/status>
- <https://brain.pin-yi.uk/api/system/resources>
- <https://brain.pin-yi.uk/api/perpetual/tasks>

在 2026-08-18T12:33:21Z，結構路由只宣告 N1、N2、N3 的角色，未回傳 IP 或 SSH 連接埠。永動腦狀態為 `online`，但 `worker_version` 為 `n1-route-bridge/1`、`last_heartbeat` 為 `null`、佇列深度為 `1`。任務 `pt-5b1abfe22c74` 仍是 `queued`，其明確步驟是 `queued; no worker has claimed this task`，且 `executor_mode` 為 `awaiting_reviewed_worker`。因此現有程序已證實僅提供佇列路由，尚未提供會認領並執行程式／部署的工作者證據。

## 公開端點即時驗證補記

來源與讀取時間：2026-08-18，無快取讀取。

| 來源 | 已驗證回報 | 對 App 的結論 |
|---|---|---|
| <https://brain.pin-yi.uk/api/system/bible> | `core`、`trading`、`memory`、`plugin` 四項服務分類，狀態 `operational`，版本 `1.0.0` | 此端點是服務總覽，**不含**三機地址、SSH 埠、任務執行細節或部署規格。 |
| <https://brain.pin-yi.uk/api/system/structure> | N1=brain_center、N2=public_tunnel、N3=remote_ssh；資料流為 perpetual_brain→n1_memory_index→r2_raw_archive→trade_executor | 結構角色可呈現；IP 與 SSH 埠須使用主人提供且已驗證的連線輸出，不能由此路由推測。 |
| <https://brain.pin-yi.uk/api/perpetual/status> | `online=true`、`loop_state=online`、`worker_version=n1-route-bridge/1`、`queue_depth=1`、`last_heartbeat=null` | UI 應顯示「佇列橋接已上線」，不可稱為已執行工作者。 |
| <https://brain.pin-yi.uk/api/perpetual/tasks> | `pt-5b1abfe22c74` 仍為 `queued`，明示 `no worker has claimed this task` | `elsa-selfevolve` 尚未接入這個 API 佇列；此缺口需要獨立接線。 |
| <https://brain.pin-yi.uk/api/system/resources> | GTX 1080 Ti 11,264 MB、已用 359 MB；磁碟 915.79 GB、已用 461.57 GB；已載入 `nomic-embed-text:latest` | N1 資源卡可顯示，且應使用端點實值覆蓋舊快照。 |
