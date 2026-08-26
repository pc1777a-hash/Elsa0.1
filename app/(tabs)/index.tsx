import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { Card, IconButton, InlineNotice, PrimaryButton, StatusBadge, palette } from "@/components/elsa-ui";
import { ScreenContainer } from "@/components/screen-container";
import { appendActivityLog } from "@/lib/activity-log";
import { errorMessage, getExchangeBalance, getExchanges, getNativeHealth, getPerpetualBrainStatus, getServiceMemoryStats, getSystemResources, getTradeAutoStatus, listPlugins } from "@/lib/elsa-api";
import { getLatestStrategyTask, getServiceSettings, saveServiceSettings } from "@/lib/elsa-storage";
import type { ExchangeBalance, ExchangeStatus, NativeHealth, PerpetualBrainStatus, Plugin, ServiceMemoryStats, ServiceSettings, StrategyDraftTask, SystemBible, SystemResources, TradeAutoStatus } from "@/lib/elsa-types";
import { haptic } from "@/lib/haptics";
import { getSystemBible } from "@/lib/system-bible";
import { getCurrentStrategy } from "@/lib/trading-strategy";

export default function HomeScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<ServiceSettings | null>(null);
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [exchange, setExchange] = useState<ExchangeStatus | null>(null);
  const [balance, setBalance] = useState<ExchangeBalance | null>(null);
  const [nativeHealth, setNativeHealth] = useState<NativeHealth | null>(null);
  const [systemBible, setSystemBible] = useState<SystemBible | null>(null);
  const [autoStatus, setAutoStatus] = useState<TradeAutoStatus | null>(null);
  const [perpetualStatus, setPerpetualStatus] = useState<PerpetualBrainStatus | null>(null);
  const [serviceMemoryStats, setServiceMemoryStats] = useState<ServiceMemoryStats | null>(null);
  const [systemResources, setSystemResources] = useState<SystemResources | null>(null);
  const [latestStrategyTask, setLatestStrategyTask] = useState<StrategyDraftTask | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [localSettings, latestTask] = await Promise.all([getServiceSettings(), getLatestStrategyTask()]);
    setSettings(localSettings);
    setLatestStrategyTask(latestTask);
    try {
      setSystemBible(await getSystemBible());
    } catch {
      setSystemBible(null);
    }
    if (!localSettings.baseUrl) {
      setPlugins([]);
      setExchange(null);
      setBalance(null);
      setNativeHealth(null);
      setAutoStatus(null);
      setPerpetualStatus(null);
      setServiceMemoryStats(null);
      setSystemResources(null);
      return;
    }

    setRefreshing(true);
    setError(null);
    try {
      const [pluginData, exchangeData, balanceData, healthData, autoStatusData, perpetualStatusData, memoryStatsData, resourceData] = await Promise.all([listPlugins(), getExchanges(), getExchangeBalance(), getNativeHealth(), getTradeAutoStatus().catch(() => null), getPerpetualBrainStatus().catch(() => null), getServiceMemoryStats().catch(() => null), getSystemResources().catch(() => null)]);
      setPlugins(pluginData);
      setExchange(exchangeData);
      setBalance(balanceData);
      setNativeHealth(healthData);
      setAutoStatus(autoStatusData);
      setPerpetualStatus(perpetualStatusData);
      setServiceMemoryStats(memoryStatsData);
      setSystemResources(resourceData);
      const nextSettings = { ...localSettings, lastCheckedAt: new Date().toISOString(), lastStatus: "connected" as const };
      await saveServiceSettings(nextSettings);
      setSettings(nextSettings);
      await appendActivityLog({ source: "control", kind: "success", title: "控制台同步完成", detail: `健康：${healthData.status}；插件：${pluginData.length}；交易所：${exchangeData.selected?.toUpperCase() ?? "未選擇"}；交易執行器：${autoStatusData ? (autoStatusData.active ? "運行中" : "未運行") : "未取得"}；永動腦：${perpetualStatusData ? (perpetualStatusData.online ? "在線" : "已停止") : "未回報"}。` });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      const nextSettings = { ...localSettings, lastCheckedAt: new Date().toISOString(), lastStatus: "disconnected" as const };
      await saveServiceSettings(nextSettings);
      setSettings(nextSettings);
      await appendActivityLog({ source: "control", kind: "error", title: "控制台同步失敗", detail: message });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const connected = settings?.lastStatus === "connected" && nativeHealth?.status === "healthy";
  const currentStrategy = useMemo(() => getCurrentStrategy(exchange, balance, autoStatus), [autoStatus, balance, exchange]);
  const enabledPlugins = plugins.filter((plugin) => plugin.enabled).length;
  const autonomousState = autoStatus ? autoStatus.active ? "運行中" : autoStatus.configured ? "已配置" : "未配置" : "未取得";
  const perpetualState = perpetualStatus ? perpetualStatus.online ? "在線" : "已停止" : "未回報";
  const perpetualDetail = perpetualStatus
    ? `${perpetualStatus.loopState ?? "未回報循環狀態"} · 佇列 ${perpetualStatus.queueDepth ?? "—"} · 任務 ${perpetualStatus.activeTaskId ?? "無"}`
    : "桌機尚未提供可驗證的永動腦狀態端點；聊天回覆不代表正在執行。";
  const resourceDetail = systemResources
    ? `${systemResources.gpu ? `${systemResources.gpu.name} · 顯存 ${systemResources.gpu.memoryUsedMb}/${systemResources.gpu.memoryTotalMb} MB` : "GPU 未回報"} · 磁碟 ${systemResources.diskUsedGb.toFixed(1)}/${systemResources.diskTotalGb.toFixed(1)} GB · 已載入 ${systemResources.loadedModels.length} 個模型`
    : "N1 資源端點尚未回報。";

  const openMaintenanceTask = () => {
    router.push({
      pathname: "./chat",
      params: {
        draft: [
          "請建立 ELSA 三機維護與資料整理的可審閱工作計畫。",
          "先列出目前從 System Bible 與服務 API 已能驗證的節點／服務資訊；若沒有節點清單，請明確標示缺少的 inventory 端點。",
          "再提出資料分類、備份、保留／清理規則與新增、調整、停用配置的變更摘要格式。",
          "不得使用 SSH、修改 Git、重啟服務、刪除資料或覆寫設定；等待桌機端受控任務與主人明確確認。",
        ].join("\n"),
      },
    });
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { haptic.light(); void load(); }} tintColor={palette.primary} />}>
        <View style={styles.topbar}><IconButton icon="menu" label="前往設定" onPress={() => router.push("./settings")} /><View style={styles.brandPill}><View style={styles.brandGlow} /><Text style={styles.brandText}>ELSA</Text></View><IconButton icon="receipt-long" label="查看即時日誌" onPress={() => router.push("./log")} /></View>

        <View style={styles.heroFrame}>
          <Image source={require("@/assets/images/persona/elsa-portrait.webp")} style={styles.heroPortrait} contentFit="cover" transition={180} />
          <View style={styles.heroShade} />
          <View style={styles.heroCopy}><Text style={styles.heroEyebrow}>AI STRATEGIC COMPANION</Text><Text style={styles.heroTitle}>我是艾西</Text><Text style={styles.heroSubtitle}>你的 AI 戰略副官</Text><StatusBadge state={connected ? "connected" : settings?.baseUrl ? "unknown" : "disconnected"} label={connected ? "核心服務已連線" : settings?.baseUrl ? "等待服務回應" : "尚未設定服務"} /></View>
        </View>

        {error ? <InlineNotice type="error">{error}</InlineNotice> : null}

        <View style={styles.quickRow}>
          <QuickChip icon="chat-bubble-outline" label="與艾西對話" onPress={() => router.push("./chat")} />
          <QuickChip icon="travel-explore" label="研究與記憶" onPress={() => router.push("./memory")} />
          <QuickChip icon="monitor-heart" label="交易監控" onPress={() => router.push("./assets")} />
        </View>

        <Text style={styles.sectionLabel}>自主操作狀態</Text>
        <Card style={styles.operationCard}>
          <OperationRow icon="memory" label="永動腦工作者" value={perpetualState} detail={perpetualDetail} tone={perpetualStatus?.online ? "good" : "muted"} />
          <OperationRow icon="developer-board" label="N1 運算資源" value={systemResources?.gpu ? `${systemResources.gpu.memoryUsedMb}/${systemResources.gpu.memoryTotalMb} MB` : "未回報"} detail={resourceDetail} tone={systemResources ? "good" : "muted"} />
          <OperationRow icon="favorite" label="核心健康" value={nativeHealth?.status === "healthy" ? "健康" : "未取得"} detail={nativeHealth?.status === "healthy" ? "GET /health 已驗證" : "重新整理後取得最新服務狀態"} tone={nativeHealth?.status === "healthy" ? "good" : "muted"} />
          <OperationRow icon="account-tree" label="目前策略" value={currentStrategy?.name ?? "服務未回傳"} detail={currentStrategy ? `服務回傳欄位：${currentStrategy.source}` : "自主狀態與交易端點未包含策略名稱"} tone={currentStrategy ? "good" : "muted"} />
          <OperationRow icon="sync" label="自主交易" value={autonomousState} detail={autoStatus ? `${autoStatus.paper ? "模擬" : "非模擬"}模式 · 已執行 ${autoStatus.cycles} 次循環` : "尚未取得服務端自主交易狀態"} tone={autoStatus?.active ? "good" : "muted"} />
          <OperationRow icon="assignment-late" label="交易與確認" value={exchange?.selected?.toUpperCase() ?? "未取得"} detail={latestStrategyTask ? `最近草案：${latestStrategyTask.status === "draft_ready" ? "僅聊天草案完成，尚未送永動腦測試／部署" : latestStrategyTask.status === "drafting" ? "艾西正在產生文字草案" : "草案未送達"}；確認佇列未回傳` : "尚無策略草案；服務尚未回傳確認佇列"} tone={exchange ? "good" : "muted"} last />
        </Card>

        <View style={styles.statsRow}><Stat icon="extension" label="啟用插件" value={settings?.baseUrl ? String(enabledPlugins) : "—"} /><Stat icon="account-balance-wallet" label="帳戶餘額" value={balance?.balance ?? "—"} compact /><Stat icon="psychology" label="長期記憶" value={serviceMemoryStats?.ok ? String(serviceMemoryStats.total) : "未取得"} compact /></View>

        <Card style={styles.machineCard}>
          <View style={styles.machineHeading}><View><Text style={styles.machineEyebrow}>THREE-MACHINE OPERATIONS</Text><Text style={styles.machineTitle}>三機維護與資料配置</Text></View><MaterialIcons name="dns" size={27} color="#7AD6FF" /></View>
          <Text style={styles.machineCopy}>System Bible 已確認核心、交易、記憶與插件服務；但公開介面尚未提供三台機器的 inventory、角色、設定版本或 SSH 任務狀態。App 不會建立假節點或直接保存憑證。</Text>
          <View style={styles.machineTags}><Tag label="狀態盤點：待端點" /><Tag label="資料整理：可交辦" /><Tag label="配置變更：待確認" /></View>
          <PrimaryButton label="請艾西規劃維護與配置任務" icon="build" onPress={openMaintenanceTask} />
        </Card>

        <Card style={styles.architectureCard}>
          <View style={styles.architectureHeader}><View><Text style={styles.archEyebrow}>SYSTEM BIBLE</Text><Text style={styles.architectureTitle}>{systemBible?.title ?? "系統架構狀態"}</Text></View><StatusBadge state={systemBible?.status === "operational" ? "connected" : "unknown"} label={systemBible?.status === "operational" ? "運作中" : "暫無資料"} /></View>
          <Text style={styles.architectureCopy}>{systemBible ? `${systemBible.services.map((service) => service.toUpperCase()).join(" · ")} · v${systemBible.version}` : "無法讀取公開架構服務；可在稍後重新整理。"}</Text>
        </Card>

        <Text style={styles.endpoint}>{settings?.baseUrl ? `連線目標：${settings.baseUrl}` : "請至設定頁輸入 ELSA 服務位址"}</Text>
      </ScrollView>
    </ScreenContainer>
  );
}

