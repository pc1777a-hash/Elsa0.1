#!/usr/bin/env python3
"""
ELSA-V5 自主交易引擎 — 最高級優化版
多幣種掃描 | 多時間框架 | ATR動態止損 | 信心度槓桿 | 日虧損限制 | 連虧暫停
"""
import os, json, time, traceback, asyncio, logging, re
DEMO_MODE = os.getenv("TRADE_MODE", "demo").strip().lower() == "demo"
import re as _re_module
import urllib.request
import urllib.error
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("elsa-trader")

# ============================================================
#  設定
# ============================================================
SYMBOL = "BTC/USDT:USDT"
CANDIDATE_SYMBOLS = [
    "BTC/USDT:USDT", "ETH/USDT:USDT", "SOL/USDT:USDT",
    "XRP/USDT:USDT", "DOGE/USDT:USDT", "BNB/USDT:USDT",
    "ADA/USDT:USDT", "AVAX/USDT:USDT", "LINK/USDT:USDT",
    "BR/USDT:USDT",
]

MIN_LEVERAGE = 5
MAX_LEVERAGE = 10
DEFAULT_LEVERAGE = 10

# 風控
MAX_DAILY_LOSS_PCT = 0.05        # 日最大虧損 5%
MAX_CONSECUTIVE_LOSS = 3         # 連虧 3 次暫停
LOSS_PAUSE_MINUTES = 60          # 暫停 1 小時
MAX_POSITION_RATIO = 0.20       # 單倉最多用 20% 餘額
MAX_POSITIONS = int(os.getenv("ELSA_MAX_POSITIONS", "3"))  # 最大同時持倉數
MIN_CONFIDENCE = 0.6            # 信心度 < 0.6 不開倉

# ============================================================
#  自主優化策略權重系統
# ============================================================
_STRATEGY_WEIGHTS = {
    "ema_trend": 1.0,
    "rsi": 1.0,
    "macd": 1.0,
    "volume": 1.0,
    "bollinger": 1.0,
    "stoch_rsi": 1.0,
    "williams_r": 1.0,
    "adx": 1.0,
    "cci": 1.0,
    "price_action": 1.0,
}

_STRATEGY_PERF = {k: {"wins": 0, "losses": 0} for k in _STRATEGY_WEIGHTS}

_SYMBOL_COOLDOWN = {}  # symbol -> 上次被選中的 cycle

# ═══════════════════════════════════════════════════════════════
# 狀態持久化 — 防止重啟丟失持倉資訊（Redis + 本地雙寫）
# ═══════════════════════════════════════════════════════════════
import os as _os
import json as _json
from pathlib import Path as _Path
from datetime import datetime as _dt

_STATE_DIR = _Path("/media/ollama/n1/brain/elsa-state")
_STATE_DIR.mkdir(parents=True, exist_ok=True)
_STATE_FILE = _STATE_DIR / "position_state.json"

try:
    import redis as _redis
    _r = _redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)
    _r.ping()
    _REDIS_OK = True
except Exception:
    _REDIS_OK = False
    _r = None


# ═══════════ 使用者策略設定 ═══════════
FIXED_LEVERAGE = 10      # 固定 10 倍槓桿（覆蓋 LLM 自選）
TRAIL_MODE = "gain"      # "gain"=回吐漲幅比例 | "price"=從最高點回落價格比例
TRAIL_PCT = 0.18         # 18%
MOMENTUM_ENTRY = True    # 大漲大跌前入場模式
VOL_SPIKE_X = 2.0        # 放量倍數門檻
# ═══════════════════════════════════════

def save_position_state(position_data):
    """每次決策後保存持倉狀態，防止重啟丟失"""
    try:
        state = {
            "saved_at": _dt.utcnow().isoformat(),
            "position": position_data,
        }
        state_json = _json.dumps(state, ensure_ascii=False, indent=2)
        _STATE_FILE.write_text(state_json)
        if _REDIS_OK:
            _r.set("elsa:position_state", state_json)
    except Exception as e:
        log.warning(f"[STATE] 保存失敗: {e}")

def load_position_state():
    """啟動時載入，優先 Redis，fallback 本地檔案"""
    try:
        if _REDIS_OK:
            raw = _r.get("elsa:position_state")
            if raw:
                state = _json.loads(raw)
                log.info(f"[STATE] 從 Redis 載入持倉狀態（保存於 {state.get('saved_at', '?')}）")
                return state.get("position")
        if _STATE_FILE.exists():
            state = _json.loads(_STATE_FILE.read_text())
            log.info(f"[STATE] 從本地檔案載入持倉狀態（保存於 {state.get('saved_at', '?')}）")
            return state.get("position")
    except Exception as e:
        log.warning(f"[STATE] 載入失敗: {e}")
    log.info("[STATE] 無歷史狀態，從零開始學習")
    return None

def sync_entry_price(exchange_position, saved_state):
    """保護原始入場價"""
    if not saved_state:
        return exchange_position
    saved_symbol = saved_state.get("symbol", "")
    ex_symbol = exchange_position.get("symbol", "")
    if saved_symbol == ex_symbol and saved_state.get("entry_price"):
        original_entry = saved_state["entry_price"]
        exchange_position["entry_price"] = original_entry
        exchange_position["original_entry"] = saved_state.get("original_entry", original_entry)
        log.info(f"[ENTRY] 保護原始入場價: {original_entry}")
    return exchange_position

# ═══════════════════════════════════════════════════════════════

def update_strategy_weights(indicators_active, won):
    """平倉後更新策略權重"""
    for ind in indicators_active:
        if ind not in _STRATEGY_PERF:
            continue
        if won:
            _STRATEGY_PERF[ind]["wins"] += 1
        else:
            _STRATEGY_PERF[ind]["losses"] += 1
        total = _STRATEGY_PERF[ind]["wins"] + _STRATEGY_PERF[ind]["losses"]
        if total >= 3:
            wr = _STRATEGY_PERF[ind]["wins"] / total
            _STRATEGY_WEIGHTS[ind] = max(0.3, min(2.0, wr * 2))
    log.info(f"📊 策略權重更新: {', '.join(f'{k}={v:.1f}' for k,v in _STRATEGY_WEIGHTS.items())}")
    save_brain_state()

# 循環
SCAN_INTERVAL = 120              # 掃描間隔 2 分鐘
MONITOR_INTERVAL = 15            # 持倉監控間隔 30 秒

DAILY_TOP_N = 5              # 每日硬觸發選前 N 名
MIN_TRIGGER_SCORE = 45       # 最低入場分數門檻
MAX_POSITIONS = 5            # 最大同時持倉數
DAILY_PICKS_FILE = "/media/ollama/n1/brain/daily_picks.json"


# Telegram
TG_TOKEN = os.getenv("TELEGRAM_TOKEN", "")
TG_CHAT = os.getenv("TELEGRAM_CHAT_ID", "")

# 交易狀態
_trade_state = {
    "active": False,
    "daily_pnl": 0.0,
    "daily_loss": 0.0,
    "consecutive_losses": 0,
    "pause_until": 0,
    "trade_history": [],
    "last_scan": None,
    "last_analysis": None,
    "open_positions": {},  # symbol -> position_info
    "daily_reset_time": 0,
}

# ============================================================
#  Telegram 通知
# ============================================================
import os

BRAIN_STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "elsa_brain_state.json")

# 可自調參數（含安全邊界，LLM/規則引擎只能在邊界內動）
_TUNED_PARAMS = {
    "min_confidence":   {"value": 0.6,  "min": 0.50, "max": 0.80},
    "take_profit_roe":  {"value": 8.0,  "min": 4.0,  "max": 20.0},
    "stop_loss_roe":    {"value": -4.0, "min": -10.0, "max": -2.0},
    "max_hold_minutes": {"value": 120,  "min": 30,   "max": 480},
    "position_ratio":   {"value": 0.20, "min": 0.10, "max": 0.35},
}

def get_param(name):
    return _TUNED_PARAMS[name]["value"]

def save_brain_state():
    """學習結果落盤 — 重啟不忘"""
    try:
        state = {
            "strategy_weights": _STRATEGY_WEIGHTS,
            "strategy_perf": _STRATEGY_PERF,
            "tuned_params": {k: v["value"] for k, v in _TUNED_PARAMS.items()},
            "saved_at": datetime.now(timezone.utc).isoformat(),
        }
        with open(BRAIN_STATE_FILE, "w") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log.warning(f"保存大腦狀態失敗: {e}")

def load_brain_state():
    """開機載入上次學到的東西"""
    try:
        if not os.path.exists(BRAIN_STATE_FILE):
            log.info("🧠 無歷史狀態，從零開始學習")
            return
        with open(BRAIN_STATE_FILE, "r") as f:
            state = json.load(f)
        for k, v in state.get("strategy_weights", {}).items():
            if k in _STRATEGY_WEIGHTS:
                _STRATEGY_WEIGHTS[k] = max(0.3, min(2.0, float(v)))
        for k, v in state.get("strategy_perf", {}).items():
            if k in _STRATEGY_PERF:
                _STRATEGY_PERF[k] = v
        for k, v in state.get("tuned_params", {}).items():
            if k in _TUNED_PARAMS:
                p = _TUNED_PARAMS[k]
                p["value"] = max(p["min"], min(p["max"], float(v)))
        log.info(f"🧠 大腦狀態已載入 (存於 {state.get('saved_at', '?')})")
    except Exception as e:
        log.warning(f"載入大腦狀態失敗: {e}")

def self_evolve():
    """L1 自主優化 — 根據最近 10 筆交易結果調參，永遠在安全邊界內"""
    write_self_reflections()
    history = _trade_state.get("trade_history", [])
    closed = [t for t in history if t.get("pnl", 0) != 0]
    if len(closed) < 5:
        return
    recent = closed[-10:]
    wins = [t for t in recent if t["pnl"] > 0]
    win_rate = len(wins) / len(recent)
    avg_pnl = sum(t["pnl"] for t in recent) / len(recent)

    changes = []

    def adjust(name, delta):
        p = _TUNED_PARAMS[name]
        old = p["value"]
        p["value"] = max(p["min"], min(p["max"], old + delta))
        if abs(p["value"] - old) > 1e-9:
            changes.append(f"{name}: {old:.2f}->{p['value']:.2f}")

    if win_rate < 0.40:
        adjust("min_confidence", 0.05)   # 勝率低 → 提高門檻少做爛單
        adjust("stop_loss_roe", 0.5)     # 止損收緊
        adjust("position_ratio", -0.02)  # 降倉位
    elif win_rate > 0.65:
        adjust("min_confidence", -0.03)  # 勝率高 → 放寬抓更多機會
        adjust("take_profit_roe", 1.0)   # 讓利潤奔跑
    if avg_pnl < 0:
        adjust("max_hold_minutes", -15)  # 磨倉沒賺 → 縮短持倉時間

    if changes:
        log.info(f"🧬 自我進化: 勝率 {win_rate*100:.0f}% 均盈虧 {avg_pnl:+.4f} | " + ", ".join(changes))
        save_brain_state()

load_brain_state()

REFLECTION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "elsa_reflections.json")
_reflected_count = 0

def load_reflections(limit=5):
    try:
        if os.path.exists(REFLECTION_FILE):
            with open(REFLECTION_FILE, "r") as f:
                return json.load(f)[-limit:]
    except Exception:
        pass
    return []

def write_self_reflections():
    """新平倉出現時，寫下自己的交易反思"""
    global _reflected_count
    closed = [t for t in _trade_state.get("trade_history", []) if t.get("pnl", 0) != 0]
    if len(closed) <= _reflected_count:
        return
    new_trades = closed[_reflected_count:]
    _reflected_count = len(closed)
    notes = load_reflections(limit=50)
    for t in new_trades:
        won = t.get("pnl", 0) > 0
        inds = ", ".join(t.get("indicators_active", [])) or "無記錄"
        note = (f"{t.get('symbol','?')} {t.get('side','?')} "
                f"{'賺' if won else '賠'} {abs(t.get('pnl',0)):.4f}U | "
                f"當時用: {inds} | "
                f"{'這組指標這次有效' if won else '這組指標這次失效，下次降低信任'}")
        notes.append({"time": datetime.now(timezone.utc).isoformat(), "note": note})
        log.info(f"🪞 自我反思: {note}")
    try:
        with open(REFLECTION_FILE, "w") as f:
            json.dump(notes[-50:], f, ensure_ascii=False, indent=2)
    except Exception as e:
        log.warning(f"反思存檔失敗: {e}")


def send_telegram(msg):
    if not TG_TOKEN or not TG_CHAT:
        return
    try:
        import urllib.request, urllib.parse
        url = f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage"
        data = urllib.parse.urlencode({
            "chat_id": TG_CHAT,
            "text": msg,
            "parse_mode": "HTML"
        }).encode()
        urllib.request.urlopen(url, data, timeout=10)
    except Exception as e:
        log.warning(f"Telegram 發送失敗: {e}")

# ============================================================
#  交易所初始化
# ============================================================
_exchange = None

def get_exchange():
    global _exchange
    if _exchange is not None:
        return _exchange
    try:
        import ccxt
        _exchange = ccxt.bitget({
            "apiKey": os.getenv("BITGET_DEMO_KEY" if DEMO_MODE else "BITGET_API_KEY", ""),
            "secret": os.getenv("BITGET_DEMO_SECRET" if DEMO_MODE else "BITGET_API_SECRET", ""),
            "password": os.getenv("BITGET_DEMO_PASS" if DEMO_MODE else "BITGET_PASSPHRASE", ""),
            "headers": ({"paptrading": "1"} if DEMO_MODE else {}),
            "enableRateLimit": True,
            "timeout": 30000,
            "options": {"defaultType": "future"},
        })
        _exchange.load_markets()
        log.info("✅ Bitget 交易所連線成功")
        return _exchange
    except Exception as e:
        log.error(f"❌ Bitget 連線失敗: {e}")
        return None


# ============================================================
#  餘額安全讀取 — Bitget 的 free/total 可能是 dict
# ============================================================
def get_free_balance(exchange):
    """安全取得可用餘額，處理 Bitget 回傳格式"""
    try:
        bal = exchange.fetch_balance()
        # Bitget: free 可能是 {'USDT': 0.28} 或 number
        free = bal.get("free", 0)
        if isinstance(free, dict):
            free = free.get("USDT", 0)
        usdt_free = bal.get("USDT", {}).get("free", 0)
        result = float(free) if free else (float(usdt_free) if usdt_free else 0)
        return result
    except Exception as e:
        log.warning(f"⚠️ 取可用餘額失敗: {e}")
        return 0


def get_total_balance(exchange):
    """安全取得總餘額"""
    try:
        bal = exchange.fetch_balance()
        total = bal.get("total", 0)
        if isinstance(total, dict):
            total = total.get("USDT", 0)
        usdt_total = bal.get("USDT", {}).get("total", 0)
        result = float(total) if total else (float(usdt_total) if usdt_total else 0)
        return result
    except Exception as e:
        log.warning(f"⚠️ 取總餘額失敗: {e}")
        return 0


