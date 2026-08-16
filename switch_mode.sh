#!/bin/bash
# ELSA Trader 模擬盤/真實盤切換（只改 TRADER_MODE，不動其他配置）

cd /media/ollama/n1/brain
MODE=${1:-demo}

if [ "$MODE" != "demo" ] && [ "$MODE" != "live" ]; then
    echo "用法: ./switch_mode.sh [demo|live]"
    echo "  demo = 模擬盤（測試用，無真實資金風險）"
    echo "  live = 真實盤（⚠️ 真錢交易！）"
    exit 1
fi

# 安全確認
if [ "$MODE" = "live" ]; then
    echo "🔴🔴🔴 即將切換至真實盤 🔴🔴🔴"
    echo "這將使用真實資金進行交易！"
    read -p "輸入 'LIVE' 確認切換: " confirm
    if [ "$confirm" != "LIVE" ]; then
        echo "❌ 已取消"
        exit 1
    fi
fi

# 只修改 TRADER_MODE 這一行
sed -i "s/^TRADER_MODE=.*/TRADER_MODE=$MODE/" .env
echo "✅ 已切換至 $MODE 模式"

# 重啟並帶入新環境
pm2 restart elsa-trader --update-env
sleep 2

# 驗證
echo ""
echo "===== 驗證連線 ====="
python3 << 'PY'
import os, ccxt
mode = os.getenv("TRADER_MODE", "unknown")
key = os.getenv(f"BITGET_API_KEY_{mode.upper()}")
secret = os.getenv(f"BITGET_API_SECRET_{mode.upper()}")
pwd = os.getenv(f"BITGET_PASSPHRASE_{mode.upper()}")
ex = ccxt.bitget({"apiKey": key, "secret": secret, "password": pwd, "options": {"defaultType": "swap"}})
try:
    b = ex.fetch_balance()
    usdt = b.get("USDT", {}).get("free", 0)
    print(f"✅ 連線成功 | 模式: {mode} | 可用餘額: {usdt} USDT")
except Exception as e:
    print(f"❌ 連線失敗: {e}")
PY

echo ""
pm2 show elsa-trader | grep -E 'status|uptime' || true
