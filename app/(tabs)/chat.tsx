import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Clipboard from "expo-clipboard";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Speech from "expo-speech";
import { useCallback, useEffect, useRef, useState } from "react";
import { Audio } from "expo-av";
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { IconButton, InlineNotice, palette } from "@/components/elsa-ui";
import { ScreenContainer } from "@/components/screen-container";
import { appendActivityLog } from "@/lib/activity-log";
import { askElsa, createPerpetualTask, errorMessage } from "@/lib/elsa-api";
import { clearChatHistory, getAixiVoiceMuted, getChatHistory, saveAixiVoiceMuted, saveChatHistory, saveLatestStrategyTask } from "@/lib/elsa-storage";
import type { ChatMessage, StrategyDraftTask } from "@/lib/elsa-types";
import { haptic } from "@/lib/haptics";

const QUICK_PROMPTS = [
  { icon: "track-changes", label: "共振訊號", prompt: "請顯示目前 BTCUSDT 的紙上交易訊號與技術指標。" },
  { icon: "bolt", label: "交易訊號", prompt: "請摘要目前的紙上交易自動化狀態，不要執行任何交易。" },
  { icon: "business-center", label: "持倉", prompt: "請顯示目前唯讀持倉資訊。" },
  { icon: "memory", label: "系統狀態", prompt: "請摘要 ELSA 核心服務、插件與自動化服務狀態。" },
] as const;

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ draft?: string; task?: string; market?: string; timeframe?: string; objective?: string; riskLimit?: string }>();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const appliedTaskKey = useRef<string | null>(null);
  const pendingStrategyTask = useRef<Omit<StrategyDraftTask, "id" | "createdAt" | "updatedAt" | "status"> | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [sendMode, setSendMode] = useState<"chat" | "code">("chat");

  const load = useCallback(async () => {
    const [history, muted] = await Promise.all([getChatHistory(), getAixiVoiceMuted()]);
    setMessages(history);
    setVoiceMuted(muted);
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true });
    return () => {
      try { Speech.stop(); } catch { /* Android may not expose a speech cancel handle after a hot reload. */ }
    };
  }, []);

  useEffect(() => {
    const draft = typeof params.draft === "string" ? params.draft : "";
    if (!draft) return;
    const key = [draft, params.task, params.market, params.timeframe, params.objective, params.riskLimit].join("|");
    if (appliedTaskKey.current === key) return;
    appliedTaskKey.current = key;
    setDraft(draft);
    if (params.task === "strategy") {
      pendingStrategyTask.current = {
        market: params.market ?? "未指定市場",
        timeframe: params.timeframe ?? "未指定週期",
        objective: params.objective ?? "未指定目標",
        riskLimit: params.riskLimit ?? "未指定限制",
      };
    }
  }, [params.draft, params.market, params.objective, params.riskLimit, params.task, params.timeframe]);

  const updateHistory = async (next: ChatMessage[]) => {
    setMessages(next);
    await saveChatHistory(next);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;

    const strategyInput = pendingStrategyTask.current;
    pendingStrategyTask.current = null;
    const strategyTask: StrategyDraftTask | null = strategyInput
      ? {
        ...strategyInput,
        id: `${Date.now()}-strategy`,
        status: "drafting",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      : null;

    haptic.light();
    setError(null);
    setDraft("");
    setSending(true);

    const userMessage: ChatMessage = { id: `${Date.now()}-u`, role: "user", content: text, createdAt: new Date().toISOString(), status: "sent" };
    const pending: ChatMessage = { id: `${Date.now()}-a`, role: "assistant", content: "", createdAt: new Date().toISOString(), status: "sending" };
    const pendingHistory = [...messages, userMessage, pending];
    await updateHistory(pendingHistory);
    if (strategyTask) {
      await saveLatestStrategyTask(strategyTask);
      await appendActivityLog({ source: "strategy", kind: "info", title: "已交辦艾西策略草案", detail: `${strategyTask.market} · ${strategyTask.timeframe} · 等待艾西回覆` });
    }
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));

    try {
      if (sendMode === "code") {
        const task = await createPerpetualTask({
          kind: "code",
          title: `艾西自主編碼：${text.replace(/\s+/g, " ").slice(0, 52)}`,
          objective: text,
        });
        const taskText = `已建立 N1 自主編碼任務：${task.taskId}\n狀態：${task.state}\n目標：${task.objective}\n\n是否已認領、執行、測試或部署，會以 N1 任務／永動腦端點的後續回報為準。`;
        const resolved = pendingHistory.map((message) => message.id === pending.id ? { ...message, content: taskText, status: "sent" as const } : message);
        await updateHistory(resolved);
        await appendActivityLog({ source: "control", kind: "info", title: "已建立自主編碼任務", detail: `${task.taskId} · ${task.state}` });
        haptic.success();
        return;
      }
      const answer = await askElsa(text);
      const resolved = pendingHistory.map((message) => message.id === pending.id ? { ...message, content: answer.text, status: "sent" as const } : message);
      await updateHistory(resolved);
      if (strategyTask) {
        await saveLatestStrategyTask({ ...strategyTask, status: "draft_ready", updatedAt: new Date().toISOString(), responseExcerpt: answer.text.slice(0, 240) });
        await appendActivityLog({ source: "strategy", kind: "success", title: "艾西策略草案已回覆", detail: "草案已保存於本機；尚未提交桌機端測試或部署。" });
      }
      if (!voiceMuted && answer.voiceDirective === "speak") {
        speakReply({ ...pending, content: answer.text, status: "sent" });
      }
      haptic.success();
    } catch (caught) {
      const message = errorMessage(caught);
      const failed = pendingHistory.map((item) => item.id === pending.id ? { ...item, content: "訊息未送達。", status: "failed" as const } : item);
      await updateHistory(failed);
      if (strategyTask) {
        await saveLatestStrategyTask({ ...strategyTask, status: "failed", updatedAt: new Date().toISOString() });
        await appendActivityLog({ source: "strategy", kind: "error", title: "策略草案未送達", detail: errorMessage(caught) });
      }
      setError(message);
      haptic.error();
    } finally {
      setSending(false);
    }
  };

  const clear = () => Alert.alert("清除本機對話", "這只會移除裝置上的對話紀錄。", [
    { text: "取消", style: "cancel" },
    { text: "清除", style: "destructive", onPress: async () => { await clearChatHistory(); setMessages([]); haptic.medium(); } },
  ]);
  const playVoiceSample = async () => {
    try {
      const { sound } = await Audio.Sound.createAsync(
        require("@/assets/audio/gemini_generated_audio_overview_fe45a92a.mp3")
      );
      await sound.playAsync();
    } catch {
      setError("語音參考檔目前無法播放。");
    }
  };




  const speakReply = useCallback((message: ChatMessage) => {
    if (!message.content.trim() || message.status !== "sent") return;
    if (speakingId === message.id) {
      try { Speech.stop(); } catch { setError("裝置端語音朗讀未能停止；已重設控制項。 "); }
      setSpeakingId(null);
      return;
    }
    setSpeakingId(message.id);
    try {
      Speech.speak(message.content.slice(0, 1800), {
        language: "zh-TW",
        rate: 0.88,
        pitch: 0.72,
        onDone: () => setSpeakingId(null),
        onStopped: () => setSpeakingId(null),
        onError: () => { setSpeakingId(null); setError("裝置端語音朗讀未能啟動。 "); },
      });
    } catch {
      setSpeakingId(null);
      setError("裝置端語音朗讀目前不可用。 ");
    }
  }, [speakingId]);

  const copyReply = useCallback(async (message: ChatMessage) => {
    if (!message.content.trim()) return;
    try {
      await Clipboard.setStringAsync(message.content);
      setCopiedId(message.id);
      haptic.success();
    } catch {
      setError("無法寫入系統剪貼簿。請確認裝置權限後再試。 ");
    }
  }, []);

  const toggleVoiceMuted = useCallback(() => {
    const next = !voiceMuted;
    setVoiceMuted(next);
    void saveAixiVoiceMuted(next);
    if (next && speakingId) {
      try { Speech.stop(); } catch { /* The visible state below remains the source of truth. */ }
      setSpeakingId(null);
    }
    haptic.light();
  }, [speakingId, voiceMuted]);

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]} style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.topbar}>
          <Pressable accessibilityRole="button" accessibilityLabel="開啟設定" onPress={() => router.push("./settings")} style={({ pressed }) => [styles.roundControl, pressed && styles.controlPressed]}>
            <MaterialIcons name="menu" size={25} color={palette.text} />
          </Pressable>
          <View style={styles.brandPill}><View style={styles.brandGlow} /><Text style={styles.brandText}>ELSA</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="查看資產" onPress={() => router.push("./assets")} style={({ pressed }) => [styles.roundControl, pressed && styles.controlPressed]}>
            <MaterialIcons name="bar-chart" size={23} color={palette.text} />
          </Pressable>
        </View>

        {messages.length > 0 ? <View style={styles.threadHeader}><Text style={styles.threadTitle}>與艾西對話</Text><IconButton icon="delete-outline" label="清除對話" onPress={clear} /></View> : null}
        {error ? <View style={styles.errorWrap}><InlineNotice type="error">{error}</InlineNotice></View> : null}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={messages.length ? styles.list : styles.emptyList}
          renderItem={({ item }) => <MessageBubble message={item} speaking={speakingId === item.id} copied={copiedId === item.id} onSpeak={() => speakReply(item)} onCopy={() => void copyReply(item)} />}
          ListEmptyComponent={<WelcomeHero onQuickPrompt={(prompt) => { haptic.light(); setDraft(prompt); }} />}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        />

        <View style={styles.voiceContractBar}>
          <View style={styles.voiceContractIdentity}><MaterialIcons name="record-voice-over" size={18} color="#93B3FF" /><View><Text style={styles.voiceContractTitle}>艾西語音策略</Text><Text style={styles.voiceContractText}>{voiceMuted ? "自動語音已靜音；文字紀錄仍完整保留" : "由艾西回覆契約決定；文字一律可複製"}</Text></View></View>
          <View style={styles.voiceControls}>
            <Pressable accessibilityRole="button" accessibilityLabel={voiceMuted ? "解除艾西語音靜音" : "靜音艾西自動語音"} onPress={toggleVoiceMuted} style={({ pressed }) => [styles.muteButton, voiceMuted && styles.muteButtonActive, pressed && styles.controlPressed]}><MaterialIcons name={voiceMuted ? "volume-off" : "volume-up"} size={15} color="#C9D4FF" /></Pressable>
          </View>
        </View>

        <View style={styles.composer}>
          <Pressable accessibilityRole="button" accessibilityLabel="設定服務" onPress={() => router.push("./settings")} style={({ pressed }) => [styles.addButton, pressed && styles.controlPressed]}>
            <MaterialIcons name="add" size={25} color={palette.text} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={sendMode === "code" ? "切換為一般對話" : "切換為交給艾西自主編碼"} onPress={() => { setSendMode((mode) => mode === "chat" ? "code" : "chat"); haptic.light(); }} style={({ pressed }) => [styles.micButton, sendMode === "code" && styles.codeModeButton, pressed && styles.controlPressed]}>
            <MaterialIcons name={sendMode === "code" ? "code" : "mic-none"} size={22} color="#A7B9FF" />
          </Pressable>
          <TextInput value={draft} onChangeText={setDraft} placeholder={sendMode === "code" ? "描述要讓艾西自主編碼的目標…" : "給艾西派個活…"} placeholderTextColor="#858E9D" multiline style={styles.input} returnKeyType="send" onSubmitEditing={() => void send()} blurOnSubmit={false} />
          <Pressable accessibilityRole="button" accessibilityLabel={sendMode === "code" ? "建立艾西自主編碼任務" : "傳送訊息"} onPress={() => void send()} disabled={!draft.trim() || sending} style={({ pressed }) => [styles.sendButton, sendMode === "code" && styles.codeSendButton, (!draft.trim() || sending) && styles.sendDisabled, pressed && styles.sendPressed]}>
            <MaterialIcons name={sending ? "hourglass-top" : "arrow-upward"} size={25} color={palette.text} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

