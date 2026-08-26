# 三機系統脈絡快照

> 本快照由主人於 2026-08-18 15:39（GMT+8）提供，供 ELSA App 的記憶中心維持一致的系統脈絡。內容只保留角色、位址與設備狀態，**不含密碼、私鑰、Token 或可直接執行的維護命令**。

| 節點 | 角色 | 位址 | SSH 端口 | 資料來源狀態 |
| --- | --- | --- | --- | --- |
| N1 桌機 | 大腦中心 | `localhost` | — | N1 `nvidia-smi` 回報 |
| N2 筆電 | 公網隧道 | `100.120.139.65` | `2222` | 等待 N1 代理 inventory 驗證 |
| N3 手機 | SSH 遠端 | `100.98.242.48` | `8022` | 等待 N1 代理 inventory 驗證 |

## N1 GPU／模型服務回報

| 項目 | 回報值 |
| --- | --- |
| GPU | NVIDIA GeForce GTX 1080 Ti |
| VRAM | 11,264 MiB 總量；358 MiB 使用中 |
| GPU 使用率 | 0% |
| 模型服務 | `/usr/local/lib/ollama/llama-server` 使用 322 MiB GPU 記憶體 |

此靜態脈絡必須在 N1 提供受控的唯讀 `GET /api/ops/inventory` 後，改以即時回傳取代。手機 App 不直接登入 N2／N3，也不保存 SSH 憑證。