def safe_close_amount(exchange, symbol, raw_contracts):
    """按交易所精度安全計算平倉數量，回傳 0 代表不能平"""
    try:
        contracts = float(raw_contracts)
        if contracts <= 0:
            return 0
        mkt = exchange.market(symbol)
        precision = mkt.get("precision", {}).get("amount", 1)
        min_amount = mkt.get("limits", {}).get("amount", {}).get("min", 1)
        # 按精度取整
        if precision and precision >= 1:
            contracts = int(contracts // precision) * int(precision)
        else:
            # 小數精度，用 round
            decimals = 0
            if precision > 0:
                decimals = max(0, int(round(-1 * __import__('math').log10(precision))))
            contracts = round(contracts, decimals)
        # 確保 >= 最小量
        if contracts < float(min_amount):
            log.warning(f"⚠️ {symbol} 平倉量 {contracts} < 最小 {min_amount}，跳過")
            return 0
            return 0
        return contracts
    except Exception as e:
        log.warning(f"⚠️ 計算平倉量失敗: {e}")
        return 0



def get_pos_size(pos_info, exchange=None, symbol=None):
    """安全取得持倉數量：size > contracts > fallback 從交易所拉"""
    size = float(pos_info.get("size", 0) or pos_info.get("contracts", 0) or 0)
    if size > 0:
        return size
    # fallback: 直接從交易所拉
    if exchange and symbol:
        try:
            for _p in exchange.fetch_positions([symbol]):
                _c = float(_p.get("contracts", 0) or _p.get("size", 0) or 0)
                if _c > 0:
                    return _c
        except:
            pass
    return 0.0




# ═══════════ 加倉金字塔守門員 ═══════════
_add_tracker = {}  # {symbol: {"count": int, "avg": float, "total": float}}

def should_add_position(exchange, symbol, pos_side, entry_price, mark_price, contracts, pnl_pct):
    """加倉六關 — 過不了就回傳 (False, 原因)"""
    # 關卡0: 次數上限（金字塔最多2層）
    t = _add_tracker.get(symbol, {"count": 0})
    if t["count"] >= 2:
        return False, f"已加倉{t['count']}次，達上限"

    # 關卡1: 浮盈門檻 >3%（方向已被驗證）
    if pnl_pct < 3:
        return False, f"浮盈 {pnl_pct:.1f}% < 3%"

    # 關卡2: 策略組合共振 >=4/6 同向
    try:
        combo = strategy_combo_score(exchange, symbol)
        same_dir = combo["longs"] if pos_side == "long" else combo["shorts"]
        if same_dir < 4:
            return False, f"策略共振不足 {same_dir}/6 < 4"
    except Exception as e:
        log.warning(f"加倉檢查-策略組合失敗: {e}")
        return False, "策略組合取得失敗，保守不加"

    # 關卡3: 不放鴿子 — 不能離均線太遠（追高末端不加）
    try:
        closes = [c[4] for c in exchange.fetch_ohlcv(symbol, "15m", limit=25)]
        ema20 = sum(closes[-20:]) / 20
        atr = max(closes[-14:]) - min(closes[-14:])
        dist = abs(mark_price - ema20) / atr if atr > 0 else 99
        if dist > 2.0:
            return False, f"離均線 {dist:.1f}x ATR 太遠，追高末端"
    except Exception as e:
        log.warning(f"加倉檢查-均線距離失敗: {e}")

    # 關卡4: RSI 不極端（超買不加多 / 超賣不加空）
    try:
        rsi = calc_rsi(closes, 14)
        if rsi is not None:
            if pos_side == "long" and rsi > 80:
                return False, f"RSI {rsi:.0f} > 80 極度超買"
            if pos_side == "short" and rsi < 20:
                return False, f"RSI {rsi:.0f} < 20 極度超賣"
    except Exception:
        pass

    # 關卡5: 縮量不加（沒人接力的漲勢是假漲勢）
    try:
        ohlcv = exchange.fetch_ohlcv(symbol, "15m", limit=25)
        vols = [c[5] for c in ohlcv]
        vol_ratio = vols[-1] / (sum(vols[-21:-1]) / 20) if sum(vols[-21:-1]) > 0 else 1
        if vol_ratio < 0.7:
            return False, f"縮量 {vol_ratio:.2f}x < 0.7x，動能衰竭"
    except Exception as e:
        log.warning(f"加倉檢查-量能失敗: {e}")

    return True, f"六關全過（已加{t['count']}次）"

def record_add(symbol, entry_price, contracts, add_price, add_size):
    """記錄加倉，回傳新均價"""
    t = _add_tracker.setdefault(symbol, {"count": 0, "avg": entry_price, "total": contracts})
    new_total = t["total"] + add_size
    t["avg"] = (t["avg"] * t["total"] + add_price * add_size) / new_total
    t["total"] = new_total
    t["count"] += 1
    return t["avg"], t["count"]

def clear_add_tracker(symbol):
    _add_tracker.pop(symbol, None)
# ═══════════════════════════════════════


# ============================================================
#  每日硬觸發排名選股
# ============================================================
def scan_daily_top_picks(exchange, top_n=DAILY_TOP_N):
    """每日掃描所有交易對，按硬觸發共振強度排名，返回前 N 名"""
    import json as _json
    from datetime import datetime, timezone
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    # 檢查今日是否已選
    try:
        with open(DAILY_PICKS_FILE) as _f:
            cache = _json.load(_f)
        if cache.get("date") == today and cache.get("picks") is not None:
            log.info(f"📋 今日已選 TOP{top_n}: {[p['symbol'] for p in cache['picks']]}")
            return cache["picks"]
    except:
        pass
    
    # 獲取所有活躍 USDT 永續合約
    try:
        exchange.load_markets()
        symbols = [s for s in exchange.symbols if s.endswith("/USDT:USDT")]
    except Exception as e:
        log.warning(f"獲取市場列表失敗: {e}")
        return []
    
    log.info(f"🔍 開始掃描 {len(symbols)} 個交易對...")
    scores = []
    for symbol in symbols[:200]:  # 限制數量避免超時
        try:
            score, direction, details = _calc_trigger_score(exchange, symbol)
            if score >= MIN_TRIGGER_SCORE:
                scores.append({
                    "symbol": symbol,
                    "score": score,
                    "direction": direction,
                    "details": details,
                })
        except Exception:
            continue
    
    scores.sort(key=lambda x: x["score"], reverse=True)
    top_picks = scores[:top_n]
    
    # 寫入緩存
    try:
        with open(DAILY_PICKS_FILE, "w") as _f:
            _json.dump({"date": today, "picks": top_picks, "scanned": len(scores)}, _f, indent=2)
    except Exception as e:
        log.warning(f"寫入 daily_picks 失敗: {e}")
    
    if top_picks:
        log.info(f"🏆 今日硬觸發 TOP{top_n}: " + ", ".join(
            f"{p['symbol']}({p['direction']}={p['score']})" for p in top_picks
        ))
    else:
        log.info("📭 今日無符合硬觸發條件的標的")
    return top_picks


def _calc_trigger_score(exchange, symbol):
    """計算單一標的硬觸發分數，返回 (score, direction, details)"""
    ohlcv = exchange.fetch_ohlcv(symbol, "1h", limit=100)
    if len(ohlcv) < 50:
        return 0, None, {}
    
    closes = [x[4] for x in ohlcv]
    highs = [x[2] for x in ohlcv]
    lows = [x[3] for x in ohlcv]
    volumes = [x[5] for x in ohlcv]
    
    score = 0
    direction = None
    details = {}
    
    # EMA 趨勢
    ema20 = calc_ema(closes, 20)[-1] if len(calc_ema(closes, 20)) else closes[-1]
    ema50 = calc_ema(closes, 50)[-1] if len(calc_ema(closes, 50)) else closes[-1]
    if ema20 > ema50 * 1.001:
        score += 12; direction = "long"; details["ema"] = "bull"
    elif ema20 < ema50 * 0.999:
        score += 12; direction = "short"; details["ema"] = "bear"
    
    # MACD
    macd_line, signal_line, _ = calc_macd(closes)
    if len(macd_line) >= 2 and len(signal_line) >= 2:
        if macd_line[-1] > signal_line[-1]:
            score += 10
            if not direction: direction = "long"
            details["macd"] = "bull"
        else:
            score += 10
            if not direction: direction = "short"
            details["macd"] = "bear"
        if macd_line[-1] > signal_line[-1] and macd_line[-2] <= signal_line[-2]:
            score += 15; direction = "long"; details["macd_cross"] = "golden"
        elif macd_line[-1] < signal_line[-1] and macd_line[-2] >= signal_line[-2]:
            score += 15; direction = "short"; details["macd_cross"] = "dead"
    
    # RSI
    rsi = calc_rsi(closes)[-1]
    if direction == "long" and 45 < rsi < 75:
        score += 8; details["rsi"] = f"ok({rsi:.1f})"
    elif direction == "short" and 25 < rsi < 55:
        score += 8; details["rsi"] = f"ok({rsi:.1f})"
    
    # ADX 趨勢強度
    adx = calc_adx(highs, lows, closes)[-1]
    if adx > 30:
        score += 20; details["adx"] = f"strong({adx:.1f})"
    elif adx > 20:
        score += 12; details["adx"] = f"trend({adx:.1f})"
    
    # 成交量放大
    vol_avg = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else sum(volumes) / len(volumes)
    if vol_avg > 0:
        if volumes[-1] > vol_avg * 1.5:
            score += 10; details["volume"] = "spike"
        elif volumes[-1] > vol_avg:
            score += 5; details["volume"] = "above_avg"
    
    # Ichimoku
    tenkan, kijun, senkou_a, senkou_b = calc_ichimoku(highs, lows, closes)
    price = closes[-1]
    if price > max(senkou_a[-1], senkou_b[-1]):
        score += 10
        if not direction: direction = "long"
        details["ichimoku"] = "above_cloud"
    elif price < min(senkou_a[-1], senkou_b[-1]):
        score += 10
        if not direction: direction = "short"
        details["ichimoku"] = "below_cloud"
    
    # Bollinger
    bb_upper, bb_lower, bb_mid = calc_bollinger(closes)
    if direction == "long" and price > bb_mid:
        score += 8; details["bb"] = "upper_half"
    elif direction == "short" and price < bb_mid:
        score += 8; details["bb"] = "lower_half"
    
    # Supertrend
    st_dir, st_val = calc_supertrend(highs, lows, closes)
    if st_dir == "up" and direction == "long":
        score += 12; details["supertrend"] = "up"
    elif st_dir == "down" and direction == "short":
        score += 12; details["supertrend"] = "down"
    
    return score, direction, details


def is_top_pick(symbol, picks):
    """檢查標的是否在今日精選列表中"""
    if not picks:
        return False
    return any(p["symbol"] == symbol for p in picks)

def _safe_market_order(exchange, symbol, side, amount, params=None):
    """Fix: create_market_order arg order was wrong."""
    return exchange.create_order(symbol, "market", side, amount, None, params or {})

# ============================================================
#  技術指標
# ============================================================
def calc_rsi(closes, period=14):
    if len(closes) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i-1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))

def calc_ema(values, period):
    if len(values) < period:
        return values[-1] if values else 0
    k = 2.0 / (period + 1)
    ema = values[0]
    for v in values[1:]:
        ema = v * k + ema * (1 - k)
    return ema

def calc_atr(highs, lows, closes, period=14):
    if len(closes) < period + 1:
        return 0
    trs = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i-1]),
            abs(lows[i] - closes[i-1])
        )
        trs.append(tr)
    return sum(trs[-period:]) / period

def calc_macd(closes, fast=12, slow=26, signal=9):
    if len(closes) < slow + signal:
        return 0, 0, 0
    ema_fast = calc_ema(closes, fast)
    ema_slow = calc_ema(closes, slow)
    macd_line = ema_fast - ema_slow
    # 簡化 signal line
    macd_hist = [calc_ema(closes[:i+1], fast) - calc_ema(closes[:i+1], slow) for i in range(slow, len(closes))]
    signal_line = calc_ema(macd_hist, signal) if len(macd_hist) >= signal else macd_hist[-1] if macd_hist else 0
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram

# ============================================================
#  多時間框架市場分析
# ============================================================
def calc_bollinger(closes, period=20, std_mult=2):
    """布林帶"""
    if len(closes) < period:
        return 0, 0, 0
    sma = sum(closes[-period:]) / period
    variance = sum((c - sma) ** 2 for c in closes[-period:]) / period
    std = variance ** 0.5
    return sma + std_mult * std, sma, sma - std_mult * std

def calc_stoch_rsi(closes, rsi_period=14, stoch_period=14):
    """隨機 RSI"""
    if len(closes) < rsi_period + stoch_period:
        return 50
    rsi_vals = []
    for i in range(rsi_period, len(closes)):
        r = calc_rsi(closes[:i+1])
        rsi_vals.append(r)
    if len(rsi_vals) < stoch_period:
        return 50
    recent = rsi_vals[-stoch_period:]
    mn, mx = min(recent), max(recent)
    if mx == mn:
        return 50
    return (rsi_vals[-1] - mn) / (mx - mn) * 100

def calc_williams_r(highs, lows, closes, period=14):
    """威廉指標"""
    if len(closes) < period:
        return -50
    hh = max(highs[-period:])
    ll = min(lows[-period:])
    if hh == ll:
        return -50
    return (hh - closes[-1]) / (hh - ll) * -100

def calc_adx(highs, lows, closes, period=14):
    """ADX 趨勢強度"""
    if len(closes) < period * 2:
        return 20
    trs = []
    plus_dms = []
    minus_dms = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i-1]),
            abs(lows[i] - closes[i-1])
        )
        plus_dm = (highs[i] - highs[i-1]) if (highs[i] - highs[i-1]) > (lows[i-1] - lows[i]) and (highs[i] - highs[i-1]) > 0 else 0
        minus_dm = (lows[i-1] - lows[i]) if (lows[i-1] - lows[i]) > (highs[i] - highs[i-1]) and (lows[i-1] - lows[i]) > 0 else 0
        trs.append(tr)
        plus_dms.append(plus_dm)
        minus_dms.append(minus_dm)
    atr_val = sum(trs[-period:]) / period
    if atr_val == 0:
        return 20
    plus_di = (sum(plus_dms[-period:]) / period) / atr_val * 100
    minus_di = (sum(minus_dms[-period:]) / period) / atr_val * 100
    if plus_di + minus_di == 0:
        return 20
    dx = abs(plus_di - minus_di) / (plus_di + minus_di) * 100
    return dx

def calc_cci(highs, lows, closes, period=20):
    """CCI 指標"""
    if len(closes) < period:
        return 0
    tp = [(h + l + c) / 3 for h, l, c in zip(highs[-period:], lows[-period:], closes[-period:])]
    sma = sum(tp) / period
    md = sum(abs(t - sma) for t in tp) / period
    if md == 0:
        return 0
    return (tp[-1] - sma) / (0.015 * md)

def detect_price_pattern(opens, highs, lows, closes):
    """K 線型態偵測"""
    if len(closes) < 2:
        return "none", 0
    o, c = opens[-1], closes[-1]
    h, l = highs[-1], lows[-1]
    body = abs(c - o)
    rng = h - l if h - l > 0 else 0.0001
    upper_wick = h - max(o, c)
    lower_wick = min(o, c) - l

    if lower_wick > body * 2 and upper_wick < body * 0.5:
        return "hammer", 1
    if upper_wick > body * 2 and lower_wick < body * 0.5:
        return "shooting_star", -1
    if body > rng * 0.7:
        if c > o:
            return "bullish_marubozu", 1
        else:
            return "bearish_marubozu", -1
    if len(closes) >= 2:
        prev_o, prev_c = opens[-2], closes[-2]
        if prev_c < prev_o and c > o and c > prev_o and o < prev_c:
            return "bullish_engulfing", 1
        if prev_c > prev_o and c < o and c < prev_o and o > prev_c:
            return "bearish_engulfing", -1
    return "none", 0

