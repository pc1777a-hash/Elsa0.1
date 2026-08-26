import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from "react-native";

import { Card, EmptyState, InlineNotice, PrimaryButton, ScreenTitle, StatusBadge, palette } from "@/components/elsa-ui";
import { ScreenContainer } from "@/components/screen-container";
import { appendActivityLog } from "@/lib/activity-log";
import { errorMessage, getExchangeBalance, getExchanges, getPerpetualBrainStatus, getSystemResources, getTradeAutoStatus, getTradePositions } from "@/lib/elsa-api";
import type { ExchangeBalance, ExchangeStatus, PerpetualBrainStatus, SystemResources, TradeAutoStatus, TradePositions } from "@/lib/elsa-types";
import { buildStrategyDraftPrompt, getCurrentStrategy } from "@/lib/trading-strategy";
import { haptic } from "@/lib/haptics";

type PositionRow = Record<string, unknown>;

export default function AssetsScreen() {
  const router = useRouter();
  const [exchanges, setExchanges] = useState<ExchangeStatus | null>(null);
  const [balance, setBalance] = useState<ExchangeBalance | null>(null);
  const [positions, setPositions] = useState<TradePositions | null>(null);
  const [autoStatus, setAutoStatus] = useState<TradeAutoStatus | null>(null);
  const [perpetualStatus, setPerpetualStatus] = useState<PerpetualBrainStatus | null>(null);
  const [systemResources, setSystemResources] = useState<SystemResources | null>(null);
  const [market, setMarket] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [objective, setObjective] = useState("");
  const [riskLimit, setRiskLimit] = useState("");
  const [taskError, setTaskError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [exchangeData, balanceData, positionData, autoStatusData, perpetualStatusData, resourceData] = await Promise.all([getExchanges(), getExchangeBalance(), getTradePositions(), getTradeAutoStatus().catch(() => null), getPerpetualBrainStatus().catch(() => null), getSystemResources().catch(() => null)]);
      setExchanges(exchangeData);
      setBalance(balanceData);
      setPositions(positionData);
      setAutoStatus(autoStatusData);
      setPerpetualStatus(perpetualStatusData);
      setSystemResources(resourceData);
      await appendActivityLog({ source: "trading", kind: "success", title: "已同步交易監控資料", detail: `交易所：${exchangeData.selected?.toUpperCase() ?? "未選擇"}；持倉：${positionData.positions.length} 筆；交易執行器：${autoStatusData ? (autoStatusData.active ? "運行中" : "已停止") : "未取得"}；永動腦：${perpetualStatusData ? (perpetualStatusData.online ? "在線" : "已停止") : "未回報"}。` });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      await appendActivityLog({ source: "trading", kind: "error", title: "交易監控資料讀取失敗", detail: message });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const selectedKey = exchanges ? Boolean(exchanges.keys[exchanges.selected]) : false;
  const currentStrategy = useMemo(() => getCurrentStrategy(exchanges, balance, positions, autoStatus), [autoStatus, balance, exchanges, positions]);
  const autonomousState = autoStatus ? autoStatus.active ? "運行中" : autoStatus.configured ? "已配置" : "未配置" : "未取得";
  const autonomousDetail = autoStatus ? `${autoStatus.paper ? "模擬" : "非模擬"}模式 · 已執行 ${autoStatus.cycles} 次循環` : "無法從服務讀取自主狀態";
  const latestSignal = autoStatus?.log[0] ?? null;
  const perpetualState = perpetualStatus ? perpetualStatus.online ? "在線" : "已停止" : "未回報";
  const perpetualDetail = perpetualStatus
    ? `${perpetualStatus.loopState ?? "未回報循環"} · 任務 ${perpetualStatus.activeTaskId ?? "無"} · 佇列 ${perpetualStatus.queueDepth ?? "—"}`
    : "尚無 N1 永動腦回報端點；策略草案不代表程式、回測或部署已執行。";
  const resourceDetail = systemResources
    ? `${systemResources.gpu ? `${systemResources.gpu.name} · 顯存 ${systemResources.gpu.memoryUsedMb}/${systemResources.gpu.memoryTotalMb} MB` : "GPU 未回報"} · 磁碟 ${systemResources.diskUsedGb.toFixed(1)}/${systemResources.diskTotalGb.toFixed(1)} GB · 已載入 ${systemResources.loadedModels.length} 個模型`
    : "N1 資源端點尚未回報。";

  const startStrategyTask = () => {
    if (!market.trim() || !timeframe.trim() || !objective.trim() || !riskLimit.trim()) {
      setTaskError("請完整填寫市場、時間週期、策略目標與風險限制，再交給艾西。 ");
      return;
    }
    setTaskError(null);
    haptic.light();
    const input = { market: market.trim(), timeframe: timeframe.trim(), objective: objective.trim(), riskLimit: riskLimit.trim() };
    router.push({ pathname: "./chat", params: { task: "strategy", ...input, draft: buildStrategyDraftPrompt(input) } });
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]} style={styles.screen}>
      <FlatList
        data={positions?.positions ?? []}
        keyExtractor={(_, index) => String(index)}
        refreshing={loading}
        onRefresh={() => void load()}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <PositionItem item={item} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenTitle title="交易監控" subtitle="服務端資料、策略狀態與艾西開發任務。" />
            {error ? <InlineNotice type="error">{error}</InlineNotice> : null}

            <Card style={styles.exchangeCard}>
              <View style={styles.exchangeTop}>
                <View>
                  <Text style={styles.eyebrow}>TRADING ACCOUNT</Text>
                  <Text style={styles.exchangeTitle}>{balance?.balance ?? "—"}</Text>
                </View>
                <StatusBadge state={selectedKey ? "connected" : "unknown"} label={selectedKey ? `${exchanges?.selected?.toUpperCase() ?? "交易所"} 已配置` : "尚未取得金鑰狀態"} />
              </View>
              <View style={styles.accountMeta}>
                <MaterialIcons name="visibility" size={15} color={palette.accent} />
                <Text style={styles.accountMetaText}>帳戶、持倉與策略欄位僅顯示服務端真實回應。</Text>
              </View>
              <PrimaryButton label="更新服務端資料" icon="refresh" loading={loading} onPress={() => { haptic.light(); void load(); }} />
            </Card>

            <Text style={styles.sectionLabel}>自主操作狀態</Text>
            <View style={styles.statusGrid}>
              <StatusTile icon="account-tree" label="目前策略" value={currentStrategy?.name ?? "服務未回傳"} detail={currentStrategy ? `來源欄位：${currentStrategy.source}` : "自主狀態路由未包含策略名稱欄位"} tone="primary" />
              <StatusTile icon="autorenew" label="自主狀態" value={autonomousState} detail={autonomousDetail} tone={autoStatus?.active ? "primary" : "muted"} />
              <StatusTile icon="assignment-late" label="待確認操作" value="服務未回傳" detail={autoStatus ? "已讀取自主狀態；回應不含確認佇列欄位" : "需先取得自主狀態後才能判定"} tone="muted" />
            </View>
            {autoStatus ? <Card style={styles.autoDetailCard}><View style={styles.autoDetailTop}><Text style={styles.autoDetailLabel}>最近自主循環回報</Text><StatusBadge state={autoStatus.ok ? "connected" : "unknown"} label={autoStatus.paper ? "模擬" : "非模擬"} /></View><Text numberOfLines={2} style={styles.autoDetailValue}>{autoStatus.last || "服務未提供最後循環摘要"}</Text>{latestSignal ? <View style={styles.signalStrip}><Text style={styles.signalName}>{latestSignal.symbol} · {latestSignal.tf}</Text><Text style={styles.signalValue}>{latestSignal.signal}</Text><Text style={styles.signalMeta}>RSI {latestSignal.rsi} · EMA20 {latestSignal.ema20} · EMA50 {latestSignal.ema50}</Text></View> : <Text style={styles.signalUnavailable}>服務未回傳可顯示的訊號紀錄。</Text>}<Text style={styles.autoDetailMeta}>服務時間：{formatServiceTime(autoStatus.timestamp)} · 服務紀錄：{autoStatus.log.length} 筆</Text></Card> : null}

            <Card style={styles.brainCard}>
              <View style={styles.brainTop}>
                <View>
                  <Text style={styles.brainEyebrow}>PERPETUAL BRAIN ≠ TRADE EXECUTOR</Text>
                  <Text style={styles.brainTitle}>永動腦與策略生命週期</Text>
                </View>
                <StatusBadge state={perpetualStatus?.online ? "connected" : "unknown"} label={perpetualState} />
              </View>
              <Text style={styles.brainCopy}>{perpetualDetail}</Text>
              <View style={styles.telemetryStrip}>
                <MaterialIcons name="developer-board" size={16} color={systemResources ? palette.accent : palette.muted} />
                <View style={styles.telemetryCopy}>
                  <Text style={styles.telemetryLabel}>N1 即時資源</Text>
                  <Text style={styles.telemetryValue}>{resourceDetail}</Text>
                </View>
              </View>
              <View style={styles.lifecycleRow}>
                <LifecycleStage label="草案" value="聊天可產生" tone="muted" />
                <LifecycleStage label="測試" value="未回報" tone="muted" />
                <LifecycleStage label="部署" value="未回報" tone="muted" />
                <LifecycleStage label="執行器" value={autonomousState} tone={autoStatus?.active ? "good" : "muted"} />
              </View>
              <Text style={styles.brainFootnote}>只有 N1 回報任務 ID、測試／Git 摘要與已部署版本後，App 才會顯示程式任務為執行中或完成。</Text>
            </Card>

            <Card style={styles.inventoryCard}>
              <View style={styles.inventoryTop}>
                <View style={styles.inventoryHeading}>
                  <View style={styles.inventoryIcon}><MaterialIcons name="manage-search" size={20} color="#E4CE94" /></View>
                  <View style={styles.inventoryCopy}>
                    <Text style={styles.inventoryTitle}>既有策略盤點</Text>
                    <Text style={styles.inventoryDetail}>辨識已部署、未接線、草稿與半完成候選。</Text>
                  </View>
                </View>
                <StatusBadge state="unknown" label="待 N1 掃描" />
              </View>
              <View style={styles.inventoryRule}>
                <MaterialIcons name="lock-outline" size={15} color="#E4CE94" />
                <Text style={styles.inventoryRuleText}>只接受 N1 唯讀報告中的檔案雜湊、部署引用與執行器證據；不讀取或顯示交易所金鑰、`.env` 或私密設定。</Text>
              </View>
              <Text style={styles.inventoryFootnote}>掃描報告尚未回傳，因此目前策略名稱與部署狀態維持未回報。完成 N1 掃描後，這裡會顯示每個策略的分類與來源時間。</Text>
            </Card>

            <Card style={styles.strategyTaskCard}>
              <View style={styles.strategyTaskHeading}>
                <View style={styles.strategyIcon}><MaterialIcons name="code" size={22} color="#C6BEFF" /></View>
                <View style={styles.strategyHeadingCopy}>
                  <Text style={styles.strategyTaskTitle}>建立艾西策略草案</Text>
                  <Text style={styles.strategyTaskDetail}>目前只送至 `/ask` 產生文字草案；尚未提交 N1 永動腦編碼、測試、Git 或部署。</Text>
                </View>
              </View>
              <TextInput value={market} onChangeText={setMarket} placeholder="市場，例如 BTCUSDT" placeholderTextColor="#7E8796" style={styles.input} autoCapitalize="characters" />
              <TextInput value={timeframe} onChangeText={setTimeframe} placeholder="時間週期，例如 15m" placeholderTextColor="#7E8796" style={styles.input} />
              <TextInput value={objective} onChangeText={setObjective} placeholder="策略目標，例如趨勢突破／均值回歸" placeholderTextColor="#7E8796" style={styles.input} />
              <TextInput value={riskLimit} onChangeText={setRiskLimit} placeholder="風險限制，例如單筆最大虧損／槓桿上限" placeholderTextColor="#7E8796" style={styles.input} />
              {taskError ? <InlineNotice type="error">{taskError}</InlineNotice> : null}
              <PrimaryButton label="建立策略草案（非執行）" icon="auto-awesome" onPress={startStrategyTask} />
            </Card>

            <Text style={styles.assetsLabel}>服務端持倉</Text>
          </View>
        }
        ListEmptyComponent={loading ? <ActivityIndicator color={palette.primary} /> : <EmptyState icon="account-balance-wallet" title="目前沒有服務端持倉" detail="持倉清單會在服務端回傳時顯示；App 不會建立或修改任何持倉。" />}
      />
    </ScreenContainer>
  );
}

