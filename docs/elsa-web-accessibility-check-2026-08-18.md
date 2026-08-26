# elsa.pin-yi.uk 可達性初步檢查

## 公開 HTTPS 結果

- 檢查時間：2026-08-18 13:06（GMT+8）。
- URL：`https://elsa.pin-yi.uk/`。
- 首頁已由公開 HTTPS 成功載入，標題為「艾西自主矩陣 - AGI 統合控制面板 | AICI / ELSA-V5」。
- 頁面呈現意識通訊、角色狀態與對話輸入框，表示 DNS、TLS 與靜態前端傳遞並非完全不可達。

## 頁面內故障訊號

- 頁面主內容顯示「等待大腦實時推播...」。
- 頁面顯示「大腦離線」。
- 前端反覆嘗試連線到同網域的 `https://elsa.pin-yi.uk/api/stream`，每次約 27–405 毫秒即結束，符合串流端點立即關閉、回傳非串流內容，或反向代理未正確轉送 SSE 的情形。
- 瀏覽器主控台目前沒有可見 JavaScript 例外；因此故障焦點由靜態網頁縮小到 `/api/stream` 的 SSE 後端、其 N1 服務監聽，或 Cloudflare Tunnel／反向代理的串流設定。
- 以網頁內 `fetch('/api/stream')` 實測得到 HTTP `404`、`Content-Type: text/html; charset=utf-8`，回應內容是 Flask「Not Found」頁。因此前端可正常載入，但提供 `elsa.pin-yi.uk` 的 Flask／反向代理目標沒有掛載 `/api/stream`；這是「大腦離線」的直接原因。

## 前端串流契約

頁面內嵌 JavaScript 以 `new EventSource('/api/stream')` 建立 SSE 連線。當端點開啟時，頁面顯示「大腦在線 · 實時推播」；發生錯誤時顯示「大腦離線」，三秒後重試。後端需回傳 `text/event-stream` 且每筆 `data:` 的 JSON 訊息採用 `{"type":"log","data":{...}}` 或 `{"type":"status","data":{...}}` 形式。`log` 物件至少使用 `cat`、`time`、`msg`；`status` 可使用 `bitget_balance`、`sd_status`、`last_cycle`。

## 資料來源

- `https://elsa.pin-yi.uk/` 的公開頁面檢查。