def analyze_symbol(exchange, symbol):
    """分析單一交易對，多時間框架"""
    try:
        result = {"symbol": symbol, "score": 0, "signal": "NEUTRAL", "data": {}}

        # 多時間框架
        timeframes = {"15m": 100, "1h": 100, "4h": 50}
        scores = []

        for tf, limit in timeframes.items():
            ohlcv = exchange.fetch_ohlcv(symbol, tf, limit=limit)
            if not ohlcv or len(ohlcv) < 30:
                continue

            closes = [c[4] for c in ohlcv]
            highs = [c[2] for c in ohlcv]
            lows = [c[3] for c in ohlcv]
            volumes = [c[5] for c in ohlcv]

            rsi = calc_rsi(closes)
            ema9 = calc_ema(closes, 9)
            ema21 = calc_ema(closes, 21)
            ema50 = calc_ema(closes, 50)
            atr = calc_atr(highs, lows, closes)
            macd_line, signal_line, histogram = calc_macd(closes)

            current_price = closes[-1]
            avg_volume = sum(volumes[-20:]) / 20
            vol_ratio = volumes[-1] / avg_volume if avg_volume > 0 else 1

            # 趨勢評分
            tf_score = 0
            # EMA 趨勢
            if ema9 > ema21 > ema50:
                tf_score += 30
            elif ema9 < ema21 < ema50:
                tf_score -= 30
            # RSI
            if rsi < 30:
                tf_score += 20  # 超賣反彈
            elif rsi > 70:
                tf_score -= 20  # 超買回調
            elif 50 < rsi < 65:
                tf_score += 10  # 健康多頭
            # MACD
            if histogram > 0 and macd_line > signal_line:
                tf_score += 15
            elif histogram < 0 and macd_line < signal_line:
                tf_score -= 15
            # 成交量
            if vol_ratio > 1.5:
                tf_score += 5  # 放量確認

            result["data"][tf] = {
                "price": current_price,
                "rsi": round(rsi, 2),
                "ema9": round(ema9, 6),
                "ema21": round(ema21, 6),
                "ema50": round(ema50, 6),
                "atr": round(atr, 6),
                "macd_hist": round(histogram, 6),
                "vol_ratio": round(vol_ratio, 2),
                "score": tf_score,
            }
            scores.append(tf_score)

        if scores:
            result["score"] = sum(scores) / len(scores)
            if result["score"] > 25:
                result["signal"] = "LONG"
            elif result["score"] < -25:
                result["signal"] = "SHORT"
            else:
                result["signal"] = "NEUTRAL"

        return result
    except Exception as e:
        log.warning(f"分析 {symbol} 失敗: {e}")
        return {"symbol": symbol, "score": 0, "signal": "ERROR", "data": {}, "error": str(e)}

# ============================================================
#  掃描所有候選幣種
# ============================================================
def fetch_top_movers(exchange, limit=8):
    """從 Bitget 抓漲跌幅榜 — 動態發現 JAILSTOOL 這種機會"""
    try:
        tickers = exchange.fetch_tickers()
        movers = []
        for sym, t in tickers.items():
            if ":USDT" not in sym:
                continue
            pct = t.get("percentage")
            vol = t.get("quoteVolume") or 0
            if pct is None or vol < 1000000:  # 24h 量能 > 100萬 USDT 才玩
                continue
            movers.append({"symbol": sym, "pct": pct, "vol": vol})
        movers.sort(key=lambda x: abs(x["pct"]), reverse=True)
        top = movers[:limit]
        if top:
            names = []
            for m in top:
                base = m["symbol"].split("/")[0]
                names.append(f"{base} {m['pct']:+.1f}%")
            log.info("🔥 動態榜: " + ", ".join(names))
        return [m["symbol"] for m in top]
    except Exception as e:
        log.warning(f"抓動態榜失敗: {e}")
        return []

def scan_market(exchange):
    """掃描固定候選 + 動態漲幅榜，返回排名"""
    results = []
    dynamic = fetch_top_movers(exchange, limit=8)
    all_symbols = list(dict.fromkeys(CANDIDATE_SYMBOLS + dynamic))
    log.info(f"🔎 掃描 {len(all_symbols)} 個幣 (固定 {len(CANDIDATE_SYMBOLS)} + 動態 {len(dynamic)})")
    for symbol in all_symbols:
        if symbol not in exchange.markets:
            continue
        # 重試 3 次
        analysis = None
        for attempt in range(3):
            analysis = analyze_symbol(exchange, symbol)
            if analysis["signal"] != "ERROR":
                break
            log.warning(f"重試 {symbol} ({attempt+1}/3)")
            time.sleep(2)
        if analysis and analysis["signal"] != "ERROR":
            results.append(analysis)
        time.sleep(0.5)  # 避免 rate limit

    # 按分數排序
    results.sort(key=lambda x: abs(x["score"]), reverse=True)
    return results

# ============================================================
#  LLM 大腦決策
# ============================================================
_llm = None

# ============================================================
#  全方位情報收集系統 — 盡一切辦法收集數據
# ============================================================