function StatusTile({ icon, label, value, detail, tone }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; value: string; detail: string; tone: "primary" | "muted" }) {
  return <View style={[styles.statusTile, tone === "primary" && styles.statusTilePrimary]}><MaterialIcons name={icon} size={19} color={tone === "primary" ? "#BDAFFF" : palette.muted} /><Text numberOfLines={2} style={styles.statusValue}>{value}</Text><Text style={styles.statusLabel}>{label}</Text><Text numberOfLines={2} style={styles.statusDetail}>{detail}</Text></View>;
}

function LifecycleStage({ label, value, tone }: { label: string; value: string; tone: "good" | "muted" }) {
  return <View style={styles.lifecycleStage}><Text style={styles.lifecycleLabel}>{label}</Text><Text numberOfLines={2} style={[styles.lifecycleValue, tone === "good" && styles.lifecycleGood]}>{value}</Text></View>;
}

function PositionItem({ item }: { item: PositionRow }) {
  const symbol = String(item.symbol ?? item.pair ?? item.market ?? "持倉");
  const side = String(item.side ?? item.direction ?? "—");
  const amount = String(item.amount ?? item.size ?? item.qty ?? "—");
  return <Card style={styles.assetRow}><View style={styles.assetIcon}><Text style={styles.assetInitial}>{symbol.slice(0, 1)}</Text></View><View style={styles.assetCopy}><Text style={styles.assetName}>{symbol}</Text><Text style={styles.assetDetail}>{side.toUpperCase()} · 服務端持倉資料</Text></View><Text style={styles.assetAmount}>{amount}</Text></Card>;
}

function formatServiceTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "未知";
  return date.toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#040508" }, list: { flexGrow: 1, paddingBottom: 28, gap: 10 }, header: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  exchangeCard: { gap: 14, backgroundColor: "#112523", borderColor: "#2B6159" }, exchangeTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, eyebrow: { color: "#85E7D6", fontSize: 11, lineHeight: 16, fontWeight: "700", letterSpacing: 0.9 }, exchangeTitle: { color: palette.text, fontSize: 24, lineHeight: 30, fontWeight: "700", marginTop: 4 }, accountMeta: { flexDirection: "row", alignItems: "flex-start", gap: 7 }, accountMetaText: { flex: 1, color: "#BDEEE5", fontSize: 12, lineHeight: 18 },
  sectionLabel: { color: palette.muted, fontSize: 12, lineHeight: 18, fontWeight: "700", letterSpacing: 0.7, marginTop: 2 }, statusGrid: { flexDirection: "row", gap: 9 }, statusTile: { flex: 1, minHeight: 150, gap: 5, padding: 12, borderWidth: 1, borderRadius: 17, backgroundColor: palette.surface, borderColor: palette.border }, statusTilePrimary: { backgroundColor: "#1B1932", borderColor: "#4B4384" }, statusValue: { color: palette.text, fontSize: 14, lineHeight: 19, fontWeight: "700", marginTop: 2 }, statusLabel: { color: palette.muted, fontSize: 10, lineHeight: 14, fontWeight: "700" }, statusDetail: { color: "#909AAA", fontSize: 10, lineHeight: 14, marginTop: "auto" },
  autoDetailCard: { gap: 5, padding: 12, backgroundColor: "#101B24", borderColor: "#294860" }, autoDetailTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, autoDetailLabel: { color: "#B6D8F3", fontSize: 11, lineHeight: 16, fontWeight: "700", letterSpacing: 0.5 }, autoDetailValue: { color: palette.text, fontSize: 12, lineHeight: 18 }, autoDetailMeta: { color: palette.muted, fontSize: 10, lineHeight: 15 }, signalStrip: { marginTop: 2, padding: 9, gap: 2, borderRadius: 11, backgroundColor: "#0B141C", borderWidth: 1, borderColor: "#294860" }, signalName: { color: "#B8DAF5", fontSize: 10, lineHeight: 14, fontWeight: "700" }, signalValue: { color: palette.accent, fontSize: 14, lineHeight: 19, fontWeight: "800" }, signalMeta: { color: "#A7BAC9", fontSize: 10, lineHeight: 15 }, signalUnavailable: { color: palette.muted, fontSize: 10, lineHeight: 15 },
  brainCard: { gap: 10, backgroundColor: "#101324", borderColor: "#3B3A70" }, brainTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }, brainEyebrow: { color: "#B7B0F5", fontSize: 10, lineHeight: 14, fontWeight: "700", letterSpacing: 0.65 }, brainTitle: { color: palette.text, fontSize: 16, lineHeight: 22, fontWeight: "700", marginTop: 2 }, brainCopy: { color: "#C2C4DF", fontSize: 12, lineHeight: 18 }, brainFootnote: { color: palette.muted, fontSize: 10, lineHeight: 15 }, telemetryStrip: { flexDirection: "row", gap: 8, padding: 9, borderRadius: 11, backgroundColor: "#0C0F1D", borderWidth: 1, borderColor: "#31345E" }, telemetryCopy: { flex: 1, gap: 1 }, telemetryLabel: { color: "#AFA9E8", fontSize: 10, lineHeight: 14, fontWeight: "700" }, telemetryValue: { color: "#CACCE0", fontSize: 10, lineHeight: 15 }, lifecycleRow: { flexDirection: "row", gap: 6 }, lifecycleStage: { flex: 1, minHeight: 56, padding: 7, justifyContent: "space-between", borderRadius: 10, borderWidth: 1, borderColor: "#35375F", backgroundColor: "#0C0E1C" }, lifecycleLabel: { color: "#9399B8", fontSize: 9, lineHeight: 13, fontWeight: "700" }, lifecycleValue: { color: "#C5C6D9", fontSize: 10, lineHeight: 14, fontWeight: "700" }, lifecycleGood: { color: palette.accent },
  inventoryCard: { gap: 10, backgroundColor: "#211B10", borderColor: "#705A2B" }, inventoryTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }, inventoryHeading: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 10 }, inventoryIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#3A2F16" }, inventoryCopy: { flex: 1 }, inventoryTitle: { color: palette.text, fontSize: 16, lineHeight: 22, fontWeight: "700" }, inventoryDetail: { color: "#E2D3B1", fontSize: 11, lineHeight: 16, marginTop: 2 }, inventoryRule: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 9, borderRadius: 11, borderWidth: 1, borderColor: "#5D4B25", backgroundColor: "#181306" }, inventoryRuleText: { flex: 1, color: "#DACBA9", fontSize: 10, lineHeight: 15 }, inventoryFootnote: { color: "#AFA17D", fontSize: 10, lineHeight: 15 },
  strategyTaskCard: { gap: 10, backgroundColor: "#151329", borderColor: "#403A74" }, strategyTaskHeading: { flexDirection: "row", alignItems: "flex-start", gap: 11, marginBottom: 2 }, strategyIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#28244A" }, strategyHeadingCopy: { flex: 1 }, strategyTaskTitle: { color: palette.text, fontSize: 16, lineHeight: 22, fontWeight: "700" }, strategyTaskDetail: { color: "#B7B2DF", fontSize: 12, lineHeight: 18, marginTop: 2 }, input: { minHeight: 48, color: palette.text, fontSize: 14, lineHeight: 20, paddingHorizontal: 13, paddingVertical: 10, borderWidth: 1, borderColor: "#3A365E", backgroundColor: "#0F1020", borderRadius: 13 },
  assetsLabel: { color: palette.muted, fontSize: 12, lineHeight: 18, fontWeight: "700", letterSpacing: 0.7, marginTop: 2 }, assetRow: { marginHorizontal: 20, padding: 13, flexDirection: "row", alignItems: "center", gap: 11 }, assetIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "#252142" }, assetInitial: { color: "#C6BEFF", fontSize: 16, fontWeight: "700" }, assetCopy: { flex: 1 }, assetName: { color: palette.text, fontSize: 15, lineHeight: 21, fontWeight: "700" }, assetDetail: { color: palette.muted, fontSize: 11, lineHeight: 16, marginTop: 2 }, assetAmount: { color: palette.text, fontSize: 15, fontWeight: "700", textAlign: "right" },
});