function QuickChip({ icon, label, onPress }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; onPress: () => void }) {
  return <PrimaryButton label={label} icon={icon} variant="secondary" onPress={() => { haptic.light(); onPress(); }} />;
}

function OperationRow({ icon, label, value, detail, tone, last = false }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; value: string; detail: string; tone: "good" | "muted"; last?: boolean }) {
  const color = tone === "good" ? palette.accent : palette.muted;
  return <View style={[styles.operationRow, !last && styles.operationRowBorder]}><View style={[styles.operationIcon, { backgroundColor: `${color}18` }]}><MaterialIcons name={icon} size={19} color={color} /></View><View style={styles.operationCopy}><Text style={styles.operationLabel}>{label}</Text><Text style={styles.operationDetail}>{detail}</Text></View><Text numberOfLines={2} style={[styles.operationValue, { color }]}>{value}</Text></View>;
}

function Stat({ icon, label, value, compact = false }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; value: string; compact?: boolean }) {
  return <View style={styles.stat}><MaterialIcons name={icon} size={17} color={palette.accent} /><Text numberOfLines={1} style={[styles.statValue, compact && styles.statCompact]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function Tag({ label }: { label: string }) {
  return <View style={styles.tag}><Text style={styles.tagText}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#040508" }, content: { padding: 20, paddingBottom: 34, gap: 14 },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 2 }, brandPill: { width: 112, height: 42, borderRadius: 22, justifyContent: "center", alignItems: "center", overflow: "hidden", backgroundColor: "#181A22", borderWidth: 1, borderColor: "#2C2F3B" }, brandGlow: { position: "absolute", width: 94, height: 35, borderRadius: 30, backgroundColor: "#3A4279", opacity: 0.34 }, brandText: { color: palette.text, fontSize: 17, lineHeight: 22, letterSpacing: 0.8, fontWeight: "800" },
  heroFrame: { height: 310, overflow: "hidden", borderRadius: 28, backgroundColor: "#17152A", borderWidth: 1, borderColor: "#49437B" }, heroPortrait: { width: "100%", height: "100%", backgroundColor: "#161621" }, heroShade: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "#05050B", opacity: 0.28 }, heroCopy: { position: "absolute", left: 18, right: 18, bottom: 17, gap: 3 }, heroEyebrow: { color: "#CEC5FF", fontSize: 10, lineHeight: 15, fontWeight: "700", letterSpacing: 1 }, heroTitle: { color: "#FFFFFF", fontSize: 30, lineHeight: 36, fontWeight: "800", marginTop: 2 }, heroSubtitle: { color: "#E4E2EF", fontSize: 16, lineHeight: 22, marginBottom: 8 },
  quickRow: { flexDirection: "row", gap: 8 }, sectionLabel: { color: palette.muted, fontSize: 12, lineHeight: 18, fontWeight: "700", letterSpacing: 0.7, marginTop: 1 },
  operationCard: { padding: 0, overflow: "hidden", backgroundColor: "#11131B", borderColor: "#2A2E3A" }, operationRow: { minHeight: 74, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10 }, operationRowBorder: { borderBottomWidth: 1, borderBottomColor: "#242834" }, operationIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" }, operationCopy: { flex: 1 }, operationLabel: { color: palette.text, fontSize: 13, lineHeight: 18, fontWeight: "700" }, operationDetail: { color: palette.muted, fontSize: 10, lineHeight: 14, marginTop: 2 }, operationValue: { width: 96, textAlign: "right", fontSize: 12, lineHeight: 17, fontWeight: "700" },
  statsRow: { flexDirection: "row", gap: 9 }, stat: { flex: 1, minHeight: 100, gap: 6, padding: 12, borderRadius: 17, backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1 }, statValue: { color: palette.text, fontSize: 18, lineHeight: 23, fontWeight: "700" }, statCompact: { fontSize: 13 }, statLabel: { color: palette.muted, fontSize: 10, lineHeight: 14 },
  machineCard: { gap: 11, backgroundColor: "#0F1D2A", borderColor: "#274762" }, machineHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }, machineEyebrow: { color: "#8ED7FF", fontSize: 10, lineHeight: 15, letterSpacing: 0.8, fontWeight: "700" }, machineTitle: { color: palette.text, fontSize: 17, lineHeight: 23, fontWeight: "700", marginTop: 2 }, machineCopy: { color: "#B6D1E4", fontSize: 12, lineHeight: 19 }, machineTags: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, tag: { paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: "#315875", backgroundColor: "#12293A", borderRadius: 99 }, tagText: { color: "#AFDDF5", fontSize: 10, lineHeight: 14, fontWeight: "600" },
  architectureCard: { gap: 8, backgroundColor: "#151329", borderColor: "#3C376C" }, architectureHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, archEyebrow: { color: "#B7ABFF", fontSize: 11, lineHeight: 16, letterSpacing: 0.8, fontWeight: "700" }, architectureTitle: { color: palette.text, fontSize: 16, lineHeight: 22, fontWeight: "700", marginTop: 3 }, architectureCopy: { color: "#C8C4E6", fontSize: 12, lineHeight: 19 }, endpoint: { color: palette.muted, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 3 },
});
