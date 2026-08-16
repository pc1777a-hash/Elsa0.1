#!/bin/bash
cd /media/ollama/n1/brain
MODE=$(grep '^TRADER_MODE=' .env | cut -d= -f2)

echo "========== ELSA Trader 狀態 =========="
echo "🎮 交易模式: $MODE"
echo ""
pm2 show elsa-trader 2>/dev/null | grep -E 'status|uptime|memory|cpu|restart' || echo "elsa-trader 未運行"
echo ""
echo "📈 持倉:"
python3 << 'PY'
import os, ccxt
mode = os.getenv("TRADER_MODE", "demo")
key = os.getenv(f"BITGET_API_KEY_{mode.upper()}")
secret = os.getenv(f"BITGET_API_SECRET_{mode.upper()}")
pwd = os.getenv(f"BITGET_PASSPHRASE_{mode.upper()}")
ex = ccxt.bitget({"apiKey": key, "secret": secret, "password": pwd, "options": {"defaultType": "swap"}})
try:
    pos = ex.fetch_positions()
    active = [p for p in pos if float(p.get("contracts", 0) or p.get("size", 0)) > 0]
    if active:
        for p in active:
            pnl = float(p.get("unrealizedPnl", 0))
            print(f"  {p['symbol']} {p['side']} | 數量:{p.get('contracts', p.get('size', 0))} | 未實現:{pnl:+.4f} USDT")
    else:
        print("  無持倉")
except Exception as e:
    print(f"  獲取失敗: {e}")
PY

echo ""
echo "📋 今日選股:"
cat daily_picks.json 2>/dev/null | python3 -m json.tool 2>/dev/null | head -15 || echo "  尚未生成"
