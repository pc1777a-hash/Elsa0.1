import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { EmptyState, InlineNotice, ScreenTitle, StatusBadge, palette } from "@/components/elsa-ui";
import { ScreenContainer } from "@/components/screen-container";
import { errorMessage, listPlugins } from "@/lib/elsa-api";
import type { Plugin } from "@/lib/elsa-types";
import { haptic } from "@/lib/haptics";

export default function PluginsScreen() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [selected, setSelected] = useState<Plugin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => { setLoading(true); setError(null); try { setPlugins(await listPlugins()); } catch (caught) { setError(errorMessage(caught)); } finally { setLoading(false); } }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return <ScreenContainer edges={["top", "left", "right"]} style={styles.screen}><View style={styles.container}><ScreenTitle title="插件" subtitle="檢視服務端已配置的功能；憑證不會傳至手機。" />{error ? <InlineNotice type="error">{error}</InlineNotice> : null}<FlatList data={plugins} keyExtractor={(item) => item.id} refreshing={loading} onRefresh={() => void load()} contentContainerStyle={plugins.length ? styles.list : styles.emptyList} ListEmptyComponent={loading ? <ActivityIndicator color={palette.primary} /> : <EmptyState icon="extension-off" title="沒有可顯示的插件" detail="確認服務位址並重新整理後再試。" />} renderItem={({ item }) => <PluginRow plugin={item} onOpen={() => { setSelected(item); haptic.light(); }} />} /></View><PluginModal plugin={selected} onClose={() => setSelected(null)} /></ScreenContainer>;
}

function PluginRow({ plugin, onOpen }: { plugin: Plugin; onOpen: () => void }) {
  return <Pressable onPress={onOpen} style={({ pressed }) => [styles.pluginRow, pressed && { opacity: 0.75 }]}><View style={styles.pluginIcon}><Text style={styles.pluginEmoji}>{plugin.icon}</Text></View><View style={styles.pluginCopy}><Text style={styles.pluginName}>{plugin.name}</Text><Text numberOfLines={1} style={styles.pluginDescription}>{plugin.desc}</Text><Text style={styles.pluginCategory}>{plugin.cat}</Text></View><StatusBadge state={plugin.enabled ? "connected" : "unknown"} label={plugin.enabled ? "啟用" : "未啟用"} /></Pressable>;
}

function PluginModal({ plugin, onClose }: { plugin: Plugin | null; onClose: () => void }) {
  if (!plugin) return null;
  return <Modal transparent animationType="slide" visible onRequestClose={onClose}><Pressable style={styles.overlay} onPress={onClose}><Pressable style={styles.sheet} onPress={() => undefined}><View style={styles.sheetHandle} /><View style={styles.sheetTitleRow}><View style={styles.sheetIcon}><Text style={styles.pluginEmoji}>{plugin.icon}</Text></View><View style={styles.sheetTitleCopy}><Text style={styles.sheetTitle}>{plugin.name}</Text><Text style={styles.sheetDescription}>{plugin.desc}</Text></View><StatusBadge state={plugin.enabled ? "connected" : "unknown"} label={plugin.enabled ? "啟用中" : "未啟用"} /></View><View style={styles.modalDivider} /><InlineNotice>此版本依目前原生 API 契約提供唯讀狀態。插件啟用、停用、連線測試與憑證管理仍在桌機服務端操作。</InlineNotice></Pressable></Pressable></Modal>;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: palette.background }, container: { flex: 1, paddingHorizontal: 20, paddingTop: 8 }, list: { paddingTop: 4, paddingBottom: 24, gap: 10 }, emptyList: { flexGrow: 1, justifyContent: "center" }, pluginRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface }, pluginIcon: { width: 46, height: 46, borderRadius: 14, justifyContent: "center", alignItems: "center", backgroundColor: palette.surfaceRaised }, pluginEmoji: { fontSize: 23 }, pluginCopy: { flex: 1, minWidth: 0 }, pluginName: { color: palette.text, fontSize: 15, lineHeight: 21, fontWeight: "700" }, pluginDescription: { color: palette.muted, fontSize: 12, lineHeight: 18, marginTop: 2 }, pluginCategory: { color: "#B7ABFF", fontSize: 11, lineHeight: 16, marginTop: 3, fontWeight: "700" }, overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "#000000B8" }, sheet: { backgroundColor: palette.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 16 }, sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 4, backgroundColor: palette.border, marginBottom: 2 }, sheetTitleRow: { flexDirection: "row", alignItems: "center", gap: 11 }, sheetIcon: { width: 48, height: 48, borderRadius: 15, justifyContent: "center", alignItems: "center", backgroundColor: palette.surfaceRaised }, sheetTitleCopy: { flex: 1 }, sheetTitle: { color: palette.text, fontSize: 18, lineHeight: 24, fontWeight: "700" }, sheetDescription: { color: palette.muted, fontSize: 12, lineHeight: 18, marginTop: 2 }, modalDivider: { height: 1, backgroundColor: palette.border }, enableRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, enableTitle: { color: palette.text, fontSize: 15, lineHeight: 21, fontWeight: "700" }, enableDetail: { color: palette.muted, fontSize: 12, lineHeight: 18, marginTop: 2 }, exchangeSection: { gap: 8 }, smallLabel: { color: palette.muted, fontSize: 12, lineHeight: 18, fontWeight: "700", letterSpacing: 0.6 }, exchangeOption: { flexDirection: "row", alignItems: "center", gap: 10, padding: 13, borderWidth: 1, borderColor: palette.border, borderRadius: 14, backgroundColor: palette.surface }, exchangeSelected: { borderColor: palette.primary, backgroundColor: "#17162C" }, exchangeName: { color: palette.text, flex: 1, fontSize: 14, fontWeight: "700" }, keyState: { fontSize: 11, fontWeight: "700" }, keyReady: { color: palette.accent }, keyMissing: { color: palette.muted },
});