function WelcomeHero({ onQuickPrompt }: { onQuickPrompt: (prompt: string) => void }) {
  return (
    <View style={styles.welcome}>
      <View style={styles.portraitAura}>
        <Image source={require("@/assets/images/persona/elsa-ceremony.jpg")} style={styles.welcomePortrait} contentFit="cover" transition={180} />
      </View>
      <Text style={styles.welcomeTitle}>我是艾西，你的 AI 戰略副官</Text>
      <Text style={styles.welcomeSubtitle}>有什麼我可以幫你的？</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.promptRow} style={styles.promptScroller}>
        {QUICK_PROMPTS.map((item) => (
          <Pressable key={item.label} accessibilityRole="button" onPress={() => onQuickPrompt(item.prompt)} style={({ pressed }) => [styles.promptChip, pressed && styles.chipPressed]}>
            <MaterialIcons name={item.icon} size={18} color={item.label === "交易訊號" ? "#F9D45C" : item.label === "持倉" ? "#E0AD96" : palette.text} />
            <Text style={styles.promptText}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function MessageBubble({ message, speaking, copied, onSpeak, onCopy }: { message: ChatMessage; speaking: boolean; copied: boolean; onSpeak: () => void; onCopy: () => void }) {
  const isUser = message.role === "user";
  return (
    <View style={[styles.bubbleRow, isUser ? styles.userRow : styles.assistantRow]}>
      {!isUser ? <Image source={require("@/assets/images/persona/elsa-soft-portrait.webp")} style={styles.assistantAvatar} contentFit="cover" transition={160} /> : null}
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        {message.status === "sending" ? <View style={styles.thinking}><MaterialIcons name="more-horiz" size={20} color={palette.muted} /><Text style={styles.thinkingText}>艾西正在回覆</Text></View> : <Text style={styles.messageText}>{message.content}</Text>}
        {!isUser && message.status === "sent" && message.content ? <View style={styles.messageActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={speaking ? "停止朗讀艾西回覆" : "朗讀艾西回覆"} onPress={onSpeak} style={({ pressed }) => [styles.speakButton, pressed && styles.controlPressed]}><MaterialIcons name={speaking ? "stop" : "volume-up"} size={15} color="#C9D4FF" /><Text style={styles.speakButtonText}>{speaking ? "停止" : "朗讀"}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="複製艾西回覆文字" onPress={onCopy} style={({ pressed }) => [styles.copyButton, pressed && styles.controlPressed]}><MaterialIcons name={copied ? "check" : "content-copy"} size={14} color="#C9D4FF" /><Text style={styles.speakButtonText}>{copied ? "已複製" : "複製"}</Text></Pressable>
        </View> : null}
        {message.status === "failed" ? <Text style={styles.failedText}>傳送失敗</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#040508" }, flex: { flex: 1 },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  roundControl: { width: 58, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#17191F" },
  brandPill: { minWidth: 112, height: 48, borderRadius: 24, overflow: "hidden", justifyContent: "center", alignItems: "center", backgroundColor: "#1A1C22", borderWidth: 1, borderColor: "#292C36" },
  brandGlow: { position: "absolute", width: 92, height: 42, borderRadius: 40, backgroundColor: "#333C74", opacity: 0.34 }, brandText: { color: palette.text, fontSize: 18, letterSpacing: 0.6, fontWeight: "800" }, controlPressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
  threadHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 8 }, threadTitle: { color: palette.text, fontSize: 15, fontWeight: "700" },
  errorWrap: { paddingHorizontal: 20, paddingBottom: 8 }, list: { paddingHorizontal: 20, paddingBottom: 16, gap: 10 }, emptyList: { flexGrow: 1, justifyContent: "center" },
  welcome: { alignItems: "center", paddingVertical: 12, gap: 0 }, portraitAura: { width: 182, height: 286, borderRadius: 28, padding: 3, marginBottom: 28, backgroundColor: "#1A3268", shadowColor: "#407CFF", shadowOpacity: 0.52, shadowRadius: 28, shadowOffset: { width: 0, height: 8 }, elevation: 10 }, welcomePortrait: { flex: 1, borderRadius: 25, backgroundColor: "#11141D" },
  welcomeTitle: { color: "#E5E7EE", fontSize: 20, lineHeight: 29, fontWeight: "500", textAlign: "center" }, welcomeSubtitle: { color: "#AFB3C0", fontSize: 19, lineHeight: 28, fontWeight: "400", textAlign: "center", marginTop: 7 },
  promptScroller: { alignSelf: "stretch", marginTop: 42 }, promptRow: { gap: 10, paddingHorizontal: 20, paddingRight: 36 }, promptChip: { minHeight: 47, paddingHorizontal: 16, borderRadius: 24, backgroundColor: "#15171C", borderWidth: 1, borderColor: "#2A2E38", flexDirection: "row", alignItems: "center", gap: 8 }, promptText: { color: palette.text, fontSize: 15, fontWeight: "600" }, chipPressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 }, userRow: { justifyContent: "flex-end" }, assistantRow: { justifyContent: "flex-start" }, assistantAvatar: { width: 30, height: 30, borderRadius: 10, backgroundColor: palette.surfaceRaised }, bubble: { maxWidth: "82%", paddingHorizontal: 14, paddingVertical: 11, borderRadius: 18 }, userBubble: { backgroundColor: palette.primary, borderBottomRightRadius: 5 }, assistantBubble: { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1, borderBottomLeftRadius: 5 }, messageText: { color: palette.text, fontSize: 15, lineHeight: 22 }, thinking: { flexDirection: "row", alignItems: "center", gap: 6 }, thinkingText: { color: palette.muted, fontSize: 13 }, failedText: { color: "#FCA5A5", fontSize: 11, marginTop: 7 },
  messageActions: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, marginTop: 8 }, speakButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: "#18213A", borderWidth: 1, borderColor: "#2B3B64" }, copyButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: "#161D31", borderWidth: 1, borderColor: "#2B3B64" }, speakButtonText: { color: "#C9D4FF", fontSize: 10, fontWeight: "700" },
  voiceContractBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 20, paddingTop: 9, paddingBottom: 8, borderTopWidth: 1, borderTopColor: "#12141A", backgroundColor: "#070912" }, voiceContractIdentity: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }, voiceContractTitle: { color: "#D7DEFF", fontSize: 11, lineHeight: 15, fontWeight: "800" }, voiceContractText: { color: "#8994B1", fontSize: 9, lineHeight: 13 }, voiceControls: { flexDirection: "row", alignItems: "center", gap: 6 }, muteButton: { width: 31, height: 31, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#111A2E", borderWidth: 1, borderColor: "#2B3B64" }, muteButtonActive: { backgroundColor: "#382232", borderColor: "#70405B" }, referenceButton: { minWidth: 65, height: 31, paddingHorizontal: 10, borderRadius: 15, backgroundColor: "#9ED9FF", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 }, referenceButtonText: { color: "#06101A", fontSize: 11, fontWeight: "800" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, backgroundColor: "#040508" }, addButton: { width: 42, height: 48, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "#17191F" }, micButton: { width: 42, height: 48, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "#111A2E", borderWidth: 1, borderColor: "#2B3B64" }, codeModeButton: { backgroundColor: "#32275A", borderColor: "#7963D8" }, input: { flex: 1, minHeight: 50, maxHeight: 120, color: palette.text, backgroundColor: "#17191F", borderRadius: 25, paddingHorizontal: 18, paddingVertical: 13, fontSize: 16, lineHeight: 22 }, sendButton: { width: 52, height: 52, alignItems: "center", justifyContent: "center", borderRadius: 26, backgroundColor: "#397BFF" }, codeSendButton: { backgroundColor: "#7856E8" }, sendDisabled: { opacity: 0.42 }, sendPressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
});
