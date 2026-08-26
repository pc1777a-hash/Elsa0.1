import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Card, InlineNotice, PrimaryButton, ScreenTitle, StatusBadge, palette } from "@/components/elsa-ui";
import { ScreenContainer } from "@/components/screen-container";
import { appendActivityLog } from "@/lib/activity-log";
import { errorMessage, getExchangeBalance, getNativeHealth, getRecentServiceMemories, getServiceMemoryStats, getServiceModelConfig, getServiceModels, getTradeAutoStatus, getTradePositions, listPlugins, normalizeServiceUrl, validateServiceUrl } from "@/lib/elsa-api";
import { clearLocalPreferences, getServiceSettings, saveServiceSettings } from "@/lib/elsa-storage";
import type { ServiceSettings } from "@/lib/elsa-types";
import { haptic } from "@/lib/haptics";

export default function SettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<ServiceSettings | null>(null);
  const [url, setUrl] = useState("");
  const [changeRequest, setChangeRequest] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const load = useCallback(async () => { const saved = await getServiceSettings(); setSettings(saved); setUrl(saved.baseUrl); }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const testAndSave = async () => {
    const nextUrl = normalizeServiceUrl(url);
    const validation = validateServiceUrl(nextUrl);
    if (validation) { setMessage({ type: "error", text: validation }); haptic.error(); return; }
    setSaving(true); setMessage(null);
    const candidate: ServiceSettings = { baseUrl: nextUrl, lastCheckedAt: new Date().toISOString(), lastStatus: "unknown" };
    await saveServiceSettings(candidate); setSettings(candidate);
    try {
      const [health, plugins, balance, positions, optionalResults] = await Promise.all([
        getNativeHealth(),
        listPlugins(),
        getExchangeBalance(),
        getTradePositions(),
        Promise.allSettled([getServiceMemoryStats(), getRecentServiceMemories(), getTradeAutoStatus(), getServiceModelConfig(), getServiceModels()]),
      ]);
      if (health.status !== "healthy") throw new Error("原生服務未回報 healthy 狀態。");
      const connected = { ...candidate, lastStatus: "connected" as const };
      await saveServiceSettings(connected); setSettings(connected);
      const availableOptionalRoutes = optionalResults.filter((result) => result.status === "fulfilled").length;
      const text = `連線成功：${plugins.length} 個插件、餘額 ${balance.balance}、${positions.positions.length} 筆持倉；延伸唯讀路由 ${availableOptionalRoutes}/${optionalResults.length} 可用。`;
      setMessage({ type: "success", text });
      await appendActivityLog({ source: "control", kind: "success", title: "設定連線測試成功", detail: text });
      haptic.success();
    } catch (caught) {
      const detail = errorMessage(caught);
      const disconnected = { ...candidate, lastStatus: "disconnected" as const };
      await saveServiceSettings(disconnected); setSettings(disconnected);
      setMessage({ type: "error", text: detail });
      await appendActivityLog({ source: "control", kind: "error", title: "設定連線測試失敗", detail });
      haptic.error();
    } finally { setSaving(false); }
  };

  const requestMaintenancePlan = () => {
    const request = changeRequest.trim();
    if (!request) { setMessage({ type: "error", text: "請先描述要新增、調整、停用或整理的配置需求。" }); return; }
    haptic.light();
    router.push({ pathname: "./chat", params: { draft: buildMaintenancePrompt(request) } });
  };

  const reset = () => Alert.alert("清除本機資料", "這會移除服務位址、對話、研究筆記與本機策略草案；不會變更服務端資料。", [
    { text: "取消", style: "cancel" },
    { text: "清除", style: "destructive", onPress: async () => { await clearLocalPreferences(); await load(); setMessage(null); haptic.medium(); } },
  ]);

  return <ScreenContainer edges={["top", "left", "right"]} style={styles.screen}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><ScreenTitle title="設定" subtitle="服務連線、三機維護與受控配置工作流。" />
    <Card style={styles.statusCard}><View style={styles.statusHeader}><View><Text style={styles.statusLabel}>目前連線</Text><Text numberOfLines={1} style={styles.statusUrl}>{settings?.baseUrl || "尚未設定"}</Text></View><StatusBadge state={settings?.lastStatus ?? "unknown"} /></View>{settings?.lastCheckedAt ? <Text style={styles.checkedAt}>最近檢查：{new Date(settings.lastCheckedAt).toLocaleString("zh-TW")}</Text> : null}</Card>
    <View style={styles.fieldGroup}><Text style={styles.fieldLabel}>服務位址</Text><TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://brain.pin-yi.uk" placeholderTextColor={palette.muted} style={styles.input} returnKeyType="done" onSubmitEditing={() => void testAndSave()} /><Text style={styles.helper}>預設位址為目前已驗證的 ELSA 公開服務；你也可以改成其他部署位址。</Text></View>
    {message ? <InlineNotice type={message.type}>{message.text}</InlineNotice> : null}
    <PrimaryButton label="儲存並測試連線" icon="link" loading={saving} onPress={() => void testAndSave()} />

	    <Card style={styles.fleetCard}><Text style={styles.fleetEyebrow}>THREE-MACHINE MAINTENANCE</Text><Text style={styles.fleetTitle}>三機維護、資料整理與配置變更</Text><Text style={styles.fleetText}>你可以描述要新增、調整、停用或清理的配置。艾西會先產生機器角色、影響範圍、備份、驗證與復原計畫。公開端點目前沒有 inventory、SSH 工作佇列或部署確認契約，所以此入口只建立可審閱任務，不會直接變更任何主機。</Text><TextInput value={changeRequest} onChangeText={setChangeRequest} multiline placeholder="例如：新增記憶索引工作者，保留原始資料 30 天；或停用第二台機器的舊任務" placeholderTextColor="#7E8796" style={styles.changeInput} textAlignVertical="top" /><PrimaryButton label="請艾西規劃變更" icon="construction" onPress={requestMaintenancePlan} /></Card>
	    <N1ReadOnlySetupCard />

    <Card style={styles.contractCard}><Text style={styles.contractTitle}>已驗證的連線契約</Text><Text style={styles.contractText}>基礎路由：`GET /health`、`GET /api/plugins`、`GET /trade/balance`、`GET /trade/positions`、`POST /ask`。延伸唯讀路由：`/api/memory/stats`、`/api/memory/recent`、`/trade/auto/status`、`/api/config`、`/api/models`。App 僅保存服務位址與本機工作脈絡；API 憑證、Git Token 與 SSH 私鑰始終保留於桌機服務端。</Text></Card>
    <PrimaryButton label="清除本機資料" icon="delete-outline" variant="danger" onPress={reset} />
  </ScrollView></ScreenContainer>;
}