def fetch_fear_greed_index():
    """恐懼貪婪指數 — 市場整體情緒"""
    try:
        url = "https://api.alternative.me/fng/?limit=1"
        req = urllib.request.Request(url, headers={"User-Agent": "ELSA-Trader/2.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            value = int(data["data"][0]["value"])
            classification = data["data"][0]["value_classification"]
            # 0-25 極度恐懼, 25-45 恐懼, 45-55 中性, 55-75 貪婪, 75-100 極度貪婪
            if value < 25:
                bias = "極度恐懼 — 可能超跌反彈機會"
            elif value < 45:
                bias = "恐懼 — 偏空但注意反轉"
            elif value < 55:
                bias = "中性 — 觀望"
            elif value < 75:
                bias = "貪婪 — 偏多但注意回調"
            else:
                bias = "極度貪婪 — 可能超買回落風險"
            return {"value": value, "classification": classification, "bias": bias}
    except Exception as e:
        log.warning(f"恐懼貪婪指數取得失敗: {e}")
        return None


def fetch_funding_rate(exchange, symbol):
    """資金費率 — 多空市場傾向"""
    try:
        funding = exchange.fetch_funding_rate(symbol)
        rate = float(funding.get("fundingRate", 0))
        next_time = funding.get("fundingDatetime", "")
        # 正費率 = 多頭付空頭 = 市場偏多; 負費率 = 空頭付多頭 = 市場偏空
        if rate > 0.0005:
            bias = f"極度偏多 {rate*100:.4f}% — 多頭擁擠，注意多殺多"
        elif rate > 0.0001:
            bias = f"偏多 {rate*100:.4f}% — 多頭情緒"
        elif rate > -0.0001:
            bias = f"中性 {rate*100:.4f}% — 多空均衡"
        elif rate > -0.0005:
            bias = f"偏空 {rate*100:.4f}% — 空頭情緒"
        else:
            bias = f"極度偏空 {rate*100:.4f}% — 空頭擁擠，注意軋空"
        return {"rate": rate, "bias": bias, "next_funding": next_time}
    except Exception as e:
        log.warning(f"資金費率取得失敗 {symbol}: {e}")
        return None


def fetch_open_interest(exchange, symbol):
    """未平倉量 — 大戶動向"""
    try:
        if hasattr(exchange, "fetch_open_interest"):
            oi = exchange.fetch_open_interest(symbol)
            if oi is None:
                return None
            
            # 安全取值 — 處理 None 和各種 key
            raw_amount = (
                oi.get("openInterestAmount") 
                or oi.get("openInterest") 
                or (oi.get("info") or {}).get("openInterest") 
                or 0
            )
            raw_value = (
                oi.get("openInterestValue") 
                or (oi.get("info") or {}).get("openInterestValue") 
                or 0
            )
            
            # 處理 None 值
            if raw_amount is None:
                raw_amount = 0
            if raw_value is None:
                raw_value = 0
                
            current = float(raw_amount)
            value = float(raw_value)
            
            if current > 0:
                return {"open_interest": current, "value": value}
            else:
                return None
    except Exception as e:
        log.warning(f"未平倉量取得失敗 {symbol}: {e}")
    return None


def fetch_order_book_pressure(exchange, symbol):
    """訂單簿深度 — 買賣壓力分析"""
    try:
        ob = exchange.fetch_order_book(symbol, limit=50)
        bids = ob["bids"][:20]
        asks = ob["asks"][:20]

        bid_volume = sum(b[1] for b in bids)
        ask_volume = sum(a[1] for a in asks)

        # 買賣壓力比
        if ask_volume > 0:
            ratio = bid_volume / ask_volume
        else:
            ratio = 1.0

        if ratio > 2.0:
            pressure = f"極度買盤 {ratio:.2f}x — 強烈買壓"
        elif ratio > 1.3:
            pressure = f"買盤偏強 {ratio:.2f}x — 多頭主導"
        elif ratio > 0.8:
            pressure = f"均衡 {ratio:.2f}x — 多空拉鋸"
        elif ratio > 0.5:
            pressure = f"賣盤偏強 {ratio:.2f}x — 空頭主導"
        else:
            pressure = f"極度賣盤 {ratio:.2f}x — 強烈賣壓"

        # 最近大單
        big_bid = max(bids, key=lambda x: x[1]) if bids else [0, 0]
        big_ask = max(asks, key=lambda x: x[1]) if asks else [0, 0]

        return {
            "bid_ask_ratio": round(ratio, 2),
            "pressure": pressure,
            "big_bid": {"price": big_bid[0], "size": big_bid[1]},
            "big_ask": {"price": big_ask[0], "size": big_ask[1]},
        }
    except Exception as e:
        log.warning(f"訂單簿取得失敗 {symbol}: {e}")
    return None


def fetch_recent_trades_flow(exchange, symbol):
    """近期成交 — 主動買賣方向"""
    try:
        try:
            trades = exchange.fetch_trades(symbol, limit=50)
        except Exception:
            # Demo 環境無此端點 — 用 OHLCV 推斷主動買賣
            _o = exchange.fetch_ohlcv(symbol, "1m", limit=50)
            trades = [{"side": "buy" if c[4] >= c[1] else "sell", "amount": c[5]} for c in _o]
        buy_volume = sum(t["amount"] for t in trades if t["side"] == "buy")
        sell_volume = sum(t["amount"] for t in trades if t["side"] == "sell")
        total = buy_volume + sell_volume
        if total > 0:
            buy_pct = (buy_volume / total) * 100
            if buy_pct > 65:
                flow = f"主動買入 {buy_pct:.0f}% — 多頭進場"
            elif buy_pct > 55:
                flow = f"偏買 {buy_pct:.0f}% — 多頭略多"
            elif buy_pct > 45:
                flow = f"均衡 {buy_pct:.0f}% — 多空均衡"
            elif buy_pct > 35:
                flow = f"偏賣 {buy_pct:.0f}% — 空頭略多"
            else:
                flow = f"主動賣出 {buy_pct:.0f}% — 空頭進場"
            return {"buy_pct": round(buy_pct, 1), "flow": flow}
    except Exception as e:
        log.warning(f"近期成交取得失敗 {symbol}: {e}")
    return None


def fetch_crypto_news():
    """加密新聞 — 即時消息情緒（多來源 fallback）"""
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    
    # 來源1: CoinGecko trending（免費無需 key）
    try:
        url = "https://api.coingecko.com/api/v3/search/trending"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            coins = data.get("coins", [])[:5]
            if coins:
                headlines = [f"{c['item']['name']} 熱門趨勢 #{c['item'].get('market_cap_rank','?')}" for c in coins]
                return {
                    "sentiment": f"趨勢: {', '.join(headlines[:3])}",
                    "headlines": headlines,
                    "positive": len(coins),
                    "negative": 0,
                }
    except Exception as e:
        log.warning(f"新聞來源1失敗: {e}")
    
    # 來源2: CryptoPanic（用瀏覽器 UA 試試）
    try:
        url = "https://cryptopanic.com/api/v1/posts/?kind=news&filter=hot&public=true"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            posts = data.get("results", [])[:10]
            if not posts:
                return None

            news_items = []
            positive = 0
            negative = 0
            for p in posts:
                title = p.get("title", "")
                votes = p.get("votes", {})
                pos = votes.get("positive", 0)
                neg = votes.get("negative", 0)
                if pos > neg:
                    positive += 1
                elif neg > pos:
                    negative += 1
                news_items.append(title)

            if positive > negative + 2:
                sentiment = f"正面 {positive}/{len(news_items)} — 利好消息多"
            elif negative > positive + 2:
                sentiment = f"負面 {negative}/{len(news_items)} — 利空消息多"
            else:
                sentiment = f"中性 {positive}正/{negative}負 — 消息混合"

            return {
                "headlines": news_items[:5],
                "sentiment": sentiment,
                "positive": positive,
                "negative": negative,
            }
    except Exception as e:
        log.warning(f"新聞取得失敗: {e}")
    return None


def fetch_whale_alerts():
    """鯨魚大額轉帳 — 鏈上數據"""
    try:
        # 使用公開的 Whale Alert 代理或替代 API
        url = "https://api.whale-alert.io/v1/transactions?api_key=free&min_value=500000&start=1"
        req = urllib.request.Request(url, headers={"User-Agent": "ELSA-Trader/2.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            txs = data.get("transactions", [])[:5]
            if not txs:
                return None

            to_exchange = 0
            from_exchange = 0
            for tx in txs:
                if tx.get("to", {}).get("type") == "exchange":
                    to_exchange += 1  # 轉入交易所 = 可能要賣
                if tx.get("from", {}).get("type") == "exchange":
                    from_exchange += 1  # 轉出交易所 = 可能要囤

            if to_exchange > from_exchange:
                bias = f"鯨魚轉入交易所 {to_exchange}筆 — 可能拋售"
            elif from_exchange > to_exchange:
                bias = f"鯨魚轉出交易所 {from_exchange}筆 — 可能囤幣"
            else:
                bias = "鯨魚動向不明"

            return {"bias": bias, "to_exchange": to_exchange, "from_exchange": from_exchange}
    except Exception as e:
        # Whale Alert 需要 API key，失敗就跳過
        return None


def gather_market_intelligence(exchange, symbol, analysis_data):
    """全方位情報收集 — 盡一切辦法收集所有可用數據"""
    log.info(f"🔍 收集 {symbol} 全方位情報...")

    intel = {}

    # 1. 恐懼貪婪指數
    intel["fear_greed"] = fetch_fear_greed_index()

    # 2. 資金費率
    intel["funding"] = fetch_funding_rate(exchange, symbol)

    # 3. 未平倉量
    intel["open_interest"] = fetch_open_interest(exchange, symbol)

    # 4. 訂單簿深度
    intel["order_book"] = fetch_order_book_pressure(exchange, symbol)

    # 5. 近期成交流向
    intel["trade_flow"] = fetch_recent_trades_flow(exchange, symbol)

    # 6. 加密新聞
    intel["news"] = fetch_crypto_news()

    # 7. 鯨魚動向
    intel["whale"] = fetch_whale_alerts()

    # 計算情報分數
    signals = []
    if intel.get("fear_greed"):
        fg = intel["fear_greed"]["value"]
        if fg < 25:
            signals.append(("恐懼指數超低", "bullish"))
        elif fg > 75:
            signals.append(("恐懼指數超高", "bearish"))

    if intel.get("funding"):
        rate = intel["funding"]["rate"]
        if rate < -0.0003:
            signals.append(("資金費率極負", "bullish"))
        elif rate > 0.0005:
            signals.append(("資金費率極正", "bearish"))

    if intel.get("order_book"):
        ratio = intel["order_book"]["bid_ask_ratio"]
        if ratio > 1.5:
            signals.append(("買盤遠大於賣盤", "bullish"))
        elif ratio < 0.6:
            signals.append(("賣盤遠大於買盤", "bearish"))

    if intel.get("trade_flow"):
        buy_pct = intel["trade_flow"]["buy_pct"]
        if buy_pct > 65:
            signals.append(("主動買入為主", "bullish"))
        elif buy_pct < 35:
            signals.append(("主動賣出為主", "bearish"))

    if intel.get("news"):
        if intel["news"]["positive"] > intel["news"]["negative"] + 2:
            signals.append(("新聞情緒偏多", "bullish"))
        elif intel["news"]["negative"] > intel["news"]["positive"] + 2:
            signals.append(("新聞情緒偏空", "bearish"))

    if intel.get("whale"):
        if "轉出交易所" in intel["whale"]["bias"]:
            signals.append(("鯨魚轉出交易所", "bullish"))
        elif "轉入交易所" in intel["whale"]["bias"]:
            signals.append(("鯨魚轉入交易所", "bearish"))

    bull_count = sum(1 for _, d in signals if d == "bullish")
    bear_count = sum(1 for _, d in signals if d == "bearish")
    intel["signal_summary"] = {
        "bull_signals": bull_count,
        "bear_signals": bear_count,
        "details": [f"{s} ({d})" for s, d in signals],
    }

    log.info(f"   情報: {bull_count} 多 / {bear_count} 空")
    for s, d in signals:
        icon = "🟢" if d == "bullish" else "🔴"
        log.info(f"   {icon} {s}")

    return intel


def build_brain_prompt(symbol, analysis_data, balance, intel):
    """把所有情報組合成大腦的 prompt"""
    # 技術指標
    tf_lines = []
    for tf in ["15m", "1h", "4h"]:
        d = analysis_data.get("data", {}).get(tf, {})
        if d:
            tf_lines.append(
                f"  {tf}: 價格={d.get('price')} RSI={d.get('rsi')} "
                f"EMA9={d.get('ema9')} EMA21={d.get('ema21')} EMA50={d.get('ema50')} "
                f"MACD柱={d.get('macd_hist')} 量比={d.get('vol_ratio')} ATR={d.get('atr')}"
            )
    tech_text = "\n".join(tf_lines)

    # 情報
    intel_lines = []
    if intel.get("fear_greed"):
        fg = intel["fear_greed"]
        intel_lines.append(f"恐懼貪婪指數: {fg['value']} ({fg['classification']}) — {fg['bias']}")

    if intel.get("funding"):
        f = intel["funding"]
        intel_lines.append(f"資金費率: {f['bias']}")

    if intel.get("order_book"):
        ob = intel["order_book"]
        intel_lines.append(f"訂單簿: {ob['pressure']}")
        intel_lines.append(f"  最大買單: {ob['big_bid']['size']} @ {ob['big_bid']['price']}")
        intel_lines.append(f"  最大賣單: {ob['big_ask']['size']} @ {ob['big_ask']['price']}")

    if intel.get("trade_flow"):
        tf = intel["trade_flow"]
        intel_lines.append(f"近期成交: {tf['flow']}")

    if intel.get("news"):
        n = intel["news"]
        intel_lines.append(f"新聞情緒: {n['sentiment']}")
        for h in n.get("headlines", [])[:3]:
            intel_lines.append(f"  - {h}")

    if intel.get("whale"):
        w = intel["whale"]
        intel_lines.append(f"鯨魚動向: {w['bias']}")

    if intel.get("open_interest"):
        oi = intel["open_interest"]
        intel_lines.append(f"未平倉量: {oi.get('open_interest', 'N/A')}")

    intel_text = "\n".join(intel_lines) if intel_lines else "無額外情報"

    reflections = load_reflections()
    reflections_text = "\n".join(f"- {r.get('note','')}" for r in reflections) if reflections else "（無，這是你的第一批決策）"

    # 信號摘要
    ss = intel.get("signal_summary", {})
    summary_text = f"多頭信號: {ss.get('bull_signals', 0)} | 空頭信號: {ss.get('bear_signals', 0)}"
    if ss.get("details"):
        summary_text += "\n" + "\n".join(f"  - {d}" for d in ss["details"])

    score = analysis_data.get("score", 0)
    signal = analysis_data.get("signal", "NEUTRAL")

    prompt = f"""system
你是 ELSA，一個專業的加密貨幣自主交易 AI。你的任務是綜合所有可用情報，預測價格方向並做出交易決策。
你必須同時分析技術指標和市場情報，做出最有可能獲利的判斷。
回覆必須是 JSON 格式，包含: action (LONG/SHORT/HOLD), confidence (0-1), direction, leverage, rr_ratio (最小1.5), reason。

分析框架:
1. 技術面: EMA 排列判斷趨勢, RSI 判斷超買超賣, MACD 判斷動能, 量比確認
2. 情緒面: 恐懼貪婪指數判斷市場情緒（反向思考：極度恐懼可能是買點）
3. 衍生品面: 資金費率判斷多空傾向, 未平倉量判斷大戶動向
4. 微觀面: 訂單簿買賣壓力, 近期成交主動方向
5. 消息面: 新聞情緒, 鯨魚鏈上動向
6. 多時間框架: 15m/1h/4h 方向一致性
user
## {symbol} 全方位情報分析

### 技術指標
{tech_text}

綜合評分: {score:.1f}/100 (正=多頭, 負=空頭)
規則信號: {signal}

### 市場情報
{intel_text}

### 信號摘要
{summary_text}

### 你的歷史反思（你自己過去寫的，先讀再決策）
{reflections_text}

### 帳戶狀態
餘額: {balance:.2f} USDT

### 請分析並預測

綜合以上所有情報，判斷 {symbol} 短期會漲、跌、還是盤整。
規則：如果信號不明確或信心不足，請選 HOLD。只在有明確方向且有把握時才選 LONG 或 SHORT。confidence：0.5=勉強、0.7=有把握、0.85=強烈。信心低於 0.6 就選 HOLD。

回覆 JSON:
{{"direction": "UP 或 DOWN", "confidence": 0.0-1.0, "reason": "綜合所有情報的一句話理由", "action": "LONG 或 SHORT", "leverage": 5-10, "stop_loss_pct": 1-5, "take_profit_pct": 2-10, "key_factors": ["主要因素1", "主要因素2"]}}
assistant
"""
    return prompt



class OllamaLLM:
    """用 Ollama server 取代 llama_cpp，介面相容"""
    def __init__(self, model, base_url="http://localhost:11434"):
        self.model = model
        self.base_url = base_url.rstrip("/")

    def __call__(self, prompt, max_tokens=512, temperature=0.7, **kwargs):
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "format": "json",
            "options": {"num_predict": max_tokens, "temperature": temperature},
        }
        req = urllib.request.Request(
            f"{self.base_url}/api/chat",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
        text = data.get("message", {}).get("content", "")
        return {"choices": [{"text": text}]}


# ================= 策略組合 (TradingView 同款 7 指標) =================
import numpy as _np_s
import pandas as _pd_s

STRAT_TF = os.getenv("ELSA_STRAT_TF", "5m")

_strat_ex = None
def _strat_exchange():
    global _strat_ex
    g = globals()
    if "exchange" in g and hasattr(g["exchange"], "fetch_ohlcv"):
        return g["exchange"]
    for v in g.values():
        if hasattr(v, "fetch_ohlcv"):
            return v
    if _strat_ex is None:
        import ccxt
        _strat_ex = ccxt.bitget({
            "apiKey": os.getenv("BITGET_DEMO_KEY" if DEMO_MODE else "BITGET_API_KEY", ""),
            "secret": os.getenv("BITGET_DEMO_SECRET" if DEMO_MODE else "BITGET_API_SECRET", ""),
            "password": os.getenv("BITGET_DEMO_PASS" if DEMO_MODE else "BITGET_PASSPHRASE", ""),
            "headers": ({"paptrading": "1"} if DEMO_MODE else {}),
            "options": {"defaultType": "swap"},
        })
    return _strat_ex

def _fetch_df(symbol, tf, limit=200):
    ex = _strat_exchange()
    ohlcv = ex.fetch_ohlcv(symbol, tf, limit=limit)
    return _pd_s.DataFrame(ohlcv, columns=["ts","open","high","low","close","volume"])

def _ichimoku_sig(df):
    h, l, c = df["high"], df["low"], df["close"]
    tenkan = (h.rolling(9).max() + l.rolling(9).min()) / 2
    kijun = (h.rolling(26).max() + l.rolling(26).min()) / 2
    sa = ((tenkan + kijun) / 2).shift(26)
    sb = ((h.rolling(52).max() + l.rolling(52).min()) / 2).shift(26)
    if _np_s.isnan(sb.iloc[-1]): return 0
    p = c.iloc[-1]
    top, bot = max(sa.iloc[-1], sb.iloc[-1]), min(sa.iloc[-1], sb.iloc[-1])
    if p > top and tenkan.iloc[-1] > kijun.iloc[-1]: return 1
    if p < bot and tenkan.iloc[-1] < kijun.iloc[-1]: return -1
    return 0

def _macd_sig(df):
    e12 = df["close"].ewm(span=12).mean()
    e26 = df["close"].ewm(span=26).mean()
    hist = (e12 - e26) - (e12 - e26).ewm(span=9).mean()
    if hist.iloc[-1] > 0 and hist.iloc[-1] > hist.iloc[-2]: return 1
    if hist.iloc[-1] < 0 and hist.iloc[-1] < hist.iloc[-2]: return -1
    return 0

def _bollinger_sig(df):
    ma = df["close"].rolling(20).mean()
    sd = df["close"].rolling(20).std()
    p = df["close"].iloc[-1]
    if p > (ma + 2*sd).iloc[-1]: return 1
    if p < (ma - 2*sd).iloc[-1]: return -1
    return 0

def _range_filter_sig(df, period=100, mult=3.0):
    c = df["close"].values
    n = len(c)
    if n < period + 5: return 0
    diff = _np_s.abs(_np_s.diff(c, prepend=c[0]))
    def ema(a, s):
        al = 2.0/(s+1); o = _np_s.empty_like(a); o[0]=a[0]
        for i in range(1, len(a)): o[i] = al*a[i] + (1-al)*o[i-1]
        return o
    rng = ema(ema(diff, period), period*2-1) * mult
    filt = _np_s.empty(n); filt[0] = c[0]
    for i in range(1, n):
        r, prev, x = rng[i], filt[i-1], c[i]
        filt[i] = (prev if (x-r) < prev else x-r) if x > prev else (prev if (x+r) > prev else x+r)
    if filt[-1] > filt[-3] and c[-1] > filt[-1]: return 1
    if filt[-1] < filt[-3] and c[-1] < filt[-1]: return -1
    return 0

def _supertrend_sig(df, period=10, mult=3.0):
    h, l, c = df["high"].values, df["low"].values, df["close"].values
    n = len(c)
    if n < period + 5: return 0
    tr = _np_s.maximum(h[1:]-l[1:], _np_s.maximum(_np_s.abs(h[1:]-c[:-1]), _np_s.abs(l[1:]-c[:-1])))
    atr = _pd_s.Series(_np_s.concatenate([[h[0]-l[0]], tr])).ewm(span=period, adjust=False).mean().values
    hl2 = (h + l) / 2
    up, lo = hl2 + mult*atr, hl2 - mult*atr
    d = _np_s.zeros(n)
    for i in range(1, n):
        if c[i] > up[i-1]: d[i] = 1
        elif c[i] < lo[i-1]: d[i] = -1
        else:
            d[i] = d[i-1]
            if d[i] == 1 and lo[i] < lo[i-1]: lo[i] = lo[i-1]
            if d[i] == -1 and up[i] > up[i-1]: up[i] = up[i-1]
    vol_ma = df["volume"].rolling(20).mean().iloc[-1]
    if df["volume"].iloc[-1] < vol_ma * 0.8: return 0  # 量縮 → 訊號無效
    return int(d[-1])

def _htf_sr_sig(df_htf, price):
    if df_htf is None or len(df_htf) < 50: return 0
    res = df_htf["high"].rolling(20).max().iloc[-2]
    sup = df_htf["low"].rolling(20).min().iloc[-2]
    rng = res - sup
    if rng <= 0: return 0
    pos = (price - sup) / rng
    if pos >= 0.95: return -1
    if pos <= 0.05: return 1
    return 0

def _adx_val(df, period=14):
    """計算 ADX — 對齊 Scalper's Volatility Filter 的趨勢強度過濾"""
    h, l, c = df["high"].values, df["low"].values, df["close"].values
    n = len(c)
    if n < period * 3: return 0.0
    tr = _np_s.maximum(h[1:]-l[1:], _np_s.maximum(_np_s.abs(h[1:]-c[:-1]), _np_s.abs(l[1:]-c[:-1])))
    plus_dm = _np_s.where((h[1:]-h[:-1]) > (l[:-1]-l[1:]), _np_s.maximum(h[1:]-h[:-1], 0), 0)
    minus_dm = _np_s.where((l[:-1]-l[1:]) > (h[1:]-h[:-1]), _np_s.maximum(l[:-1]-l[1:], 0), 0)
    atr_s = _pd_s.Series(tr).ewm(span=period, adjust=False).mean()
    plus_di = 100 * _pd_s.Series(plus_dm).ewm(span=period, adjust=False).mean() / atr_s
    minus_di = 100 * _pd_s.Series(minus_dm).ewm(span=period, adjust=False).mean() / atr_s
    dx = 100 * _np_s.abs(plus_di - minus_di) / (plus_di + minus_di + 1e-10)
    adx = dx.ewm(span=period, adjust=False).mean()
    return float(adx.iloc[-1]) if not _np_s.isnan(adx.iloc[-1]) else 0.0

def _adx_val(df, period=14):
    """計算 ADX — 對齊 Scalper's Volatility Filter 的趨勢強度過濾"""
    h, l, c = df["high"].values, df["low"].values, df["close"].values
    n = len(c)
    if n < period * 3: return 0.0
    tr = _np_s.maximum(h[1:]-l[1:], _np_s.maximum(_np_s.abs(h[1:]-c[:-1]), _np_s.abs(l[1:]-c[:-1])))
    plus_dm = _np_s.where((h[1:]-h[:-1]) > (l[:-1]-l[1:]), _np_s.maximum(h[1:]-h[:-1], 0), 0)
    minus_dm = _np_s.where((l[:-1]-l[1:]) > (h[1:]-h[:-1]), _np_s.maximum(l[:-1]-l[1:], 0), 0)
    atr_s = _pd_s.Series(tr).ewm(span=period, adjust=False).mean()
    plus_di = 100 * _pd_s.Series(plus_dm).ewm(span=period, adjust=False).mean() / atr_s
    minus_di = 100 * _pd_s.Series(minus_dm).ewm(span=period, adjust=False).mean() / atr_s
    dx = 100 * _np_s.abs(plus_di - minus_di) / (plus_di + minus_di + 1e-10)
    adx = dx.ewm(span=period, adjust=False).mean()
    return float(adx.iloc[-1]) if not _np_s.isnan(adx.iloc[-1]) else 0.0

def _volatility_pct(df):
    tr = _np_s.maximum(df["high"]-df["low"], _np_s.maximum((df["high"]-df["close"].shift(1)).abs(), (df["low"]-df["close"].shift(1)).abs()))
    atrp = (tr.rolling(14).mean() / df["close"]).dropna()
    if len(atrp) < 30: return 0.5
    recent = atrp.iloc[-1]
    return float((atrp.iloc[-100:] < recent).mean())

def strategy_confluence(symbol):
    if not isinstance(symbol, str) or "/" not in symbol:
        return None
    try:
        df = _fetch_df(symbol, STRAT_TF, 200)
        df_htf = _fetch_df(symbol, "1h", 120)
        price = df["close"].iloc[-1]
        votes = {
            "ichimoku": _ichimoku_sig(df),
            "macd": _macd_sig(df),
            "bollinger": _bollinger_sig(df),
            "range_filter": _range_filter_sig(df),
            "supertrend": _supertrend_sig(df),
            "htf_sr": _htf_sr_sig(df_htf, price),
        }
        longs = sum(1 for v in votes.values() if v > 0)
        shorts = sum(1 for v in votes.values() if v < 0)
        return {
            "score": round((longs - shorts) / len(votes), 2),
            "longs": longs, "shorts": shorts,
            "votes": votes, "vol_pct": round(_volatility_pct(df), 2), "adx": round(_adx_val(df), 1), "adx": round(_adx_val(df), 1),
        }
    except Exception as e:
        log.warning(f"策略組合分析失敗 {symbol}: {e}")
        return None
# ================= 策略組合結束 =================



# ================= 自主選幣掃描器 =================
import math as _m_scan
import time as _t_scan

_scan_cache = {"ts": 0, "results": []}
SCAN_TTL = int(os.getenv("ELSA_SCAN_TTL", "300"))        # 掃描結果快取 5 分鐘
SCAN_TOP_N = int(os.getenv("ELSA_SCAN_TOP_N", "5"))      # 輸出前 N 名
SCAN_MIN_VOL = float(os.getenv("ELSA_SCAN_MIN_VOL", "5000000"))  # 24h 成交額下限 5M

_STABLES = ("USDC","USDE","FDUSD","TUSD","BUSD","DAI","USD1","USDD","EUR","AEUR")

def scan_market_opportunities(top_n=None, force=False):
    """掃描全市場，回傳策略組合評分最高的幣種清單"""
    global _scan_cache
    top_n = top_n or SCAN_TOP_N
    now = _t_scan.time()
    if not force and _scan_cache["results"] and now - _scan_cache["ts"] < SCAN_TTL:
        return _scan_cache["results"]
    ex = _strat_exchange()
    try:
        tickers = ex.fetch_tickers()
    except Exception as e:
        log.warning(f"掃描器取 tickers 失敗: {e}")
        return _scan_cache["results"]
    cands = []
    for sym, t in tickers.items():
        if not sym.endswith("/USDT:USDT"):
            continue
        base = sym.split("/")[0]
        if base in _STABLES:
            continue
        qv = t.get("quoteVolume") or 0
        pct = t.get("percentage") or 0
        if qv < SCAN_MIN_VOL:
            continue
        cands.append({"symbol": sym, "qv": qv, "pct": pct})
    # 粗排: |漲跌幅| x log(量)，取前 12 名做深度策略分析
    cands.sort(key=lambda x: abs(x["pct"]) * _m_scan.log10(max(x["qv"], 10)), reverse=True)
    results = []
    for c in cands[:12]:
        cf = strategy_confluence(c["symbol"])
        if cf is None:
            continue
        d = cf["score"]
        score = abs(d) * 0.6 + min(abs(c["pct"]) / 20, 1) * 0.25 + (1 - abs(cf["vol_pct"] - 0.5) * 2) * 0.15
        results.append({
            "symbol": c["symbol"],
            "direction": "LONG" if d > 0.2 else ("SHORT" if d < -0.2 else "NEUTRAL"),
            "strat_score": d,
            "pct_24h": round(c["pct"], 2),
            "qv_m": round(c["qv"] / 1e6, 1),
            "vol_pct": cf["vol_pct"],
            "votes": cf["votes"],
            "score": round(score, 3),
        })
        _t_scan.sleep(0.3)
    results.sort(key=lambda x: x["score"], reverse=True)
    _scan_cache = {"ts": now, "results": results[:top_n]}
    log.info("🔎 自主選幣: " + ", ".join(
        f"{r['symbol'].split('/')[0]}({r['direction']},{r['strat_score']:+.2f},24h{r['pct_24h']:+.1f}%)"
        for r in results[:top_n]))
    return _scan_cache["results"]

def _merge_scan(orig_result):
    """把掃描器的強訊號幣種插到候選清單最前面"""
    try:
        ops = scan_market_opportunities()
        strong = [o for o in ops if o["direction"] != "NEUTRAL" and o["score"] >= 0.35]
        if not strong:
            return orig_result
        syms = [o["symbol"] for o in strong]
        log.info(f"🎯 強訊號插入候選: {syms}")
        if isinstance(orig_result, (list, tuple)):
            rest = [s for s in orig_result if isinstance(s, str) and s not in syms]
            return syms + list(rest)
    except Exception as e:
        log.warning(f"自主選幣合併失敗: {e}")
    return orig_result
# ================= 掃描器結束 =================


def init_llm():
    global _llm
    if _llm is not None:
        return _llm

    # Ollama 優先
    if os.getenv("ELSA_LLM_BACKEND", "ollama") == "ollama":
        try:
            model = os.getenv("ELSA_OLLAMA_MODEL", "elsa-trader:latest")
            llm = OllamaLLM(model)
            llm('{"ok": true}', max_tokens=8)
            _llm = llm
            log.info(f"✅ Ollama LLM 就緒: {model} (本地 GGUF 已卸載，釋放 VRAM)")
            return _llm
        except Exception as e:
            log.warning(f"Ollama 連線失敗，回退本地 GGUF: {e}")

    try:
        from llama_cpp import Llama
        model_path = os.getenv("ELSA_GGUF_PATH", "/media/ollama/n1/models/elsa-consciousness.gguf")
        if not os.path.exists(model_path):
            log.warning(f"模型不存在: {model_path}")
            return None
        _llm = Llama(
            model_path=model_path,
            n_ctx=2048,
            n_gpu_layers=-1,
            verbose=False,
        )
        log.info("✅ LLM 載入成功")
        return _llm
    except Exception as e:
        log.warning(f"LLM 載入失敗（用規則引擎）: {e}")
        return None

def predict_price_direction(llm, exchange, symbol, analysis_data, balance, existing_positions):
    """大腦預測 — 綜合所有情報判斷漲跌"""
    if symbol in existing_positions:
        pos = existing_positions[symbol]
        return {
            "direction": "HOLD",
            "confidence": 0,
            "reason": f"已有 {pos['side']} 持倉",
            "action": "HOLD",
        }

    # 收集全方位情報
    intel = gather_market_intelligence(exchange, symbol, analysis_data)

    # 組合 prompt
    prompt = build_brain_prompt(symbol, analysis_data, balance, intel)

    try:
        resp = llm(
            prompt,
            max_tokens=500,
            temperature=0.2,
            stop=["\n\n\n", "```"],
        )
        text = resp["choices"][0]["text"].strip()
        log.info(f"🧠 predict LLM 回應: {text[:200]}")

        # 提取 JSON
        json_match = re.search(r'\{[^}]+\}', text, re.DOTALL)
        if json_match:
            prediction = json.loads(json_match.group())
        else:
            prediction = json.loads(text)

        direction = prediction.get("direction", "SIDEWAYS")
        confidence = float(prediction.get("confidence", 0))
        action = prediction.get("action", "HOLD")
        leverage = int(prediction.get("leverage", 10))
        leverage = FIXED_LEVERAGE  # 鎖定10倍
        sl_pct = float(prediction.get("stop_loss_pct", 3))
        tp_pct = float(prediction.get("take_profit_pct", 6))
        reason = prediction.get("reason", "無理由")
        key_factors = prediction.get("key_factors", [])

        log.info(f"🧠 大腦預測: {direction} 信心={confidence:.0%} 行動={action}")
        log.info(f"   理由: {reason}")
        if key_factors:
            log.info(f"   關鍵因素: {', '.join(key_factors)}")

        # 信心度太低不動
        if confidence < 0.55:
            return {
                "direction": direction,
                "confidence": confidence,
                "reason": f"信心度不足 {confidence:.0%} — {reason}",
                "action": "HOLD",
            }

        # 限制槓桿範圍
        leverage = max(MIN_LEVERAGE, min(MAX_LEVERAGE, leverage))

        return {
            "direction": direction,
            "confidence": confidence,
            "reason": reason,
            "action": action,
            "leverage": leverage,
            "stop_loss_pct": sl_pct,
            "take_profit_pct": tp_pct,
            "key_factors": key_factors,
        }

    except Exception as e:
        log.warning(f"🧠 LLM 預測失敗: {e}")
        # Fallback: 用情報 + 規則引擎
        ss = intel.get("signal_summary", {})
        bull = ss.get("bull_signals", 0)
        bear = ss.get("bear_signals", 0)
        score = analysis_data.get("score", 0)

        combined = score + (bull - bear) * 15

        if combined > 25:
            return {
                "direction": "UP", "confidence": min(abs(combined)/80, 0.75),
                "reason": f"規則引擎: 技術 {score:.0f} + 情報 多{bull}/空{bear}",
                "action": "LONG", "leverage": 10, "stop_loss_pct": 3, "take_profit_pct": 6,
            }
        elif combined < -25:
            return {
                "direction": "DOWN", "confidence": min(abs(combined)/80, 0.75),
                "reason": f"規則引擎: 技術 {score:.0f} + 情報 多{bull}/空{bear}",
                "action": "SHORT", "leverage": 10, "stop_loss_pct": 3, "take_profit_pct": 6,
            }
        return {
            "direction": "SIDEWAYS", "confidence": 0,
            "reason": f"信號混合: 技術 {score:.0f} + 情報 多{bull}/空{bear}",
            "action": "HOLD",
        }



def brain_decide(analysis, balance, existing_positions, exchange=None):
    """大腦決策 — 先查實際狀態，再預測漲跌，再決定行動"""
    llm = init_llm()

    # 多持倉模式：跳過已持倉的幣，選下一個最高分
    held_symbols = set(existing_positions.keys()) if existing_positions else set()
    top = None
    for _cand in analysis:
        if _cand["symbol"] not in held_symbols:
            top = _cand
            break
    if top is None:
        return {"action": "HOLD", "reason": "所有候選幣都已持倉", "confidence": 0}
    if not top or abs(top["score"]) < 15:
        return {"action": "HOLD", "reason": "score below 15", "confidence": 0}

    # === 1212 硬觸發：策略共振 + ADX 趨勢強度 ===
    try:
        _cf = strategy_confluence(top["symbol"])
        if _cf is None:
            return {"action": "HOLD", "reason": "策略組合分析失敗", "confidence": 0}
        _longs, _shorts = _cf["longs"], _cf["shorts"]
        _adx = _cf.get("adx", 0)
        _min_votes = 4  # 至少 4/6 同向
        _min_adx = 25   # Scalper's Volatility Filter 的 ADX Baseline

        if _adx < _min_adx:
            log.info(f"⏸ ADX={_adx:.0f} < {_min_adx}，趨勢不夠強，不進場")
            return {"action": "HOLD", "reason": f"ADX {_adx:.0f} < {_min_adx}，無趨勢", "confidence": 0}

        if _longs < _min_votes and _shorts < _min_votes:
            log.info(f"⏸ 共振不足: {_longs}多/{_shorts}空 (需≥{_min_votes})，不進場")
            return {"action": "HOLD", "reason": f"共振不足 {_longs}L/{_shorts}S", "confidence": 0}

        _hard_dir = "LONG" if _longs >= _min_votes else "SHORT"
        log.info(f"🎯 1212 硬觸發: {_hard_dir} 共振={_longs}L/{_shorts}S ADX={_adx:.0f}")
        return {"action": _hard_dir, "reason": f"1212硬觸發 共振{_longs}L/{_shorts}S ADX{_adx:.0f}", "confidence": 0.85, "symbol": top["symbol"], "score": top["score"]}
    except Exception as _e:
        log.warning(f"硬觸發檢查失敗: {_e}，繼續走 LLM 流程")

    # 有持倉就不開新倉
    # 多持倉模式：持倉數未滿才開新倉
    if existing_positions and len(existing_positions) >= MAX_POSITIONS:
        log.info(f"⏸ 已達最大持倉數 {len(existing_positions)}/{MAX_POSITIONS}，不開新倉")
        return {"action": "HOLD", "reason": f"已達最大持倉 {len(existing_positions)}/{MAX_POSITIONS}", "confidence": 0}

    # === 進場前先查實際可用餘額 ===
    MIN_TRADE_BALANCE = 5.0  # 低於 5 USDT 不開新倉
    if exchange:
        actual_free = get_free_balance(exchange)
        actual_total = get_total_balance(exchange)
        log.info(f"💰 進場前檢查: 可用={actual_free:.2f} 總={actual_total:.2f}")
    else:
        actual_free = balance
        actual_total = balance

    if actual_free < MIN_TRADE_BALANCE:
        log.info(f"⏸ 可用餘額 {actual_free:.2f} < {MIN_TRADE_BALANCE} USDT，不開新倉")
        return {"action": "HOLD", "reason": f"可用餘額不足 ({actual_free:.2f} < {MIN_TRADE_BALANCE})", "confidence": 0}

    symbol = top["symbol"]

    # 讓大腦預測方向
    prediction = predict_price_direction(llm, exchange, symbol, top, balance, existing_positions)

    if prediction["action"] == "HOLD":
        return {"action": "HOLD", "reason": prediction["reason"], "confidence": prediction.get("confidence", 0)}

    # 根據預測計算交易參數
    action = prediction["action"]
    confidence = prediction["confidence"]
    leverage = prediction.get("leverage", 10)
    leverage = FIXED_LEVERAGE  # 鎖定10倍

    price = top["data"].get("1h", {}).get("price", 0)
    atr = top["data"].get("1h", {}).get("atr", 0)

    if price <= 0:
        return {"action": "HOLD", "reason": "價格數據異常", "confidence": 0}

    # === ATR 動態止損 ===
    # ATR 為 0 時 fallback 到 2% 固定
    if atr and atr > 0:
        sl_distance = max(atr * 1.5, price * 0.01)  # 至少 1% 或 1.5×ATR
    else:
        sl_distance = price * 0.02

    # === R:R 強制最小 1.5:1 ===
    rr_ratio = max(prediction.get("rr_ratio", 0), 1.5)
    tp_distance = sl_distance * rr_ratio

    sl_pct = sl_distance / price
    tp_pct = tp_distance / price

    # === 風險百分比倉位 ===
    # 每筆交易最多虧餘額的 3%
    RISK_PER_TRADE = 0.08
    free_balance = get_free_balance(exchange) if exchange else balance
    if free_balance <= 0:
        free_balance = balance
    log.info(f"💰 可用餘額: {free_balance:.2f} / 總餘額: {balance:.2f}")

    # 計算倉位：風險金額 = free_balance × 3%，倉位 = 風險金額 / sl_distance
    risk_amount = free_balance * RISK_PER_TRADE
    # 名義價值 = 風險金額 / sl_pct（因為虧 sl_pct 就虧 risk_amount）
    position_value = risk_amount / sl_pct
    # 限制最大倉位不超過餘額 × MAX_POSITION_RATIO × 槓桿
    max_position_value = free_balance * MAX_POSITION_RATIO * leverage
    position_value = min(position_value, max_position_value)
    size = position_value / price

    if size <= 0:
        return {"action": "HOLD", "reason": "可用餘額不足", "confidence": 0}

    # 止損止盈
    if action == "LONG":
        stop_loss = price - sl_distance
        take_profit = price + tp_distance
    else:
        stop_loss = price + sl_distance
        take_profit = price - tp_distance

    log.info(f"📐 ATR止損: {sl_distance:.6f} ({sl_pct*100:.2f}%) | 止盈: {tp_distance:.6f} ({tp_pct*100:.2f}%) | R:R=1:{rr_ratio}")
    log.info(f"💰 風險金額: {risk_amount:.2f} USDT ({RISK_PER_TRADE*100:.0f}% of {free_balance:.2f})")

    decision = {
        "action": action,
        "symbol": symbol,
        "size": round(size, 4),
        "leverage": leverage,
        "entry_price": price,
        "stop_loss": round(stop_loss, 6),
        "take_profit": round(take_profit, 6),
        "confidence": round(confidence, 2),
        "score": round(top["score"], 2),
        "atr": atr,
        "reason": prediction["reason"],
        "direction": prediction["direction"],
        "indicators_active": top.get("indicators_active", []),
    }

    log.info(f"🧠 最終決策: {action} {symbol} {leverage}x 信心={confidence:.0%}")
    log.info(f"   止損={stop_loss:.6f} 止盈={take_profit:.6f}")
    log.info(f"   理由: {prediction['reason']}")

    return decision


# ============================================================
#  執行交易
# ============================================================
def execute_trade(exchange, decision):
    """執行交易下單"""
    try:
        symbol = decision["symbol"]
        action = decision["action"]
        size = decision["size"]
        leverage = decision["leverage"]

        # 設定槓桿和保證金模式
        try:
            exchange.set_margin_mode("isolated", symbol)
        except:
            pass
        _actual_leverage = leverage
        try:
            exchange.set_leverage(leverage, symbol)
        except Exception as e:
            err_str = str(e)
            if "40797" in err_str or "Exceeded the maximum" in err_str or "maximum settable leverage" in err_str:
                log.warning(f"⚠️ {symbol} 槓桿 {leverage}x 超限，嘗試回退...")
                # 嘗試獲取市場資訊
                try:
                    market = exchange.market(symbol)
                    max_lev = market.get("limits", {}).get("leverage", {}).get("max")
                    if max_lev and float(max_lev) > 0:
                        _actual_leverage = int(float(max_lev))
                        exchange.set_leverage(_actual_leverage, symbol)
                        log.info(f"✅ {symbol} 槓桿回退至 {_actual_leverage}x")
                    else:
                        raise ValueError("無法取得最大槓桿")
                except Exception as e2:
                    # 逐步降槓桿重試
                    for fallback in [5, 3, 1]:
                        try:
                            exchange.set_leverage(fallback, symbol)
                            _actual_leverage = fallback
                            log.info(f"✅ {symbol} 槓桿回退至 {fallback}x")
                            break
                        except:
                            continue
                    else:
                        log.error(f"❌ {symbol} 無法設定任何槓桿，跳過下單")
                        return False
            else:
                pass

        if action == "LONG":
            order = exchange.create_order(symbol, "market", "buy", size, None, {})
            side = "long"
        elif action == "SHORT":
            order = exchange.create_order(symbol, "market", "sell", size, None, {})
            side = "short"
        else:
            return {"success": False, "error": "HOLD 不下單"}

        # 設定止損止盈
        try:
            if decision.get("stop_loss"):
                exchange.create_order(symbol, "market", "sell" if side == "long" else "buy",
                                      size, decision["stop_loss"], {"reduceOnly": True})
        except:
            pass

        # 記錄
        trade_record = {
            "time": datetime.now(timezone.utc).isoformat(),
            "symbol": symbol,
            "side": side,
            "size": size,
            "leverage": leverage,
            "entry_price": decision.get("entry_price"),
            "stop_loss": decision.get("stop_loss"),
            "take_profit": decision.get("take_profit"),
            "confidence": decision.get("confidence"),
            "order_id": order.get("id"),
        }
        trade_record["pnl"] = 0  # 開倉時 pnl=0，平倉時更新
        trade_record["indicators_active"] = decision.get("indicators_active", [])
        _trade_state["trade_history"].append(trade_record)
        _trade_state["open_positions"][symbol] = {
            "side": side,
            "size": size,
            "entry_price": decision.get("entry_price"),
            "stop_loss": decision.get("stop_loss"),
            "take_profit": decision.get("take_profit"),
            "leverage": leverage,
            "open_time": time.time(),
            "indicators_active": decision.get("indicators_active", []),
        }

        msg = f"🟢 ELSA 開倉\n幣種: {symbol}\n方向: {side.upper()}\n槓桿: {leverage}x\n數量: {size}\n入場: {decision.get('entry_price')}\n止損: {decision.get('stop_loss')}\n止盈: {decision.get('take_profit')}\n信心度: {decision.get('confidence')}"
        send_telegram(msg)
        log.info(f"✅ 開倉成功: {symbol} {side} {size} @ {leverage}x")
        return {"success": True, "order": order, "trade": trade_record}

    except Exception as e:
        log.error(f"❌ 下單失敗: {e}")
        send_telegram(f"🔴 ELSA 下單失敗\n{symbol} {action}\n錯誤: {e}")
        return {"success": False, "error": str(e)}

# ============================================================
#  持倉監控
# ============================================================
def monitor_positions(exchange):
    """監控現有持倉，檢查止損止盈"""
    try:
        positions = exchange.fetch_positions()
        active = {}
        _pos_size = 0.0  # 防御性初始化，避免 UnboundLocalError
        for pos in positions:
            symbol = pos["symbol"]
            _pos_size = get_pos_size(pos, exchange, symbol)
            if _pos_size > 0:
                unrealized = float(pos.get("unrealizedPnl", 0))
                entry = float(pos.get("entryPrice", 0))
                mark = float(pos.get("markPrice", 0))
                side = pos.get("side", "")
                margin_ratio = float(pos.get("marginRatio", 0))

                active[symbol] = {
                    "side": side,
                    "size": _pos_size,
                    "entry_price": entry,
                    "mark_price": mark,
                    "unrealized_pnl": unrealized,
                    "margin_ratio": margin_ratio,
                    "leverage": float(pos.get("leverage", 10)),
                    "liquidation_price": float(pos.get("liquidationPrice", 0)),
                }

                # 自主持倉管理 — 不警告，直接行動
                pnl_pct = (unrealized / abs(entry * _pos_size)) * 100 if entry > 0 and _pos_size > 0 else 0

                # 更新策略權重（平倉時）
                if abs(unrealized) > 0.01 and symbol in _trade_state.get("open_positions", {}):
                    pos_info = _trade_state["open_positions"].get(symbol, {})
                    indicators = pos_info.get("indicators_active", [])
                    won = unrealized > 0
                    if indicators:
                        update_strategy_weights(indicators, won)
                        log.info(f"📊 策略學習: {'贏' if won else '輸'} -> {indicators}")

                # 盈利超過 15% → 移動止損到入場價（保本）
                if unrealized > 0 and pnl_pct > 15 and not pos.get("stop_moved"):
                    try:
                        # 取消舊止損
                        if pos.get("stopLossId"):
                            exchange.cancel_order(pos["stopLossId"], symbol)
                        # 設新止損到入場價 + 1%
                        new_sl = entry * (1.01 if side == "long" else 0.99)
                        sl_side = "sell" if side == "long" else "buy"
                        exchange.create_order(symbol, "market", sl_side,
                                              safe_close_amount(exchange, symbol, _pos_size), new_sl,
                                              {"reduceOnly": True})
                        log.info(f"🔒 {symbol} 止損移至保本 {new_sl}")
                    except Exception as e:
                        log.info(f"ℹ️ 移動止損: {symbol} 持倉已不存在") if "22002" in str(e) else log.warning(f"移動止損失敗: {e}")

                # 盈利超過 30% → 平倉鎖利
                if unrealized > 0 and pnl_pct > 10:
                    try:
                        # 先確認持倉還在
                        _check = get_pos_size(pos, exchange, symbol)
                        if _check <= 0:
                            log.info(f"ℹ️ {symbol} 持倉已平，跳過鎖利")
                        else:
                            close_side = "sell" if side == "long" else "buy"
                            _safe_market_order(exchange, symbol, close_side,
                                                      safe_close_amount(exchange, symbol, _check),
                                                      {"reduceOnly": True})
                            _trade_state["daily_pnl"] += unrealized
                            _trade_state["consecutive_losses"] = 0
                            # 更新歷史記錄 pnl
                            for t in reversed(_trade_state["trade_history"]):
                                if t.get("symbol") == symbol and t.get("pnl", 0) == 0:
                                    t["pnl"] = unrealized
                                    break
                            log.info(f"💰 {symbol} 鎖利平倉 +{unrealized:.4f} USDT ({pnl_pct:.1f}%)")
                            send_telegram(f"💰 ELSA 自主鎖利\n{symbol} {side}\n盈虧: +{unrealized:.4f} USDT\n報酬率: {pnl_pct:.1f}%")
                    except Exception as e:
                        log.info(f"ℹ️ 鎖利: {symbol} 持倉已不存在") if "22002" in str(e) else log.warning(f"鎖利平倉失敗: {e}")

                # 保證金率 > 70% 且虧損 → 自主止損出場
                if margin_ratio > 0.7 and unrealized < 0:
                    try:
                        close_side = "sell" if side == "long" else "buy"
                        _safe_market_order(exchange, symbol, close_side,
                                                      safe_close_amount(exchange, symbol, _pos_size),
                                                      {"reduceOnly": True})
                        _trade_state["daily_loss"] += abs(unrealized)
                        _trade_state["consecutive_losses"] += 1
                        # 更新歷史記錄 pnl
                        for t in reversed(_trade_state["trade_history"]):
                            if t.get("symbol") == symbol and t.get("pnl", 0) == 0:
                                t["pnl"] = unrealized
                                break
                        log.info(f"🛑 {symbol} 危險平倉 {unrealized:.4f} USDT (保證金率 {margin_ratio*100:.0f}%)")
                        send_telegram(f"🛑 ELSA 自主止損\n{symbol} {side}\n盈虧: {unrealized:.4f} USDT\n原因: 保證金率 {margin_ratio*100:.0f}%")
                    except Exception as e:
                        log.info(f"ℹ️ 危險平倉: {symbol} 持倉已不存在") if "22002" in str(e) else log.warning(f"危險平倉失敗: {e}")

                # 保證金率 > 50% 只記 log 不發 Telegram
                elif margin_ratio > 0.5:
                    log.warning(f"⚠️ {symbol} 保證金率 {margin_ratio*100:.1f}% 盈虧 {unrealized:+.4f}")

        _trade_state["open_positions"] = active
        _trade_state["position_count"] = len(active)

        # 寫狀態到檔案讓 native_server 讀
        try:
            import json as _json
            state_snapshot = {
                "active": _trade_state["active"],
                "daily_pnl": _trade_state["daily_pnl"],
                "daily_loss": _trade_state["daily_loss"],
                "consecutive_losses": _trade_state["consecutive_losses"],
                "position_count": len(active),
                "trade_history_count": len(_trade_state["trade_history"]),
                "last_scan": _trade_state["last_scan"],
                "open_positions": {k: {
                    "side": v["side"],
                    "entry_price": v["entry_price"],
                    "mark_price": v["mark_price"],
                    "unrealized_pnl": v["unrealized_pnl"],
                    "margin_ratio": v["margin_ratio"],
                    "leverage": v["leverage"],
                } for k, v in active.items()},
                "pause_until": _trade_state["pause_until"],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            with open("/media/ollama/n1/brain/trade_state.json", "w") as sf:
                _json.dump(state_snapshot, sf, indent=2)
        except Exception as e:
            log.warning(f"寫狀態檔失敗: {e}")

        return active
    except Exception as e:
        import traceback as _tb
        log.warning(f"持倉監控失敗: {e}")
        log.debug(f"持倉監控堆疊: {_tb.format_exc()}")
        return {}

# ============================================================
#  日重置
# ============================================================
def check_daily_reset():
    now = time.time()
    if now - _trade_state["daily_reset_time"] > 86400:  # 24h
        _trade_state["daily_pnl"] = 0.0
        _trade_state["daily_loss"] = 0.0
        _trade_state["consecutive_losses"] = 0
        _trade_state["daily_reset_time"] = now
        log.info("📅 日統計已重置")



# ============================================================
#  學習引擎 — 從交易歷史優化參數
# ============================================================
def learning_engine():
    """分析歷史交易，動態調整策略參數"""
    history = _trade_state["trade_history"]
    if len(history) < 5:
        return  # 交易太少不學

    # 只看最近 20 筆
    recent = history[-20:]

    # 統計勝率
    wins = [t for t in recent if t.get("pnl", 0) > 0]
    losses = [t for t in recent if t.get("pnl", 0) < 0]
    win_rate = len(wins) / len(recent) if recent else 0

    # 統計各幣種表現
    symbol_stats = {}
    for t in recent:
        sym = t.get("symbol", "")
        if sym not in symbol_stats:
            symbol_stats[sym] = {"wins": 0, "losses": 0, "total_pnl": 0}
        if t.get("pnl", 0) > 0:
            symbol_stats[sym]["wins"] += 1
        else:
            symbol_stats[sym]["losses"] += 1
        symbol_stats[sym]["total_pnl"] += t.get("pnl", 0)

    # 學習：勝率低的幣種降權重，勝率高的加權重
    global CANDIDATE_SYMBOLS
    adjusted = []
    for sym in CANDIDATE_SYMBOLS:
        stats = symbol_stats.get(sym)
        if stats:
            win_r = stats["wins"] / (stats["wins"] + stats["losses"]) if (stats["wins"] + stats["losses"]) > 0 else 0.5
            # 勝率 < 30% 且交易 > 3 次 → 移除
            if win_r < 0.3 and (stats["wins"] + stats["losses"]) >= 3:
                log.info(f"📚 學習: 移除低勝率幣種 {sym} (勝率 {win_r*100:.0f}%)")
                continue
        adjusted.append(sym)

    # 加入表現好的新幣種（如果不在列表中）
    for sym, stats in symbol_stats.items():
        if sym not in adjusted and stats["total_pnl"] > 0 and stats["wins"] >= 2:
            adjusted.append(sym)
            log.info(f"📚 學習: 加入高勝率幣種 {sym}")

    if len(adjusted) > 0:
        CANDIDATE_SYMBOLS = adjusted

    # 動態調整信心度門檻
    global MIN_CONFIDENCE
    if win_rate > 0.6:
        MIN_CONFIDENCE = max(0.5, MIN_CONFIDENCE - 0.05)  # 放寬
        log.info(f"📚 學習: 勝率 {win_rate*100:.0f}% 高，放寬信心門檻至 {MIN_CONFIDENCE}")
    elif win_rate < 0.3:
        MIN_CONFIDENCE = min(0.8, MIN_CONFIDENCE + 0.05)  # 收緊
        log.info(f"📚 學習: 勝率 {win_rate*100:.0f}% 低，收緊信心門檻至 {MIN_CONFIDENCE}")

    # 計算 profit factor (總盈利 / 總虧損)
    gross_profit = sum(t.get("pnl", 0) for t in recent if t.get("pnl", 0) > 0)
    gross_loss = abs(sum(t.get("pnl", 0) for t in recent if t.get("pnl", 0) < 0))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf') if gross_profit > 0 else 0

    # 根據 profit factor 調整倉位比例
    global MAX_POSITION_RATIO
    if profit_factor > 2.0 and win_rate > 0.5:
        MAX_POSITION_RATIO = min(0.30, MAX_POSITION_RATIO + 0.02)
        log.info(f"📚 學習: PF={profit_factor:.2f} 優秀，加倉位比例至 {MAX_POSITION_RATIO}")
    elif profit_factor < 1.0:
        MAX_POSITION_RATIO = max(0.10, MAX_POSITION_RATIO - 0.02)
        log.info(f"📚 學習: PF={profit_factor:.2f} 不佳，減倉位比例至 {MAX_POSITION_RATIO}")

    # 記錄學習結果
    log.info(f"📚 學習報告: 勝率 {win_rate*100:.0f}% | PF={profit_factor:.2f} | 候選 {len(CANDIDATE_SYMBOLS)} | 信心 {MIN_CONFIDENCE} | 倉位比 {MAX_POSITION_RATIO}")


# ============================================================
#  風控檢查
# ============================================================
def risk_check(balance):
    """交易前風控檢查"""
    now = time.time()

    # 連虧暫停
    if _trade_state["pause_until"] > now:
        remaining = (_trade_state["pause_until"] - now) / 60
        return False, f"連虧暫停中，剩 {remaining:.0f} 分鐘"

    # 日虧損限制
    if balance > 0 and _trade_state["daily_loss"] > balance * MAX_DAILY_LOSS_PCT:
        _trade_state["pause_until"] = now + LOSS_PAUSE_MINUTES * 60
        send_telegram(f"🔴 日虧損達上限 {_trade_state['daily_loss']:.2f} USDT，暫停交易 1 小時")
        return False, "日虧損達上限，暫停"

    return True, "OK"

# ============================================================
#  主循環
# ============================================================
# ============================================================
#  持倉大腦分析 — 有持倉時也讓大腦判斷該抱/該跑/該加
# ============================================================

def brain_manage_position(exchange, existing, balance):
    """有持倉時，大腦收集全方位情報判斷該繼續抱、平倉、還是加倉"""
    if not existing:
        return None

    pos_symbol = list(existing.keys())[0]
    pos_info = existing[pos_symbol]
    pos_side = pos_info["side"]
    entry_price = pos_info["entry_price"]
    # === 狀態持久化：還原原始入場價 ===
    try:
        _saved = load_position_state()
        if _saved and _saved.get("symbol") == pos_symbol:
            sync_entry_price(pos_info, _saved)
            entry_price = pos_info["entry_price"]
            log.info(f"📌 入場價已從持久化還原: {entry_price}")
    except Exception as _e:
        log.warning(f"sync_entry_price 失敗: {_e}")
    mark_price = pos_info["mark_price"]
    unrealized = pos_info["unrealized_pnl"]
    margin_ratio = pos_info["margin_ratio"]
    leverage = pos_info.get("leverage", 10)
    leverage = FIXED_LEVERAGE  # 鎖定10倍

    # === 移動止損 + 部分止盈 ===
    import json as _json
    _TRAIL_FILE = "/media/ollama/n1/brain/trail_state.json"
    try:
        with open(_TRAIL_FILE) as _f:
            trail = _json.load(_f)
    except:
        trail = {}

    _trail_key = f"{pos_symbol}_{pos_side}"
    _trail_data = trail.get(_trail_key, {"best_price": entry_price, "partial_taken": False, "entry_price": entry_price})

    # 更入最佳價格
    if pos_side == "long" and mark_price > _trail_data["best_price"]:
        _trail_data["best_price"] = mark_price
    elif pos_side == "short" and mark_price < _trail_data["best_price"]:
        _trail_data["best_price"] = mark_price

    best = _trail_data["best_price"]
    entry = _trail_data["entry_price"]

    # 計算移動距離 (用 entry 時的 ATR 或固定 2%)
    _trail_dist = abs(entry - mark_price) * 0.5 or entry * 0.02

    # 移動止損觸發
    # === 1212 共振翻轉 → 直接平倉 ===
    try:
        _cf_now = strategy_confluence(pos_symbol)
        if _cf_now:
            _l, _s = _cf_now["longs"], _cf_now["shorts"]
            _min_flip = 4
            if pos_side == "long" and _s >= _min_flip:
                _should_close = True
                _close_reason = f"1212 共振翻轉: {_l}多/{_s}空 → 多單平倉"
                log.info(f"🔄 {_close_reason}")
            elif pos_side == "short" and _l >= _min_flip:
                _should_close = True
                _close_reason = f"1212 共振翻轉: {_l}多/{_s}空 → 空單平倉"
                log.info(f"🔄 {_close_reason}")
    except Exception as _e:
        log.warning(f"共振翻轉檢查失敗: {_e}")

    # === 1212 共振翻轉 → 直接平倉 ===
    try:
        _cf_now = strategy_confluence(pos_symbol)
        if _cf_now:
            _l, _s = _cf_now["longs"], _cf_now["shorts"]
            _min_flip = 4
            if pos_side == "long" and _s >= _min_flip:
                _should_close = True
                _close_reason = f"1212 共振翻轉: {_l}多/{_s}空 → 多單平倉"
                log.info(f"🔄 {_close_reason}")
            elif pos_side == "short" and _l >= _min_flip:
                _should_close = True
                _close_reason = f"1212 共振翻轉: {_l}多/{_s}空 → 空單平倉"
                log.info(f"🔄 {_close_reason}")
    except Exception as _e:
        log.warning(f"共振翻轉檢查失敗: {_e}")

    _should_close = False
    _close_reason = ""
    if pos_side == "long":
        if mark_price < best - _trail_dist and best > entry:
            _should_close = True
            _close_reason = f"移動止損觸發: best={best:.6f} now={mark_price:.6f} dist={_trail_dist:.6f}"
    else:
        if mark_price > best + _trail_dist and best < entry:
            _should_close = True
            _close_reason = f"移動止損觸發: best={best:.6f} now={mark_price:.6f} dist={_trail_dist:.6f}"

    # 部分止盈: 達到 1R (等於止損距離的利潤) 時平一半
    _sl_dist = abs(entry - _trail_data.get("sl_price", entry * 0.97))
    _profit_dist = abs(mark_price - entry)
    if not _trail_data.get("partial_taken") and _sl_dist > 0 and _profit_dist >= _sl_dist:
        try:
            _check = get_pos_size(pos_info, exchange, pos_symbol)
            if _check <= 0:
                log.info(f"ℹ️ {pos_symbol} 持倉已平，跳過部分止盈")
                _trail_data["partial_taken"] = True
            else:
                contracts = safe_close_amount(exchange, pos_symbol, _check)
                if contracts > 0:
                    half_size = safe_close_amount(exchange, pos_symbol, contracts / 2)
                    close_side = "sell" if pos_side == "long" else "buy"
                    exchange.create_order(pos_symbol, "market", close_side, half_size, None,
                        {"reduceOnly": True})
                _trail_data["partial_taken"] = True
                log.info(f"🎯 部分止盈: 平 {half_size} @ {mark_price} (1R 達成)")
                send_telegram(f"🎯 部分止盈: {pos_symbol} {pos_side}\n平一半 @ {mark_price}\n鎖定 1R 利潤")
        except Exception as _e:
            if "22002" in str(_e) or "No position to close" in str(_e):
                log.info(f"ℹ️ 部分止盈: {pos_symbol} 持倉已不存在")
                _trail_data["partial_taken"] = True
            else:
                log.warning(f"部分止盈失敗: {_e}")

    # 保存 trail 狀態
    trail[_trail_key] = _trail_data
    try:
        with open(_TRAIL_FILE, "w") as _f:
            _json.dump(trail, _f)
    except:
        pass

    # 移動止損 → 直接平倉
    if _should_close:
        try:
            contracts = safe_close_amount(exchange, pos_symbol, get_pos_size(pos_info, exchange, pos_symbol))
            if contracts > 0:
                close_side = "sell" if pos_side == "long" else "buy"
                exchange.create_order(pos_symbol, "market", close_side, contracts, None,
                    {"reduceOnly": True})
                log.info(f"🛑 {_close_reason} 平倉量={contracts}")
                send_telegram(f"🛑 移動止損平倉: {pos_symbol} {pos_side}\n{_close_reason}")
            else:
                log.warning(f"⚠️ 移動止損: {pos_symbol} 平倉量為0，跳過")
            # 清除 trail
            trail.pop(_trail_key, None)
            try:
                with open(_TRAIL_FILE, "w") as _f:
                    _json.dump(trail, _f)
            except:
                pass
            return {"action": "CLOSE", "reason": _close_reason}
        except Exception as _e:
            if "22002" in str(_e) or "No position to close" in str(_e):
                log.info(f"ℹ️ 移動止損平倉: {pos_symbol} 持倉已不存在，清除 trail")
                trail.pop(_trail_key, None)
                try:
                    with open(_TRAIL_FILE, "w") as _f:
                        import json as _json2
                        _json2.dump(trail, _f)
                except:
                    pass
            else:
                log.warning(f"移動止損平倉失敗: {_e}")

    # === 最大持倉時間檢查 ===
    _open_time = _trail_data.get("open_time", 0)
    if _open_time == 0:
        _trail_data["open_time"] = time.time()
        trail[_trail_key] = _trail_data
        try:
            with open(_TRAIL_FILE, "w") as _f:
                _json.dump(trail, _f)
        except:
            pass
    else:
        _hold_minutes = (time.time() - _open_time) / 60
        _max_hold = get_param("max_hold_minutes")
        if _hold_minutes > _max_hold:
            try:
                _raw_contracts = get_pos_size(pos_info, exchange, pos_symbol)
                contracts = safe_close_amount(exchange, pos_symbol, _raw_contracts)
                log.info(f"🔍 超時平倉 debug: raw={_raw_contracts} safe={contracts}")
                if contracts <= 0:
                    log.warning(f"⚠️ 超時平倉量為 0，跳過平倉 (raw_contracts={_raw_contracts})")
                else:
                    close_side = "sell" if pos_side == "long" else "buy"
                    exchange.create_order(pos_symbol, "market", close_side, contracts, None,
                        {"reduceOnly": True})
                log.info(f"⏰ 持倉超時 ({_hold_minutes:.0f}min > {_max_hold}min)，平倉")
                send_telegram(f"⏰ 超時平倉: {pos_symbol} 持倉 {_hold_minutes:.0f} 分鐘")
                trail.pop(_trail_key, None)
                try:
                    with open(_TRAIL_FILE, "w") as _f:
                        _json.dump(trail, _f)
                except:
                    pass
                return {"action": "CLOSE", "reason": "持倉超時"}
            except Exception as _e:
                if "22002" in str(_e) or "No position to close" in str(_e):
                    log.info(f"ℹ️ 超時平倉: {pos_symbol} 持倉已不存在，清除 trail")
                    trail.pop(_trail_key, None)
                    try:
                        with open(_TRAIL_FILE, "w") as _f:
                            _json.dump(trail, _f)
                    except:
                        pass
                else:
                    log.warning(f"超時平倉失敗: {_e}")

    # 計算盈虧百分比 — 用保證金當基準
    contracts = get_pos_size(pos_info, exchange, pos_symbol)
    try:
        contracts = float(contracts) if contracts else 0
    except:
        contracts = 0
    
    # 方法1: 用入場價 * 合約數 = 名義價值
    if contracts > 0 and entry_price > 0:
        notional = entry_price * contracts
        margin = notional / leverage if leverage > 0 else notional
        pnl_pct = (unrealized / margin) * 100 if margin > 0 else 0
    else:
        # 方法2: 用 mark_price vs entry_price 算價格變動 %
        if entry_price > 0:
            price_change = (mark_price - entry_price) / entry_price
            if pos_side == "long":
                pnl_pct = price_change * 100 * leverage
            else:
                pnl_pct = -price_change * 100 * leverage
        else:
            pnl_pct = 0

    log.info(f"📐 持倉: {pos_symbol} {pos_side} 入場={entry_price} 現價={mark_price} 盈虧={unrealized:+.4f} ({pnl_pct:+.1f}%) 保證金率={margin_ratio*100:.1f}%")
    # === 狀態持久化：保存持倉資訊 ===
    try:
        save_position_state({
            "symbol": pos_symbol,
            "side": pos_side,
            "entry_price": entry_price,
            "mark_price": mark_price,
            "unrealized_pnl": unrealized,
            "margin_ratio": margin_ratio,
            "leverage": leverage,
            "pnl_pct": pnl_pct,
            "timestamp": time.time()
        })
    except Exception as _e:
        log.warning(f"save_position_state 失敗: {_e}")

    # 收集技術指標 — 用 analyze_symbol 一次拿所有時間框架
    pos_analysis = {"symbol": pos_symbol, "score": 0, "signal": "EXISTING", "data": {}}
    try:
        analysis = analyze_symbol(exchange, pos_symbol)
        if analysis and analysis.get("signal") != "ERROR":
            pos_analysis["score"] = analysis.get("score", 0)
            pos_analysis["signal"] = analysis.get("signal", "EXISTING")
            # analyze_symbol 返回的 data 結構裡有多時間框架
            if "data" in analysis:
                pos_analysis["data"] = analysis["data"]
            else:
                # 如果沒有 data 結構，把整個 analysis 當 1h 數據
                pos_analysis["data"]["1h"] = analysis
    except Exception as e:
        log.warning(f"持倉技術分析失敗: {e}")

    # 收集全方位情報
    intel = gather_market_intelligence(exchange, pos_symbol, pos_analysis)

    # 組情報文字
    intel_lines = []
    if intel.get("fear_greed"):
        fg = intel["fear_greed"]
        intel_lines.append(f"恐懼貪婪: {fg['value']} ({fg['classification']}) - {fg['bias']}")
    if intel.get("funding"):
        intel_lines.append(f"資金費率: {intel['funding']['bias']}")
    if intel.get("order_book"):
        intel_lines.append(f"訂單簿: {intel['order_book']['pressure']}")
    if intel.get("trade_flow"):
        intel_lines.append(f"近期成交: {intel['trade_flow']['flow']}")
    if intel.get("news"):
        intel_lines.append(f"新聞: {intel['news']['sentiment']}")
        for h in intel["news"].get("headlines", [])[:3]:
            intel_lines.append(f"  - {h}")
    if intel.get("whale"):
        intel_lines.append(f"鯨魚: {intel['whale']['bias']}")
    intel_text = "\n".join(intel_lines) if intel_lines else "無情報"

    # 組技術文字
    tf_lines = []
    for tf in ["15m", "1h", "4h"]:
        d = pos_analysis.get("data", {}).get(tf, {})
        if d:
            tf_lines.append(f"  {tf}: 價格={d.get('price')} RSI={d.get('rsi')} EMA9={d.get('ema9')} EMA21={d.get('ema21')} EMA50={d.get('ema50')} MACD柱={d.get('macd_hist')} 量比={d.get('vol_ratio')}")
    tech_text = "\n".join(tf_lines) if tf_lines else "無技術數據"

    ss = intel.get("signal_summary", {})
    bull = ss.get("bull_signals", 0)
    bear = ss.get("bear_signals", 0)

    # 大腦 prompt
    prompt = f"""system
你是 ELSA，專業加密貨幣交易 AI。你現在有一個持倉，需要判斷該繼續持有、加倉、還是平倉。
綜合所有情報做出最有利潤的決策。回覆必須是 JSON 格式。
user
## 現有持倉分析

持倉: {pos_symbol} {pos_side}
入場價: {entry_price}
現價: {mark_price}
未實現盈虧: {unrealized:+.4f} USDT ({pnl_pct:+.1f}%)
保證金率: {margin_ratio*100:.1f}%
槓桿: {leverage}x

### 技術指標
{tech_text}

### 市場情報
{intel_text}

### 情報摘要
多頭信號: {bull} | 空頭信號: {bear}

### 判斷規則
1. 預測繼續往有利方向 -> HOLD（繼續抱）
2. 預測即將反轉且目前盈利 -> CLOSE（平倉鎖利）
3. 預測即將反轉且目前虧損 + 保證金率 > 60% -> CLOSE（止損）
4. 趨勢強 + 方向一致 + 目前盈利 -> ADD（加倉）
5. 保證金率 > 70% -> 建議 CLOSE 降風險

回覆 JSON:
{{"decision": "HOLD 或 CLOSE 或 ADD", "confidence": 0.0-1.0, "reason": "一句話理由"}}
assistant
"""

    try:
        llm = init_llm()
        resp = llm(prompt, max_tokens=300, temperature=0.2, stop=["\n\n\n", "```"])
        
        # 穩健地提取回應文字
        text = ""
        if isinstance(resp, dict):
            if "choices" in resp and len(resp["choices"]) > 0:
                text = resp["choices"][0].get("text", "")
            elif "content" in resp:
                text = resp["content"]
            elif "response" in resp:
                text = resp["response"]
        elif isinstance(resp, str):
            text = resp
        
        text = text.strip()
        log.info(f"🧠 LLM 原始回應: {text[:200]}")
        
        if not text:
            log.warning("🧠 LLM 無回應，用規則判斷")
            raise Exception("empty response")

        # 嘗試多種方式提取 JSON
        hold_decision = None
        
        # 方法1: 直接 parse
        try:
            hold_decision = json.loads(text)
        except:
            pass
        
        # 方法2: 找 { ... }
        if not hold_decision:
            json_match = _re_module.search(r'\{.*?\}', text, _re_module.DOTALL)
            if json_match:
                try:
                    hold_decision = json.loads(json_match.group())
                except:
                    pass
        
        # 方法3: 找 decision 關鍵字
        if not hold_decision:
            if "CLOSE" in text.upper():
                hold_decision = {"decision": "CLOSE", "confidence": 0.7, "reason": text[:100]}
            elif "ADD" in text.upper():
                hold_decision = {"decision": "ADD", "confidence": 0.7, "reason": text[:100]}
            elif "HOLD" in text.upper():
                hold_decision = {"decision": "HOLD", "confidence": 0.6, "reason": text[:100]}
        
        if not hold_decision:
            raise Exception("無法解析 LLM 回應")

        decision = hold_decision.get("decision", "HOLD").upper()
        try:
            hold_conf = float(hold_decision.get("confidence", 0))
        except:
            hold_conf = 0.5
        hold_reason = hold_decision.get("reason", "無理由")

        log.info(f"🧠 持倉決策: {decision} 信心={hold_conf:.0%}")
        log.info(f"   理由: {hold_reason}")

        # 執行決策
        if decision == "CLOSE" and hold_conf > 0.6:
            close_side = "sell" if pos_side == "long" else "buy"
            try:
                _safe_market_order(exchange, pos_symbol, close_side,
                                              contracts,
                                              {"reduceOnly": True})
                _trade_state["daily_pnl"] += unrealized
                if unrealized > 0:
                    _trade_state["consecutive_losses"] = 0
                else:
                    _trade_state["daily_loss"] += abs(unrealized)
                    _trade_state["consecutive_losses"] += 1
                log.info(f"🧠 大腦平倉 {pos_symbol} 盈虧={unrealized:+.4f} USDT")
                clear_add_tracker(pos_symbol)
                send_telegram(f"🧠 ELSA 大腦決定平倉\n{pos_symbol} {pos_side}\n盈虧: {unrealized:+.4f} USDT\n理由: {hold_reason}")
            except Exception as e:
                log.warning(f"大腦平倉失敗: {e}")

        elif decision == "ADD" and hold_conf > 0.7 and pnl_pct > 3:
            # 六關過濾 — 分清續漲 vs 反彈
            _ok, _why = should_add_position(exchange, pos_symbol, pos_side,
                                            entry_price, mark_price, contracts, pnl_pct)
            if not _ok:
                log.info(f"🛡 加倉被擋: {_why}")
                decision = "HOLD"
                hold_reason = f"加倉被擋（{_why}），維持持倉"
            else:
                try:
                    free_bal = get_free_balance(exchange)
                    log.info(f"💰 加倉前檢查: 可用={free_bal:.2f} USDT, 盈利={pnl_pct:.1f}%")
                    if free_bal < 5.0:
                        log.info(f"⏸ 可用餘額 {free_bal:.2f} < 5 USDT，加倉改 HOLD")
                        decision = "HOLD"
                        hold_reason = f"可用餘額不足 ({free_bal:.2f})，維持持倉"
                    else:
                        _layer = _add_tracker.get(pos_symbol, {"count": 0})["count"]
                        _ratio = 0.3 if _layer == 0 else 0.15
                        raw_add = (free_bal * _ratio * leverage) / mark_price
                        add_size = safe_close_amount(exchange, pos_symbol, raw_add)
                        if add_size <= 0:
                            log.warning(f"⚠️ 加倉量 {raw_add:.4f} 經精度處理後為 0，跳過")
                            decision = "HOLD"
                            hold_reason = f"加倉量太小 ({raw_add:.4f})，維持持倉"
                        else:
                            add_side = "buy" if pos_side == "long" else "sell"
                            _safe_market_order(exchange, pos_symbol, add_side, add_size, {})
                            _new_avg, _cnt = record_add(pos_symbol, entry_price, contracts, mark_price, add_size)
                            log.info(f"🧠 大腦加倉 {pos_symbol} +{add_size} 第{_cnt}層 新均價={_new_avg:.4f}")
                            # 止損上移到新均價 — 寫進 trail_state.json
                            try:
                                import json as _json
                                _tf = "/media/ollama/n1/brain/trail_state.json"
                                try:
                                    with open(_tf) as _f:
                                        _td = _json.load(_f)
                                except Exception:
                                    _td = {}
                                _tk = f"{pos_symbol}_{pos_side}"
                                if _tk in _td:
                                    _td[_tk]["entry_price"] = _new_avg
                                    with open(_tf, "w") as _f:
                                        _json.dump(_td, _f)
                                    log.info(f"🛡 trail entry 更新為新均價 {_new_avg:.4f}（保本）")
                            except Exception as _e:
                                log.warning(f"止損上移失敗: {_e}")
                            send_telegram(f"🧠 ELSA 加倉 第{_cnt}層\n{pos_symbol} +{add_size}\n新均價: {_new_avg:.4f}\n止損已上移至保本")
                except Exception as e:
                    log.warning(f"大腦加倉失敗: {e}")
        elif decision == "ADD":
            # ADD 被降級 — 記錄原因
            log.info(f"⏸ ADD 降級 HOLD: pnl_pct={pnl_pct:.1f}% (需>3%) conf={hold_conf:.2f} (需>0.7) — {hold_reason}")

        else:
            log.info(f"⏸ 繼續持有 {pos_symbol} — {hold_reason}")

    except Exception as e:
        log.warning(f"🧠 持倉大腦分析失敗: {e} — 用規則判斷")
        # Fallback 規則
        if margin_ratio > 0.7 and unrealized < 0:
            log.warning("⚠️ 保證金率危險+虧損 → 檢查是否該手動平倉")
        elif pnl_pct > 30:
            log.info(f"💰 盈利 {pnl_pct:.1f}% → 達到鎖利線，大腦離線中")
        else:
            log.info(f"⏸ 繼續持有 {pos_symbol} (規則模式)")



def trade_loop():
    """自主交易主循環"""
    log.info("🚀 ELSA 自主交易引擎啟動")
    send_telegram("🚀 ELSA 自主交易引擎已啟動\n模式: 多幣種掃描 + 多時間框架 + ATR止損")

    exchange = get_exchange()
    if not exchange:
        log.error("交易所連線失敗，退出")
        return

    _trade_state["active"] = True
    _trade_state["daily_reset_time"] = time.time()

    # 啟動時寫狀態
    try:
        import json as _json
        with open("/media/ollama/n1/brain/trade_state.json", "w") as sf:
            _json.dump({"active": True, "timestamp": datetime.now(timezone.utc).isoformat()}, sf)
    except:
        pass

    cycle = 0
    while True:
        try:
            cycle += 1
            now = time.time()

            # 日重置
            check_daily_reset()

            # 持倉監控
            existing = monitor_positions(exchange)

            # 每日掃描 TOP 標的（持倉不足時才選新標的）
            _top_picks = []
            if len(existing) < MAX_POSITIONS:
                _top_picks = scan_daily_top_picks(exchange, top_n=DAILY_TOP_N)

            # 有持倉 → 大腦分析該抱/該跑/該加
            if existing:
                log.info(f"📊 持倉 {len(existing)}/{MAX_POSITIONS}: {', '.join(existing.keys())}")
                for _sym, _pos in existing.items():
                    try:
                        brain_manage_position(exchange, {_sym: _pos}, balance if 'balance' in dir() else 0)
                    except Exception as _e:
                        log.warning(f"持倉管理 {_sym} 失敗: {_e}")

            # 餘額
            balance = get_total_balance(exchange)
            _free = get_free_balance(exchange)
            log.info(f"💰 餘額: 總={balance:.2f} 可用={_free:.2f}")

            # 每 10 個 cycle 學習一次
            if cycle % 10 == 0 and cycle > 0:
                learning_engine()
                self_evolve()

            # 風控
            can_trade, reason = risk_check(balance)
            if not can_trade:
                log.info(f"⏸ {reason}")
                time.sleep(MONITOR_INTERVAL)
                continue

            # 掃描市場
            if cycle % (SCAN_INTERVAL // MONITOR_INTERVAL) == 0 or cycle == 1:
                log.info(f"📊 掃描市場 (cycle {cycle})...")
                scan_results = scan_market(exchange)
                _trade_state["last_scan"] = datetime.now(timezone.utc).isoformat()
                _trade_state["last_analysis"] = scan_results[:3]

                if scan_results:
                    top = scan_results[0]
                    log.info(f"📈 最佳信號: {top['symbol']} {top['signal']} 評分={top['score']:.1f}")

                    # 大腦決策
                    decision = brain_decide(scan_results, balance, existing)

                    if decision["action"] in ("LONG", "SHORT"):
                        log.info(f"🧠 決策: {decision['action']} {decision['symbol']} "
                                 f"信心度={decision.get('confidence', 0)}")
                        result = execute_trade(exchange, decision)
                        if not result.get("success"):
                            _trade_state["consecutive_losses"] += 1
                            _trade_state["daily_loss"] += 0  # 暫不計
                        else:
                            _trade_state["consecutive_losses"] = 0
                    else:
                        log.info(f"⏸ {decision.get('reason', 'HOLD')}")
                else:
                    log.info("📭 無可用信號")

            time.sleep(MONITOR_INTERVAL)

        except KeyboardInterrupt:
            log.info("收到中斷信號，停止交易")
            break
        except Exception as e:
            log.error(f"循環異常: {e}\n{traceback.format_exc()}")
            send_telegram(f"🔴 交易循環異常: {e}")
            time.sleep(60)

    _trade_state["active"] = False
    send_telegram("🛑 ELSA 自主交易引擎已停止")

# ============================================================
#  Trader 類（給 native_server.py 調用）
# ============================================================
class Trader:
    def __init__(self):
        self.exchange = get_exchange()

    def get_balance(self):
        if not self.exchange:
            return {"status": "error", "message": "交易所未連線"}
        try:
            bal = self.exchange.fetch_balance()
            return {
                "status": "ok",
                "total": float(bal.get("USDT", {}).get("total", 0)),
                "free": float(bal.get("USDT", {}).get("free", 0)),
                "used": float(bal.get("USDT", {}).get("used", 0)),
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def get_positions(self, symbol=None):
        if not self.exchange:
            return {"status": "error", "message": "交易所未連線"}
        try:
            positions = self.exchange.fetch_positions([symbol] if symbol else None)
            active = [p for p in positions if p.get("contracts") and float(p["contracts"]) > 0]
            return {"status": "ok", "positions": active}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def get_ticker(self, symbol="BTC/USDT:USDT"):
        if not self.exchange:
            return {"status": "error", "message": "交易所未連線"}
        try:
            return {"status": "ok", "ticker": self.exchange.fetch_ticker(symbol)}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def analyze_market(self, symbol="BTC/USDT:USDT"):
        if not self.exchange:
            return {"status": "error", "message": "交易所未連線"}
        return analyze_symbol(self.exchange, symbol)

    def auto_trade(self):
        """給 /ask [TRADE] 調用的單次交易"""
        if not self.exchange:
            return {"status": "error", "message": "交易所未連線"}
        try:
            existing = monitor_positions(self.exchange)
            bal = self.get_balance()
            balance = bal.get("total", 0)
            scan = scan_market(self.exchange)
            decision = brain_decide(scan, balance, existing)
            if decision["action"] in ("LONG", "SHORT"):
                return execute_trade(self.exchange, decision)
            return {"status": "hold", "decision": decision}
        except Exception as e:
            return {"status": "error", "message": str(e)}

def get_trader():
    return Trader()

# ============================================================
#  入口
# ============================================================

# ===== 策略組合自動接入情報層 =====
for _fn in [n for n, o in list(globals().items()) if callable(o) and "intel" in n.lower()]:
    _orig_f = globals()[_fn]
    def _mk(orig):
        def _w(symbol, *a, **kw):
            intel = orig(symbol, *a, **kw)
            try:
                _sym = symbol if isinstance(symbol, str) else None
                if _sym is None:
                    for _arg in a:
                        if isinstance(_arg, str) and "/" in _arg:
                            _sym = _arg
                            break
                if _sym is None and isinstance(intel, dict):
                    _sym = intel.get("symbol")
                if not isinstance(_sym, str) or "/" not in _sym:
                    return intel
                cf = strategy_confluence(_sym)
                if cf:
                    log.info(f"   🎯 策略組合: {cf['longs']}多/{cf['shorts']}空 評分={cf['score']:+.2f} 波動位={cf['vol_pct']:.0%} {cf['votes']}")
                    if isinstance(intel, dict):
                        intel["strategy_confluence"] = cf
            except Exception as _e:
                log.warning(f"策略組合: {_e}")
            return intel
        return _w
    globals()[_fn] = _mk(_orig_f)
    print(f"✅ 策略組合已接入 {_fn}")



# ===== 自主選幣接入 (v3 安全版) =====
if callable(globals().get("scan_market")):
    _orig_scan_market = globals()["scan_market"]
    def _scan_market_wrapped(exchange, *a, **kw):
        orig = _orig_scan_market(exchange, *a, **kw)
        try:
            ops = scan_market_opportunities()
            strong = [o for o in ops if o["direction"] != "NEUTRAL" and o["score"] >= 0.35]
            if not strong or not isinstance(orig, (list, tuple)) or not orig:
                return orig
            items = list(orig)
            boost = {o["symbol"]: o["score"] for o in strong}
            first = items[0]
            if isinstance(first, str):
                have = set(items)
                add = [s for s in boost if s not in have]
                if add:
                    log.info(f"🎯 強訊號插入候選: {add}")
                return add + items
            if isinstance(first, dict):
                items.sort(key=lambda d: -boost.get(d.get("symbol"), 0))
                log.info(f"🎯 候選按強訊號重排: {[d.get('symbol') for d in items[:5]]}")
                return items
        except Exception as e:
            log.warning(f"自主選幣合併失敗: {e}")
        return orig
    globals()["scan_market"] = _scan_market_wrapped
    print("✅ 自主選幣已接入 scan_market")

# ═══════════════════════════════════════════════════════════════
# 崩潰防護
# ═══════════════════════════════════════════════════════════════
import signal as _signal
import sys as _sys

_MAX_CRASHES = 5
_crash_count = 0
_graceful = False

def _handle_sig(signum, frame):
    global _graceful
    log.info(f"收到信號 {signum}，準備優雅關閉...")
    _graceful = True

_signal.signal(_signal.SIGINT, _handle_sig)
_signal.signal(_signal.SIGTERM, _handle_sig)

def run_with_crash_guard(main_fn):
    global _crash_count
    while not _graceful:
        try:
            main_fn()
            _crash_count = 0
        except KeyboardInterrupt:
            break
        except Exception as e:
            _crash_count += 1
            log.error(f"[CRASH] 第 {_crash_count} 次崩潰: {e}")
            if _crash_count >= _MAX_CRASHES:
                log.error(f"[FATAL] 連續崩潰 {_crash_count} 次，停止")
                try:
                    send_telegram(f"🚨 ELSA Trader 連續崩潰 {_crash_count} 次，已停止")
                except:
                    pass
                _sys.exit(1)
            import time as _t
            backoff = 10 * (2 ** _crash_count)
            log.info(f"[BACKOFF] {backoff}秒後重試...")
            _t.sleep(backoff)
    log.info("優雅關閉完成")

# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    trade_loop()
