import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, IconButton, InlineNotice, PrimaryButton, ScreenTitle, StatusBadge, palette } from "@/components/elsa-ui";
import { ScreenContainer } from "@/components/screen-container";
import { appendActivityLog, clearActivityLog, getActivityLog, type ActivityLogEntry } from "@/lib/activity-log";
import { errorMessage, getNativeHealth, getTradeAutoStatus } from "@/lib/elsa-api";
import { haptic } from "@/lib/haptics";

export default function LogScreen() {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => { setEntries(await getActivityLog()); }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const checkHealth = async () => {
    setChecking(true);
    setError(null);
    try {
      const [health, autoStatus] = await Promise.all([getNativeHealth(), getTradeAutoStatus().catch(() => null)]);
      const autonomousDetail = autoStatus ? `；自主操作：${autoStatus.active ? "運行中" : autoStatus.configured ? "已配置、未運行" : "未配置"}，${autoStatus.paper ? "模擬" : "非模擬"}模式，${autoStatus.cycles} 次循環。` : "；自主操作狀態未取得。";
      await appendActivityLog({ source: "control", kind: health.status === "healthy" ? "success" : "info", title: "原生服務健康檢查", detail: `服務回傳狀態：${health.status}${autonomousDetail}` });
      await load();
      haptic.success();
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      await appendActivityLog({ source: "control", kind: "error", title: "原生服務健康檢查失敗", detail: message });
      await load();
      haptic.error();
    } finally {
      setChecking(false);
    }
  };

  const clear = () => Alert.alert("清除本機日誌", "只會刪除這台裝置保存的事件紀錄，服務端資料不會被修改。", [
    { text: "取消", style: "cancel" },
    { text: "清除", style: "destructive", onPress: async () => { await clearActivityLog(); await load(); haptic.medium(); } },
  ]);

  return (
    <ScreenContainer edges={["top", "left", "right"]} style={styles.screen}>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        refreshing={checking}
        onRefresh={() => void checkHealth()}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <LogCard item={item} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenTitle title="即時日誌" subtitle="服務讀取、艾西任務與本機事件的真實紀錄。" action={<IconButton icon="delete-outline" label="清除本機日誌" onPress={clear} />} />
            {error ? <InlineNotice type="error">{error}</InlineNotice> : null}
            <Card style={styles.monitorCard}>
              <View style={styles.monitorTop}><View><Text style={styles.eyebrow}>EVENT STREAM</Text><Text style={styles.monitorTitle}>服務事件檢查</Text></View><StatusBadge state={checking ? "unknown" : "connected"} label={checking ? "檢查中" : "手動重新整理"} /></View>
              <Text style={styles.monitorCopy}>目前的事件來自實際 API 讀取與使用者指派的艾西任務。服務端尚未公開事件串流，因此不會以模擬資料填滿列表。</Text>
              <PrimaryButton label="執行健康檢查" icon="monitor-heart" loading={checking} onPress={() => void checkHealth()} />
            </Card>
            <Text style={styles.sectionLabel}>最近事件</Text>
          </View>
        }
        ListEmptyComponent={<EmptyState icon="receipt-long" title="尚無事件紀錄" detail="重新整理控制台、讀取交易資料或交辦艾西任務後，實際成功／失敗事件會顯示在這裡。" />}
      />
    </ScreenContainer>
  );
}

function LogCard({ item }: { item: ActivityLogEntry }) {
  const color = item.kind === "success" ? palette.accent : item.kind === "error" ? palette.error : palette.muted;
  const icon = item.kind === "success" ? "check-circle-outline" : item.kind === "error" ? "error-outline" : "info-outline";
  return <Card style={styles.logCard}><View style={[styles.logIcon, { backgroundColor: `${color}1D` }]}><MaterialIcons name={icon} size={20} color={color} /></View><View style={styles.logCopy}><View style={styles.logTitleRow}><Text style={styles.logTitle}>{item.title}</Text><Text style={styles.logTime}>{formatTime(item.createdAt)}</Text></View><Text style={styles.logDetail}>{item.detail}</Text><Text style={styles.logSource}>{sourceLabel(item.source)}</Text></View></Card>;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "時間未知";
  return date.toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function sourceLabel(source: ActivityLogEntry["source"]): string {
  return source === "trading" ? "交易監控" : source === "strategy" ? "策略任務" : source === "memory" ? "記憶中心" : "控制台";
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#040508" }, list: { flexGrow: 1, paddingBottom: 28, gap: 10 }, header: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  monitorCard: { gap: 11, backgroundColor: "#111D2A", borderColor: "#28435A" }, monitorTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }, eyebrow: { color: "#88C6FF", fontSize: 11, lineHeight: 16, letterSpacing: 0.9, fontWeight: "700" }, monitorTitle: { color: palette.text, fontSize: 17, lineHeight: 23, fontWeight: "700", marginTop: 2 }, monitorCopy: { color: "#B5CADB", fontSize: 12, lineHeight: 18 }, sectionLabel: { color: palette.muted, fontSize: 12, lineHeight: 18, fontWeight: "700", letterSpacing: 0.7, marginTop: 2 },
  logCard: { marginHorizontal: 20, flexDirection: "row", alignItems: "flex-start", gap: 11, padding: 13 }, logIcon: { width: 39, height: 39, borderRadius: 13, alignItems: "center", justifyContent: "center" }, logCopy: { flex: 1, gap: 3 }, logTitleRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 }, logTitle: { flex: 1, color: palette.text, fontSize: 14, lineHeight: 20, fontWeight: "700" }, logTime: { color: palette.muted, fontSize: 10, lineHeight: 15 }, logDetail: { color: "#C5CCD7", fontSize: 12, lineHeight: 18 }, logSource: { color: palette.muted, fontSize: 10, lineHeight: 14, marginTop: 2 },
});