function N1ReadOnlySetupCard() {
  const installers = [
    ["三機儲存盤點", "GET /api/system/storage-inventory", "install_storage_inventory_routes.sh"],
    ["能力資產盤點", "GET /api/system/capability-inventory", "install_capability_inventory_routes.sh"],
    ["永動腦主動事件", "GET /api/perpetual/events", "install_proactive_event_routes.sh"],
  ] as const;

  return <Card style={styles.fleetCard}><View style={styles.statusHeader}><View><Text style={styles.fleetEyebrow}>N1 READ-ONLY SETUP</Text><Text style={styles.fleetTitle}>觀測能力啟用看板</Text></View><StatusBadge state="unknown" label="待 N1 安裝" /></View><Text style={styles.fleetText}>App 已具備三個唯讀資料卡；只有 N1 安裝並回報有效契約後，才會顯示狀態。手機不會下載、執行、重啟或保存主機憑證。</Text>{installers.map(([title, route, script], index) => <View key={script} style={styles.accountRow}><Text style={styles.accountIndex}>0{index + 1}</Text><View style={styles.accountCopy}><Text style={styles.accountTitle}>{title}</Text><Text style={styles.accountDetail}>{route} · {script}</Text></View><Text style={styles.accountState}>桌機待執行</Text></View>)}<Text style={styles.checkedAt}>每個安裝器先做備份與語法驗證；重啟後由唯讀請求確認。未回報前，記憶中心會保留「未回報」。</Text></Card>;
}

function buildMaintenancePrompt(request: string): string {
  return [
    "請以 ELSA 維運代理身分建立三機維護與資料配置變更計畫。",
    `主人提出的需求：${request}`,
    "輸出：1) 需要的節點 inventory 與待確認資訊；2) 角色／資源／資料流調整方案；3) 資料分類、備份、保留與清理步驟；4) 配置 diff 摘要；5) 驗證與復原計畫；6) 需要主人確認的不可逆動作。",
    "這是計畫與程式草案階段。不可使用 SSH、改 Git、重啟服務、刪除資料、覆寫配置或部署。若可用工具不足，必須清楚列出缺少的受控端點與權限。",
  ].join("\n");
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#040508" }, content: { padding: 20, gap: 16, paddingBottom: 34 }, statusCard: { gap: 8 }, statusHeader: { flexDirection: "row", justifyContent: "space-between", gap: 12 }, statusLabel: { color: palette.muted, fontSize: 12, lineHeight: 18, fontWeight: "700", letterSpacing: 0.6 }, statusUrl: { color: palette.text, fontSize: 14, lineHeight: 21, fontWeight: "600", marginTop: 3, maxWidth: 210 }, checkedAt: { color: palette.muted, fontSize: 11, lineHeight: 16 }, fieldGroup: { gap: 7 }, fieldLabel: { color: palette.text, fontSize: 14, fontWeight: "700" }, input: { minHeight: 50, color: palette.text, backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: 14 }, helper: { color: palette.muted, fontSize: 12, lineHeight: 18 }, fleetCard: { gap: 9, backgroundColor: "#0F1D2A", borderColor: "#274762" }, fleetEyebrow: { color: "#8ED7FF", fontSize: 10, lineHeight: 15, fontWeight: "700", letterSpacing: 0.8 }, fleetTitle: { color: palette.text, fontSize: 17, lineHeight: 23, fontWeight: "700" }, fleetText: { color: "#B6D1E4", fontSize: 12, lineHeight: 19 }, changeInput: { minHeight: 98, maxHeight: 180, paddingHorizontal: 13, paddingVertical: 11, color: palette.text, backgroundColor: "#0A151E", borderColor: "#315875", borderWidth: 1, borderRadius: 13, fontSize: 14, lineHeight: 20 }, accountRow: { alignItems: "center", borderTopColor: "#315875", borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 9, paddingTop: 9 }, accountIndex: { color: "#A6DFFF", fontSize: 10, fontWeight: "800", width: 20 }, accountCopy: { flex: 1, gap: 2 }, accountTitle: { color: palette.text, fontSize: 12, fontWeight: "700" }, accountDetail: { color: "#9AC1DB", fontSize: 10, lineHeight: 15 }, accountState: { color: "#E5C16A", fontSize: 10, fontWeight: "700" }, contractCard: { gap: 5, backgroundColor: palette.surfaceRaised }, contractTitle: { color: palette.text, fontSize: 14, lineHeight: 20, fontWeight: "700" }, contractText: { color: palette.muted, fontSize: 12, lineHeight: 19 },
});
