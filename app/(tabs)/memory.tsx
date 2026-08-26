import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect } from "expo-router";
import { Image } from "expo-image";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from "react-native";

import { DocumentWorkflowCard } from "@/components/document-workflow-card";
import { Card, EmptyState, InlineNotice, PrimaryButton, ScreenTitle, StatusBadge, palette } from "@/components/elsa-ui";
import { MultiPlatformControlCard } from "@/components/multi-platform-control-card";
import { ScreenContainer } from "@/components/screen-container";
import { appendActivityLog } from "@/lib/activity-log";
import { askElsa, errorMessage, getAixiSelfReport, getDocumentProductionReport, getPerpetualBrainStatus, getPerpetualStrategyStatus, getPerpetualTasks, getProactiveEvents, getRecentServiceMemories, getServiceMemoryStats, getServiceModelConfig, getServiceModels, getSystemCapabilityInventory, getSystemResources, getSystemStorageInventory, getTradeAutoStatus } from "@/lib/elsa-api";
import { getResearchTasks, saveResearchTask } from "@/lib/elsa-storage";
import { buildMagicContractSkills, type MagicContractSkill } from "@/lib/magic-contract-skills";
import type { AixiSelfReport, CapabilityInventoryNode, DocumentProductionReport, PerpetualBrainStatus, PerpetualStrategyStatus, PerpetualTask, ProactiveEvent, ProactiveEventFeed, ResearchTask, ServiceMemoryRecent, ServiceMemoryStats, ServiceModelConfig, ServiceModels, StorageInventoryNode, SystemCapabilityInventory, SystemResources, SystemStorageInventory, SystemBible, TradeAutoStatus } from "@/lib/elsa-types";
import { haptic } from "@/lib/haptics";
import { getSystemBible } from "@/lib/system-bible";
import { SYSTEM_TOPOLOGY_SNAPSHOT } from "@/lib/system-topology";

const REFRESH_INTERVAL_MS = 30_000;

export default function MemoryScreen() {
  const [researchTasks, setResearchTasks] = useState<ResearchTask[]>([]);
  const [systemBible, setSystemBible] = useState<SystemBible | null>(null);
  const [serviceMemoryStats, setServiceMemoryStats] = useState<ServiceMemoryStats | null>(null);
  const [recentServiceMemories, setRecentServiceMemories] = useState<ServiceMemoryRecent | null>(null);
  const [serviceModelConfig, setServiceModelConfig] = useState<ServiceModelConfig | null>(null);
  const [serviceModels, setServiceModels] = useState<ServiceModels | null>(null);
  const [perpetualStatus, setPerpetualStatus] = useState<PerpetualBrainStatus | null>(null);
  const [systemResources, setSystemResources] = useState<SystemResources | null>(null);
  const [perpetualTasks, setPerpetualTasks] = useState<PerpetualTask[] | null>(null);
  const [strategyStatus, setStrategyStatus] = useState<PerpetualStrategyStatus | null>(null);
  const [tradeAutoStatus, setTradeAutoStatus] = useState<TradeAutoStatus | null>(null);
  const [selfReport, setSelfReport] = useState<AixiSelfReport | null>(null);
  const [storageInventory, setStorageInventory] = useState<SystemStorageInventory | null>(null);
  const [capabilityInventory, setCapabilityInventory] = useState<SystemCapabilityInventory | null>(null);
  const [proactiveEventFeed, setProactiveEventFeed] = useState<ProactiveEventFeed | null>(null);
  const [documentReport, setDocumentReport] = useState<DocumentProductionReport | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(true);
  const [researching, setResearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [tasks, bibleResult, statsResult, recentResult, modelConfigResult, modelsResult, brainResult, resourcesResult, workerTasksResult, strategyResult, autoResult, selfResult, storageInventoryResult, capabilityInventoryResult, proactiveEventsResult, documentReportResult] = await Promise.all([
      getResearchTasks(),
      getSystemBible().catch(() => null),
      getServiceMemoryStats().catch(() => null),
      getRecentServiceMemories().catch(() => null),
      getServiceModelConfig().catch(() => null),
      getServiceModels().catch(() => null),
      getPerpetualBrainStatus().catch(() => null),
      getSystemResources().catch(() => null),
      getPerpetualTasks().catch(() => null),
      getPerpetualStrategyStatus().catch(() => null),
      getTradeAutoStatus().catch(() => null),
      getAixiSelfReport().catch(() => null),
      getSystemStorageInventory().catch(() => null),
      getSystemCapabilityInventory().catch(() => null),
      getProactiveEvents().catch(() => null),
      getDocumentProductionReport().catch(() => null),
    ]);
    setResearchTasks(tasks);
    setSystemBible(bibleResult);
    setServiceMemoryStats(statsResult);
    setRecentServiceMemories(recentResult);
    setServiceModelConfig(modelConfigResult);
    setServiceModels(modelsResult);
    setPerpetualStatus(brainResult);
    setSystemResources(resourcesResult);
    setPerpetualTasks(workerTasksResult);
    setStrategyStatus(strategyResult);
    setTradeAutoStatus(autoResult);
    setSelfReport(selfResult);
    setStorageInventory(storageInventoryResult);
    setCapabilityInventory(capabilityInventoryResult);
    setProactiveEventFeed(proactiveEventsResult);
    setDocumentReport(documentReportResult);
    setLastRefreshAt(new Date().toISOString());
    if (!silent) setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
    const interval = setInterval(() => void load(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]));

  const serviceDeclaresMemory = Boolean(systemBible?.services.includes("memory"));
  const serviceMemoryReady = serviceMemoryStats?.ok === true;
  const magicSkills = useMemo(() => buildMagicContractSkills({
    perpetual: perpetualStatus,
    resources: systemResources,
    tasks: perpetualTasks,
    strategy: strategyStatus,
    trade: tradeAutoStatus,
    memory: serviceMemoryStats,
    selfReport,
  }), [perpetualStatus, systemResources, perpetualTasks, strategyStatus, tradeAutoStatus, serviceMemoryStats, selfReport]);
  const goalOverview = useMemo(() => ({
    inProgress: researchTasks.filter((task) => task.status === "researching").length,
    blocked: researchTasks.filter((task) => task.status === "failed").length,
    completed: researchTasks.filter((task) => task.status === "saved").length,
    awaiting: researchTasks.filter((task) => task.indexState === "pending_n1_index").length,
  }), [researchTasks]);
  const activeWorkerTask = useMemo(() => perpetualTasks?.find((task) => task.state === "running") ?? null, [perpetualTasks]);
  const currentTaskLabel = activeWorkerTask?.title ?? perpetualStatus?.activeTaskId ?? "未回報";

  const startResearch = async () => {
    const cleanedTopic = topic.trim();
    if (!cleanedTopic || researching) return;
    haptic.light();
    setResearching(true);
    setError(null);
    const now = new Date().toISOString();
    const task: ResearchTask = {
      id: `${Date.now()}-research`,
      topic: cleanedTopic,
      objective: cleanedTopic,
      priority: "normal",
      acceptanceCriteria: "保存可追溯的研究摘要，並如實說明已使用或未使用的來源工具。",
      steps: ["建立研究範圍", "取得或聲明來源狀態", "整理摘要與未解問題"],
      dependencies: ["N1 受控研究工作者或既有對話服務"],
      sourceProvenance: "由主人在 ELSA 記憶中心指派",
      indexState: "local_only",
      status: "researching",
      createdAt: now,
      updatedAt: now,
    };
    await saveResearchTask(task);
    setResearchTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
    await appendActivityLog({ source: "memory", kind: "info", title: "艾西研究任務已送出", detail: cleanedTopic });

    try {
      const result = await askElsa(buildResearchPrompt(cleanedTopic));
      const completed: ResearchTask = { ...task, status: "saved", updatedAt: new Date().toISOString(), responseExcerpt: result.text.slice(0, 240), result: result.text, indexState: "pending_n1_index" };
      await saveResearchTask(completed);
      setResearchTasks((current) => [completed, ...current.filter((item) => item.id !== task.id)]);
      setTopic("");
      await appendActivityLog({ source: "memory", kind: "success", title: "艾西研究回覆已保存", detail: "已存為本機研究記憶；是否實際連網與來源清單以回覆內容為準。" });
      haptic.success();
    } catch (caught) {
      const message = errorMessage(caught);
      const failed: ResearchTask = { ...task, status: "failed", updatedAt: new Date().toISOString(), responseExcerpt: message };
      await saveResearchTask(failed);
      setResearchTasks((current) => [failed, ...current.filter((item) => item.id !== task.id)]);
      setError(message);
      await appendActivityLog({ source: "memory", kind: "error", title: "艾西研究任務失敗", detail: message });
      haptic.error();
    } finally {
      setResearching(false);
    }
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]} style={styles.screen}>
      <FlatList
        data={researchTasks}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={() => void load()}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <ResearchCard item={item} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenTitle title="記憶中心" subtitle="艾西的即時脈絡、技能契約與三機世界狀態。" />
            {error ? <InlineNotice type="error">{error}</InlineNotice> : null}

            <Card style={styles.characterCard}>
              <View style={styles.characterHeader}>
                <Image source={require("@/assets/images/persona/elsa-soft-portrait.webp")} style={styles.characterPortrait} contentFit="cover" />
                <View style={styles.characterCopy}>
                  <Text style={styles.eyebrow}>AIXI · LIVE CHARACTER SHEET</Text>
                  <Text style={styles.characterTitle}>艾西 · 永動腦脈絡</Text>
                  <Text style={styles.characterSubtitle}>只有 N1 回傳且通過契約驗證的狀態，才會映照成屬性與技能。</Text>
                </View>
                <StatusBadge state={perpetualStatus?.online ? "connected" : perpetualStatus ? "unknown" : "disconnected"} label={perpetualStatus?.online ? "連結中" : perpetualStatus ? "待命" : "未回報"} />
              </View>

              <View style={styles.characterStatusStrip}>
                <StatusStat icon="psychology" label="心智連結" value={perpetualStatus ? (perpetualStatus.online ? "運作中" : "待命") : "未回報"} detail={perpetualStatus?.loopState ?? "需要 online 契約"} tone={perpetualStatus?.online ? "accent" : "muted"} />
                <StatusStat icon="account-tree" label="記憶檔案" value={serviceMemoryReady ? `${serviceMemoryStats.total} 筆` : "未回報"} detail={serviceMemoryReady ? serviceMemoryStats.embed_model : "服務端記憶契約"} tone={serviceMemoryReady ? "primary" : "muted"} />
              </View>

              <View style={styles.resourceCluster}>
                <ResourceBar label="顯存" icon="memory" value={systemResources?.gpu ? `${systemResources.gpu.memoryUsedMb} / ${systemResources.gpu.memoryTotalMb} MB` : "未回報"} progress={systemResources?.gpu ? ratio(systemResources.gpu.memoryUsedMb, systemResources.gpu.memoryTotalMb) : null} hint={systemResources?.gpu?.name ?? "需 GET /api/system/resources"} tone="#9E8AFF" />
                <ResourceBar label="磁碟" icon="storage" value={systemResources ? `${systemResources.diskUsedGb.toFixed(1)} / ${systemResources.diskTotalGb.toFixed(1)} GB` : "未回報"} progress={systemResources ? ratio(systemResources.diskUsedGb, systemResources.diskTotalGb) : null} hint={systemResources ? `N1 擷取：${formatTime(systemResources.capturedAt)}` : "需明確遙測擷取時間"} tone="#59D7C1" />
                <ResourceBar label="任務負載" icon="pending-actions" value={systemResources ? `${systemResources.queueDepth} 排隊` : "未回報"} progress={null} hint={activeWorkerTask ? `進行中：${activeWorkerTask.title}` : `目前任務：${currentTaskLabel}`} tone="#F5BE65" />
              </View>
              <Text style={styles.syncNote}>前景每 30 秒刷新 · App 最近刷新：{formatTime(lastRefreshAt)} · 各區塊獨立降級為「未回報」。</Text>
            </Card>

            <Card style={styles.innerStateCard}>
              <View style={styles.cardHeading}>
                <View><Text style={styles.eyebrow}>AIXI · INNER STATE</Text><Text style={styles.cardTitle}>心語映照</Text></View>
                <StatusBadge state={selfReport ? "connected" : "unknown"} label={selfReport ? "已明確回報" : "未回報"} />
              </View>
              <Text style={styles.innerStateCopy}>這不是由角色設定、聊天內容或任務名稱推定的心情。只有 N1 自我回報契約或主人明確保存的內容才會顯示。</Text>
              <View style={styles.innerGrid}>
                <InnerStateField icon="mood" label="當下心情" value={selfReport?.currentMood ?? "未回報"} />
                <InnerStateField icon="center-focus-strong" label="專注焦點" value={selfReport?.currentFocus ?? "未回報"} />
                <InnerStateField icon="flag" label="近期意圖" value={selfReport?.nearTermIntent ?? "未回報"} />
              </View>
              <View style={styles.wishBox}><MaterialIcons name="auto-awesome" size={18} color="#F6B5DE" /><View style={styles.wishCopy}><Text style={styles.wishLabel}>長期願望</Text>{selfReport?.longTermWishes.length ? selfReport.longTermWishes.slice(0, 2).map((wish) => <Text key={wish} style={styles.wishText}>· {wish}</Text>) : <Text style={styles.wishText}>尚未由 `GET /api/ai/self-status` 回報。</Text>}</View></View>
              <Text style={styles.contractFootnote}>{selfReport ? `來源：${selfReport.source} · 回報：${formatTime(selfReport.reportedAt)}` : "預定契約：GET /api/ai/self-status；它只宣告脈絡，不能授權交易、SSH、Git 或 R2 寫入。"}</Text>
            </Card>

            <Card style={styles.skillTreeCard}>
              <View style={styles.cardHeading}>
                <View><Text style={styles.eyebrow}>API MAGIC CONTRACTS</Text><Text style={styles.cardTitle}>魔法契約技能樹</Text></View>
                <Text style={styles.skillTreeCount}>{magicSkills.filter((skill) => skill.state !== "unreported").length} / {magicSkills.length} 已映照</Text>
              </View>
              <Text style={styles.skillTreeCopy}>節點的「效果」是被允許顯示的真實能力，不是對 N1 的任意控制權；資料缺失會保持未覺醒。</Text>
              <View style={styles.skillTreeGrid}>{magicSkills.map((skill) => <ContractSkillCard key={skill.id} skill={skill} />)}</View>
            </Card>

            <Card style={styles.structureCard}>
              <View style={styles.cardHeading}>
                <View><Text style={styles.eyebrow}>SYSTEM STRUCTURE</Text><Text style={styles.cardTitle}>三機世界結構</Text></View>
                <StatusBadge state="connected" label="SSH 已驗證" />
              </View>
              <Text style={styles.structureCopy}>三台節點的 SSH 位置與金鑰驗證已由主人於 N1 實測確認。服務、儲存與能力細節仍必須以各節點的 API 盤點回報為準，不會因 SSH 可連就冒充服務已運行。</Text>
              <View style={styles.nodeRow}>{SYSTEM_TOPOLOGY_SNAPSHOT.nodes.map((node) => <View key={node.id} style={styles.nodeTile}><View style={[styles.nodeDot, node.status === "reported" ? styles.nodeDotReported : styles.nodeDotPending]} /><Text style={styles.nodeName}>{node.id}</Text><Text numberOfLines={1} style={styles.nodeRole}>{node.role}</Text><Text numberOfLines={2} style={styles.nodeServices}>{node.services.length ? node.services.join(" · ") : "服務：未回報"}</Text><Text style={styles.nodeAddress}>{node.address}</Text><Text style={styles.nodePort}>{node.sshPort === "—" ? "本機中心" : `SSH ${node.sshPort}`}</Text></View>)}</View>
              <View style={styles.flowPanel}><Text style={styles.flowLabel}>已知設計資料流</Text><View style={styles.flowRow}><FlowNode icon="psychology" label="永動腦" /><MaterialIcons name="arrow-forward" size={15} color="#7F88B1" /><FlowNode icon="account-tree" label="N1 記憶層" /><MaterialIcons name="arrow-forward" size={15} color="#7F88B1" /><FlowNode icon="cloud-queue" label="R2 封存" /><MaterialIcons name="arrow-forward" size={15} color="#7F88B1" /><FlowNode icon="query-stats" label="交易器" /></View><Text style={styles.flowNote}>這是結構宣告，不代表每一環正在執行或已完成同步。</Text></View>
              <View style={styles.structureMeta}><Text style={styles.structureMetaText}>結構版本：{systemBible?.version ?? "未回報"}</Text><Text style={styles.structureMetaText}>SSH 實測：{formatTime(SYSTEM_TOPOLOGY_SNAPSHOT.reportedAt)}</Text></View>
            </Card>

            <CapabilityMapCard storageInventory={storageInventory} capabilityInventory={capabilityInventory} />

            <AixiStatusPostcard selfReport={selfReport} perpetualStatus={perpetualStatus} activeTask={activeWorkerTask} proactiveEvent={proactiveEventFeed?.events.find((event) => event.kind === "status_card") ?? null} />

            <ProactiveInboxCard feed={proactiveEventFeed} />

            <DocumentWorkflowCard report={documentReport} />

            <MultiPlatformControlCard />

            <Card style={styles.operationCard}>
              <View style={styles.cardHeading}><View><Text style={styles.eyebrow}>LIVE OPERATION</Text><Text style={styles.cardTitle}>永動腦與策略生命週期</Text></View><StatusBadge state={strategyStatus ? "connected" : "unknown"} label={strategyStatus?.executorState ?? "未回報"} /></View>
              <OperationLine label="目前工作" value={activeWorkerTask?.title ?? "未回報"} detail={activeWorkerTask?.currentStep ?? (perpetualStatus?.activeTaskId ? `活動 ID：${perpetualStatus.activeTaskId}` : "未偵測到受控工作者任務")} />
              <OperationLine label="策略候選" value={strategyStatus?.candidateVersion ?? "未回報"} detail={strategyStatus?.developmentTask?.title ?? "策略開發任務未回報"} />
              <OperationLine label="已部署版本" value={strategyStatus?.deployedVersion ?? "未回報"} detail={`風控：${strategyStatus?.riskGuardState ?? "未回報"}`} />
              <OperationLine label="自主交易" value={tradeAutoStatus ? (tradeAutoStatus.active ? "啟用中" : "待命") : "未回報"} detail={tradeAutoStatus ? `週期 ${tradeAutoStatus.cycles} · ${tradeAutoStatus.last || "尚無最近訊號"}` : "需 GET /trade/auto/status"} />
            </Card>

            <Card style={styles.goalCard}>
              <View style={styles.goalHeading}><View><Text style={styles.eyebrow}>GOALS & TODO</Text><Text style={styles.cardTitle}>主人指派與目標脈絡</Text></View><MaterialIcons name="checklist" size={27} color="#79E3D0" /></View>
              <Text style={styles.goalCopy}>以下僅統計本機已保存研究。N1 工作者未回報時，不會將本機筆記升格為永動腦的已執行任務。</Text>
              <View style={styles.goalMetrics}><GoalMetric label="進行中" value={goalOverview.inProgress} tone="#BDAFFF" /><GoalMetric label="受阻" value={goalOverview.blocked} tone="#FF9A9A" /><GoalMetric label="等索引" value={goalOverview.awaiting} tone="#F7C76B" /><GoalMetric label="已完成" value={goalOverview.completed} tone="#79E3D0" /></View>
              <View style={styles.tierRow}><MaterialIcons name="storage" size={18} color="#BFC8FF" /><View style={styles.tierCopy}><Text style={styles.tierTitle}>N1／R2 記憶分層</Text><Text style={styles.tierDetail}>本機研究已保存；N1 索引與 R2 封存需由受控工作者回報，現在尚未宣稱已同步。</Text></View></View>
            </Card>

            <Card style={styles.serviceCard}>
              <View style={styles.cardHeading}><View><Text style={styles.eyebrow}>SERVICE MEMORY</Text><Text style={styles.cardTitle}>服務端長期記憶</Text></View><StatusBadge state={serviceMemoryReady ? "connected" : serviceDeclaresMemory ? "unknown" : "disconnected"} label={serviceMemoryReady ? `${serviceMemoryStats.total} 筆可讀取` : serviceDeclaresMemory ? "路由未回應" : "未宣告 memory"} /></View>
              <Text style={styles.serviceCopy}>{serviceMemoryReady ? `後端：${serviceMemoryStats.backend}；嵌入模型：${serviceMemoryStats.embed_model}；活躍記憶 ${serviceMemoryStats.active} 筆、深層記憶 ${serviceMemoryStats.deep} 筆。以下僅列出服務端實際回傳的近期內容。` : "尚未從服務取得長期記憶資料；本機研究與服務端記憶會清楚分開顯示。"}</Text>
              {recentServiceMemories?.ok && recentServiceMemories.memories.length ? <View style={styles.serviceMemoryList}>{recentServiceMemories.memories.slice(0, 3).map((memory) => <View key={memory.id} style={styles.serviceMemoryRow}><View style={styles.serviceMemoryKind}><Text style={styles.serviceMemoryKindText}>{memory.kind}</Text></View><Text numberOfLines={2} style={styles.serviceMemoryContent}>{memory.content}</Text></View>)}</View> : serviceMemoryReady ? <Text style={styles.serviceMemoryEmpty}>服務端未回傳可顯示的近期記憶內容。</Text> : null}
              {serviceModelConfig ? <View style={styles.modelContext}><View style={styles.modelContextTop}><Text style={styles.modelContextTitle}>模型裝備欄</Text><Text style={styles.modelContextCount}>{serviceModels ? `${serviceModels.models.length} 個模型` : "模型清單未取得"}</Text></View><ModelLine label="對話" value={serviceModelConfig.models.chat} /><ModelLine label="預設" value={serviceModelConfig.models.default} /><ModelLine label="編碼" value={serviceModelConfig.models.autocoder} /><ModelLine label="嵌入" value={serviceModelConfig.models.embedding} /></View> : null}
            </Card>

            <Card style={styles.researchComposer}>
              <View style={styles.composerHeading}><View style={styles.composerIcon}><MaterialIcons name="travel-explore" size={21} color="#79E3D0" /></View><View style={styles.composerCopy}><Text style={styles.composerTitle}>讓艾西研究並記住</Text><Text style={styles.composerSubtitle}>請她找文章或影片、列出來源、整理筆記。未確認有連網工具時，她必須在回覆中明說。</Text></View></View>
              <TextInput value={topic} onChangeText={setTopic} placeholder="例如：研究 RSI 與趨勢濾網在 BTC 15m 的實作與風險" placeholderTextColor="#7E8796" multiline style={styles.topicInput} returnKeyType="send" onSubmitEditing={() => void startResearch()} />
              <PrimaryButton label="交給艾西研究" icon="search" loading={researching} disabled={!topic.trim()} onPress={() => void startResearch()} />
            </Card>
            <Text style={styles.sectionLabel}>已保存研究</Text>
          </View>
        }
        ListEmptyComponent={loading ? <ActivityIndicator color={palette.primary} /> : <EmptyState icon="menu-book" title="尚無保存的研究筆記" detail="指派研究任務後，艾西的回覆與來源聲明會保存在這裡；未確認連網時不會標示成已抓取來源。" />}
      />
    </ScreenContainer>
  );
}

function StatusStat({ icon, label, value, detail, tone }: { icon: "psychology" | "account-tree"; label: string; value: string; detail: string; tone: "accent" | "primary" | "muted" }) {
  const color = tone === "accent" ? palette.accent : tone === "primary" ? "#BDAFFF" : palette.muted;
  return <View style={styles.statusStat}><MaterialIcons name={icon} size={17} color={color} /><View style={styles.statusStatCopy}><Text style={styles.statusStatLabel}>{label}</Text><Text style={[styles.statusStatValue, { color }]}>{value}</Text><Text numberOfLines={1} style={styles.statusStatDetail}>{detail}</Text></View></View>;
}

function ResourceBar({ label, icon, value, progress, hint, tone }: { label: string; icon: "memory" | "storage" | "pending-actions"; value: string; progress: number | null; hint: string; tone: string }) {
  return <View style={styles.resourceBar}><View style={styles.resourceTop}><View style={styles.resourceLabelRow}><MaterialIcons name={icon} size={16} color={tone} /><Text style={styles.resourceLabel}>{label}</Text></View><Text style={styles.resourceValue}>{value}</Text></View>{progress === null ? <View style={styles.resourceUnavailableBar}><View style={[styles.resourceUnavailableFill, { backgroundColor: tone }]} /></View> : <View style={styles.resourceTrack}><View style={[styles.resourceFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: tone }]} /></View>}<Text numberOfLines={1} style={styles.resourceHint}>{hint}</Text></View>;
}

function InnerStateField({ icon, label, value }: { icon: "mood" | "center-focus-strong" | "flag"; label: string; value: string }) {
  return <View style={styles.innerField}><MaterialIcons name={icon} size={17} color="#F6B5DE" /><Text style={styles.innerFieldLabel}>{label}</Text><Text numberOfLines={2} style={styles.innerFieldValue}>{value}</Text></View>;
}

function ContractSkillCard({ skill }: { skill: MagicContractSkill }) {
  const meta = skillStateMeta(skill.state);
  return <View style={[styles.skillNode, { borderColor: meta.border }]}><View style={styles.skillNodeTop}><View style={[styles.skillIcon, { backgroundColor: meta.background }]}><MaterialIcons name={skill.icon} size={18} color={meta.color} /></View><View style={styles.skillStateRow}><View style={[styles.skillStateDot, { backgroundColor: meta.color }]} /><Text style={[styles.skillStateText, { color: meta.color }]}>{meta.label}</Text></View></View><Text style={styles.skillBranch}>{skill.branch} 系</Text><Text style={styles.skillTitle}>{skill.title}</Text><Text numberOfLines={3} style={styles.skillEffect}>{skill.effect}</Text><Text numberOfLines={1} style={styles.skillApi}>{skill.api}</Text><Text style={styles.skillAccess}>{skill.access} · 寫入須另走 N1 確認契約</Text><Text style={styles.skillTime}>{skill.verifiedAt ? `驗證：${formatTime(skill.verifiedAt)}` : "尚無可驗證時間"}</Text></View>;
}

function FlowNode({ icon, label }: { icon: "psychology" | "account-tree" | "cloud-queue" | "query-stats"; label: string }) {
  return <View style={styles.flowNode}><MaterialIcons name={icon} size={15} color="#BFB5FF" /><Text style={styles.flowNodeText}>{label}</Text></View>;
}

function OperationLine({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <View style={styles.operationLine}><Text style={styles.operationLabel}>{label}</Text><View style={styles.operationCopy}><Text numberOfLines={1} style={styles.operationValue}>{value}</Text><Text numberOfLines={2} style={styles.operationDetail}>{detail}</Text></View></View>;
}

function CapabilityMapCard({ storageInventory, capabilityInventory }: { storageInventory: SystemStorageInventory | null; capabilityInventory: SystemCapabilityInventory | null }) {
  const storageNodes = storageInventory?.nodes ?? [];
  const capabilityNodes = capabilityInventory?.nodes ?? [];
  const reportedNodes = new Set([...storageNodes, ...capabilityNodes].filter((node) => node.reportState === "reported").map((node) => node.nodeId));
  const mapAvailable = storageInventory !== null || capabilityInventory !== null;

  return <Card style={styles.capabilityMapCard}>
    <View style={styles.cardHeading}>
      <View><Text style={styles.eyebrow}>CAPABILITY ASSET MAP</Text><Text style={styles.cardTitle}>三機能力地圖</Text></View>
      <StatusBadge state={reportedNodes.size ? "connected" : "unknown"} label={mapAvailable ? `${reportedNodes.size} / 3 節點回報` : "未回報"} />
    </View>
    <Text style={styles.capabilityMapCopy}>只使用 N1 彙整的容量、來源與資產計數。這裡的「候選」代表需要驗證的可重用或待補完資產，不等同艾西已能使用的能力。</Text>
    {(["N1", "N2", "N3"] as const).map((nodeId) => <CapabilityNodeCard key={nodeId} storage={storageNodes.find((node) => node.nodeId === nodeId) ?? null} capability={capabilityNodes.find((node) => node.nodeId === nodeId) ?? null} />)}
    <Text style={styles.capabilityMapFootnote}>{mapAvailable ? `儲存回報：${formatTime(storageInventory?.capturedAt)} · 能力回報：${formatTime(capabilityInventory?.capturedAt)}` : "需先由 N1 安裝並執行三機唯讀盤點；App 不會自行掃描手機、Root、Vault 或遠端檔案。"}</Text>
  </Card>;
}

function CapabilityNodeCard({ storage, capability }: { storage: StorageInventoryNode | null; capability: CapabilityInventoryNode | null }) {
  const nodeId = storage?.nodeId ?? capability?.nodeId ?? "N1";
  const reportState = storage?.reportState ?? capability?.reportState ?? "unreported";
  const volume = storage?.volumes.reduce<StorageInventoryNode["volumes"][number] | null>((largest, item) => !largest || item.totalBytes > largest.totalBytes ? item : largest, null) ?? null;
  const sources = storage?.importSources.filter((source) => source.state === "available").map((source) => source.label).slice(0, 3) ?? [];
  const reusable = capability?.candidateCounts.reuse_candidate ?? 0;
  const completion = capability?.candidateCounts.completion_candidate ?? 0;
  const assets = sumCounts(capability?.assetCounts);
  const services = capability?.serviceSignals.filter((signal) => signal.state === "online" || signal.state === "running").map((signal) => signal.name).slice(0, 2) ?? [];
  const detail = storage?.errorSummary ?? capability?.errorSummary;

  return <View style={[styles.capabilityNodeRow, { borderColor: reportState === "reported" ? "#2C655D" : "#3D4352" }]}>
    <View style={styles.capabilityNodeTop}><View style={styles.capabilityNodeNameWrap}><View style={[styles.nodeDot, reportState === "reported" ? styles.nodeDotReported : styles.nodeDotPending]} /><Text style={styles.capabilityNodeName}>{nodeId}</Text><Text style={styles.capabilityNodeMeta}>{storage?.hostname ?? "裝置未回報"}</Text></View><Text style={[styles.capabilityNodeState, { color: reportState === "reported" ? palette.accent : reportState === "stale" ? palette.warning : palette.muted }]}>{inventoryStateLabel(reportState)}</Text></View>
    <View style={styles.capabilityMetrics}>
      <CapabilityMetric label="最大掛載卷" value={volume ? `${formatBytes(volume.usedBytes)} / ${formatBytes(volume.totalBytes)}` : "未回報"} detail={volume ? `${volume.mountPath} · ${volume.usagePercent === null ? "用量未回報" : `${volume.usagePercent.toFixed(0)}%`}` : "尚無磁碟契約"} tone="#61D8C1" />
      <CapabilityMetric label="資產候選" value={capability ? `${assets} 項彙整` : "未回報"} detail={capability?.scan.truncated ? "盤點已截斷；不代表完整清單" : capability ? `可重用 ${reusable} · 待補完 ${completion}` : "尚無能力盤點"} tone="#BDAFFF" />
    </View>
    <Text numberOfLines={2} style={styles.capabilityNodeDetail}>匯入來源：{sources.length ? sources.join(" · ") : "未回報"}{services.length ? `\n工作服務：${services.join(" · ")}` : ""}{detail ? `\n回報：${detail}` : ""}</Text>
  </View>;
}

function CapabilityMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return <View style={styles.capabilityMetric}><Text style={styles.capabilityMetricLabel}>{label}</Text><Text numberOfLines={1} style={[styles.capabilityMetricValue, { color: tone }]}>{value}</Text><Text numberOfLines={2} style={styles.capabilityMetricDetail}>{detail}</Text></View>;
}

function AixiStatusPostcard({ selfReport, perpetualStatus, activeTask, proactiveEvent }: { selfReport: AixiSelfReport | null; perpetualStatus: PerpetualBrainStatus | null; activeTask: PerpetualTask | null; proactiveEvent: ProactiveEvent | null }) {
  const currentWork = activeTask?.currentStep ?? activeTask?.title ?? proactiveEvent?.title ?? "未回報";
  const source = proactiveEvent ? `主動事件：${proactiveEvent.eventId}` : activeTask ? `工作者任務：${activeTask.taskId}` : selfReport ? `自我回報：${selfReport.source}` : perpetualStatus?.lastHeartbeat ? `永動腦心跳：${formatTime(perpetualStatus.lastHeartbeat)}` : "尚無主動事件回報";
  const statusState = activeTask || selfReport || proactiveEvent ? "connected" : "unknown";
  const mood = selfReport?.currentMood ?? "未回報表情";

  return <Card style={styles.statusPostcard}>
    <View style={styles.cardHeading}><View><Text style={styles.eyebrow}>AIXI · PROACTIVE STATUS</Text><Text style={styles.cardTitle}>艾西此刻的狀態卡</Text></View><StatusBadge state={statusState} label={activeTask || selfReport ? "有明確來源" : "未回報"} /></View>
    <View style={styles.statusPostcardBody}>
      <View style={styles.statusPortraitFrame}><Image source={proactiveEvent?.visual?.imageUrl ? { uri: proactiveEvent.visual.imageUrl } : require("@/assets/images/persona/elsa-soft-portrait.webp")} style={styles.statusPortrait} contentFit="cover" /><View style={styles.statusExpression}><MaterialIcons name={proactiveEvent?.visual?.imageUrl ? "auto-awesome" : "face-2"} size={16} color="#FFC3E4" /></View></View>
      <View style={styles.statusPostcardCopy}><Text style={styles.statusMood}>{mood}</Text><Text numberOfLines={2} style={styles.statusWork}>現在：{currentWork}</Text><Text numberOfLines={2} style={styles.statusIntent}>下一步：{selfReport?.nearTermIntent ?? proactiveEvent?.body ?? "未回報"}</Text></View>
    </View>
    <Text style={styles.statusPostcardFootnote}>來源：{source}{proactiveEvent ? ` · 觸發：${proactiveEvent.trigger}` : ""}{proactiveEvent?.visual?.imageUrl ? ` · 角色參考：${proactiveEvent.visual.characterReferenceVersion ?? "未回報"}` : ""}。人物圖是狀態卡視覺；它不等同任務證據。心情與意圖只取自 N1 明確自我回報。</Text>
  </Card>;
}

function ProactiveInboxCard({ feed }: { feed: ProactiveEventFeed | null }) {
  const events = feed?.events.slice(0, 4) ?? [];
  return <Card style={styles.proactiveInboxCard}>
    <View style={styles.cardHeading}><View><Text style={styles.eyebrow}>PERPETUAL BRAIN · INBOX</Text><Text style={styles.cardTitle}>艾西主動收件匣</Text></View><StatusBadge state={feed ? "connected" : "unknown"} label={feed ? `${events.length} 則最新事件` : "未回報"} /></View>
    <Text style={styles.proactiveInboxCopy}>只有 N1 永動腦明確寫入、附帶來源與觸發原因的事件會顯示。一般聊天回覆不會被轉成「艾西主動傳訊」。</Text>
    {events.length ? <View style={styles.inboxEventList}>{events.map((event) => <ProactiveEventRow key={event.eventId} event={event} />)}</View> : <InlineNotice type="info">尚未收到 N1 永動腦的主動事件。啟用事件路由後，系統報告、對話邀請與狀態卡會在前景同步顯示。</InlineNotice>}
    <Text style={styles.proactiveInboxFootnote}>{feed ? `來源：${feed.source} · 擷取：${formatTime(feed.capturedAt)}` : "預定路由：GET /api/perpetual/events"}</Text>
  </Card>;
}

function ProactiveEventRow({ event }: { event: ProactiveEvent }) {
  const meta = proactiveEventMeta(event);
  return <View style={[styles.inboxEventRow, { borderColor: meta.border }]}>
    <View style={[styles.inboxEventIcon, { backgroundColor: meta.background }]}><MaterialIcons name={meta.icon} size={18} color={meta.color} /></View>
    <View style={styles.inboxEventCopy}><View style={styles.inboxEventTop}><Text numberOfLines={1} style={styles.inboxEventTitle}>{event.title}</Text><Text style={[styles.inboxEventSeverity, { color: meta.color }]}>{meta.label}</Text></View>{event.visual?.imageUrl ? <Image source={{ uri: event.visual.imageUrl }} style={styles.inboxVisualImage} contentFit="cover" /> : null}<Text numberOfLines={3} style={styles.inboxEventBody}>{event.body}</Text><Text numberOfLines={2} style={styles.inboxEventMeta}>觸發：{event.trigger} · {formatTime(event.createdAt)}</Text>{event.visual ? <View style={styles.inboxVisualChip}><MaterialIcons name="image" size={12} color="#F3B6DD" /><Text numberOfLines={1} style={styles.inboxVisualText}>{event.visual.label} · {event.visual.imageUrl ? "新生成視覺" : "視覺化狀態"}</Text></View> : null}</View>
  </View>;
}

function GoalMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <View style={styles.goalMetric}><Text style={[styles.goalMetricValue, { color: tone }]}>{value}</Text><Text style={styles.goalMetricLabel}>{label}</Text></View>;
}

function ModelLine({ label, value }: { label: string; value: string }) {
  return <View style={styles.modelLine}><Text style={styles.modelLineLabel}>{label}</Text><Text numberOfLines={1} style={styles.modelLineValue}>{value || "服務未回傳"}</Text></View>;
}

function ResearchCard({ item }: { item: ResearchTask }) {
  const state = item.status === "saved" ? "connected" : item.status === "failed" ? "disconnected" : "unknown";
  const label = item.status === "saved" ? "已保存" : item.status === "failed" ? "未完成" : "處理中";
  const indexLabel = item.indexState === "indexed_n1" ? "N1 已索引" : item.indexState === "archived_r2" ? "R2 已封存" : item.indexState === "pending_n1_index" ? "待 N1 索引" : "僅本機";
  return <Card style={styles.researchCard}><View style={styles.researchHeader}><View style={styles.researchIcon}><MaterialIcons name={item.status === "saved" ? "bookmark-added" : item.status === "failed" ? "error-outline" : "pending"} size={19} color={item.status === "saved" ? palette.accent : item.status === "failed" ? palette.error : palette.muted} /></View><View style={styles.researchTitleWrap}><Text style={styles.researchTitle}>{item.topic}</Text><Text style={styles.researchTime}>{formatTime(item.updatedAt)}</Text></View><StatusBadge state={state} label={label} /></View><View style={styles.taskMeta}><Text style={styles.taskMetaText}>目標：{item.objective ?? item.topic}</Text><Text style={styles.taskMetaText}>優先級：{priorityLabel(item.priority)} · {indexLabel}</Text>{item.acceptanceCriteria ? <Text numberOfLines={2} style={styles.taskMetaText}>完成條件：{item.acceptanceCriteria}</Text> : null}</View>{item.result ? <Text numberOfLines={5} style={styles.researchResult}>{item.result}</Text> : item.responseExcerpt ? <Text numberOfLines={3} style={styles.researchResult}>{item.responseExcerpt}</Text> : <Text style={styles.researchResult}>等待艾西回覆與來源聲明。</Text>}</Card>;
}

function skillStateMeta(state: MagicContractSkill["state"]) {
  if (state === "active") return { label: "映照中", color: "#62E0C5", border: "#326D61", background: "#153D36" };
  if (state === "ready") return { label: "已覺醒", color: "#BDAFFF", border: "#574B91", background: "#29234D" };
  if (state === "standby") return { label: "待命", color: "#F0C36B", border: "#6B5730", background: "#362B16" };
  return { label: "未回報", color: "#838B9A", border: "#323846", background: "#171B25" };
}

function priorityLabel(priority?: ResearchTask["priority"]): string {
  if (priority === "critical") return "最高";
  if (priority === "high") return "高";
  if (priority === "low") return "低";
  return "一般";
}

function buildResearchPrompt(topic: string): string {
  return [
    "請建立可保存到 ELSA 記憶中心的研究筆記。",
    `研究主題：${topic}`,
    "如你具備受控的網路搜尋、文章讀取或影片轉錄工具，請查找可信文章與影片，列出每一個實際使用來源的標題與 URL，再摘要重要觀點、適用條件與未解問題。",
    "如目前沒有可使用的連網或影片工具，請直接說明未能連網，並只根據既有上下文提出研究規劃；不得虛構來源、觀看過的影片或已保存到桌機端記憶。",
    "這個任務只產生研究筆記，不可下單、改寫策略、修改 Git 或使用 SSH。",
  ].join("\n");
}

function ratio(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(Math.max(value / total, 0), 1);
}

function sumCounts(values?: Record<string, number>): number {
  return values ? Object.values(values).reduce((total, value) => total + value, 0) : 0;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "未回報";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)} MB`;
  return `${value.toFixed(0)} B`;
}

function inventoryStateLabel(state: StorageInventoryNode["reportState"]): string {
  if (state === "reported") return "已回報";
  if (state === "stale") return "回報過期";
  if (state === "probe_failed") return "巡檢失敗";
  return "未回報";
}

function proactiveEventMeta(event: ProactiveEvent) {
  if (event.severity === "error") return { label: "錯誤", color: "#FF8D8D", border: "#693C45", background: "#3B1C25", icon: "error-outline" as const };
  if (event.severity === "warning") return { label: "注意", color: "#F8C86E", border: "#6D5733", background: "#3B2C15", icon: "warning-amber" as const };
  if (event.kind === "chat_invite") return { label: "邀請", color: "#F3B6DD", border: "#704761", background: "#3C1D35", icon: "forum" as const };
  if (event.kind === "status_card") return { label: "狀態", color: "#CBB9FF", border: "#5A4E8A", background: "#282248", icon: "face-2" as const };
  return { label: event.verificationState === "verified" ? "已驗證" : "已回報", color: "#69DEC4", border: "#326D61", background: "#153D36", icon: "description" as const };
}

function formatTime(iso?: string | null): string {
  if (!iso) return "未回報";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "時間未知";
  return date.toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#040508" },
  list: { flexGrow: 1, paddingBottom: 28, gap: 10 },
  header: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  eyebrow: { color: "#B7ABFF", fontSize: 10, lineHeight: 15, letterSpacing: 0.9, fontWeight: "700" },
  characterCard: { gap: 12, backgroundColor: "#15142A", borderColor: "#595292" },
  characterHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  characterPortrait: { width: 58, height: 58, borderRadius: 20, backgroundColor: "#252143" },
  characterCopy: { flex: 1 },
  characterTitle: { color: palette.text, fontSize: 18, lineHeight: 24, fontWeight: "800", marginTop: 1 },
  characterSubtitle: { color: "#C6C7DD", fontSize: 10, lineHeight: 15, marginTop: 2 },
  characterStatusStrip: { flexDirection: "row", gap: 8 },
  statusStat: { flex: 1, minHeight: 75, flexDirection: "row", gap: 8, padding: 9, borderRadius: 13, borderWidth: 1, borderColor: "#35335B", backgroundColor: "#0D0F1C" },
  statusStatCopy: { flex: 1 },
  statusStatLabel: { color: "#A5AEC7", fontSize: 9, lineHeight: 13, fontWeight: "700" },
  statusStatValue: { fontSize: 13, lineHeight: 18, fontWeight: "800", marginTop: 1 },
  statusStatDetail: { color: palette.muted, fontSize: 9, lineHeight: 13, marginTop: 2 },
  resourceCluster: { gap: 8 },
  resourceBar: { gap: 4, padding: 9, borderRadius: 12, backgroundColor: "#0D0F1C", borderWidth: 1, borderColor: "#303650" },
  resourceTop: { flexDirection: "row", justifyContent: "space-between", gap: 8, alignItems: "center" },
  resourceLabelRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  resourceLabel: { color: "#B9C1D4", fontSize: 10, lineHeight: 15, fontWeight: "700" },
  resourceValue: { color: palette.text, fontSize: 10, lineHeight: 15, fontWeight: "700" },
  resourceTrack: { height: 5, borderRadius: 5, overflow: "hidden", backgroundColor: "#252A3B" },
  resourceFill: { height: "100%", borderRadius: 5 },
  resourceUnavailableBar: { height: 5, borderRadius: 5, overflow: "hidden", backgroundColor: "#252A3B" },
  resourceUnavailableFill: { height: "100%", width: "25%", borderRadius: 5, opacity: 0.36 },
  resourceHint: { color: palette.muted, fontSize: 9, lineHeight: 13 },
  syncNote: { color: "#8F98B0", fontSize: 9, lineHeight: 14 },
  innerStateCard: { gap: 10, backgroundColor: "#261524", borderColor: "#694260" },
  cardHeading: { flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "flex-start" },
  cardTitle: { color: palette.text, fontSize: 17, lineHeight: 23, fontWeight: "800", marginTop: 2 },
  innerStateCopy: { color: "#E0BFD7", fontSize: 11, lineHeight: 17 },
  innerGrid: { flexDirection: "row", gap: 7 },
  innerField: { flex: 1, minHeight: 96, gap: 3, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: "#593C54", backgroundColor: "#1B101B" },
  innerFieldLabel: { color: "#DAB6D2", fontSize: 9, lineHeight: 13, fontWeight: "700" },
  innerFieldValue: { color: "#F0DFEB", fontSize: 10, lineHeight: 15, fontWeight: "700" },
  wishBox: { flexDirection: "row", gap: 8, padding: 10, borderRadius: 12, backgroundColor: "#1B101B" },
  wishCopy: { flex: 1, gap: 2 },
  wishLabel: { color: "#F6B5DE", fontSize: 10, lineHeight: 14, fontWeight: "800" },
  wishText: { color: "#E0C6D9", fontSize: 10, lineHeight: 15 },
  contractFootnote: { color: "#C29DBA", fontSize: 9, lineHeight: 14 },
  skillTreeCard: { gap: 10, backgroundColor: "#141728", borderColor: "#49527C" },
  skillTreeCount: { color: "#BFC8FF", fontSize: 10, lineHeight: 15, fontWeight: "700", paddingTop: 3 },
  skillTreeCopy: { color: "#BFC5D6", fontSize: 11, lineHeight: 17 },
  skillTreeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  skillNode: { width: "48.7%", minHeight: 194, gap: 4, padding: 9, borderRadius: 13, borderWidth: 1, backgroundColor: "#0D101C" },
  skillNodeTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  skillIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  skillStateRow: { flexDirection: "row", gap: 3, alignItems: "center" },
  skillStateDot: { width: 6, height: 6, borderRadius: 6 },
  skillStateText: { fontSize: 8, lineHeight: 12, fontWeight: "700" },
  skillBranch: { color: "#8D97B2", fontSize: 8, lineHeight: 12, marginTop: 2, fontWeight: "700" },
  skillTitle: { color: palette.text, fontSize: 13, lineHeight: 18, fontWeight: "800" },
  skillEffect: { flex: 1, color: "#B8C0D5", fontSize: 9, lineHeight: 14 },
  skillApi: { color: "#919BB8", fontSize: 8, lineHeight: 12 },
  skillAccess: { color: "#BFC8FF", fontSize: 8, lineHeight: 12 },
  skillTime: { color: "#717B95", fontSize: 8, lineHeight: 12 },
  structureCard: { gap: 10, backgroundColor: "#111A28", borderColor: "#35516D" },
  structureCopy: { color: "#B9CBDC", fontSize: 11, lineHeight: 17 },
  nodeRow: { flexDirection: "row", gap: 7 },
  nodeTile: { flex: 1, minHeight: 111, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: "#30425A", backgroundColor: "#0B111B" },
  nodeDot: { width: 7, height: 7, borderRadius: 7, marginBottom: 4 },
  nodeDotReported: { backgroundColor: palette.accent },
  nodeDotPending: { backgroundColor: palette.warning },
  nodeName: { color: palette.text, fontSize: 13, lineHeight: 18, fontWeight: "800" },
  nodeRole: { color: "#B8C0D8", fontSize: 9, lineHeight: 13, marginTop: 1 },
  nodeServices: { color: "#D2D8E6", fontSize: 8, lineHeight: 12, marginTop: 3 },
  nodeAddress: { color: palette.muted, fontSize: 8, lineHeight: 12, marginTop: 4 },
  nodePort: { color: "#C6C9D7", fontSize: 8, lineHeight: 12 },
  flowPanel: { gap: 7, padding: 10, borderRadius: 12, backgroundColor: "#0B111B", borderWidth: 1, borderColor: "#30425A" },
  flowLabel: { color: "#BFC8FF", fontSize: 10, lineHeight: 15, fontWeight: "800" },
  flowRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 2 },
  flowNode: { width: 50, alignItems: "center", gap: 2 },
  flowNodeText: { color: "#C4CBDB", fontSize: 8, lineHeight: 11, textAlign: "center" },
  flowNote: { color: "#8E9AB0", fontSize: 9, lineHeight: 14 },
  structureMeta: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  structureMetaText: { flex: 1, color: "#8E9AB0", fontSize: 9, lineHeight: 13 },
  capabilityMapCard: { gap: 10, backgroundColor: "#101E20", borderColor: "#2C655D" },
  capabilityMapCopy: { color: "#BCD2CF", fontSize: 11, lineHeight: 17 },
  capabilityNodeRow: { gap: 7, padding: 10, borderWidth: 1, borderRadius: 13, backgroundColor: "#091315" },
  capabilityNodeTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  capabilityNodeNameWrap: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  capabilityNodeName: { color: palette.text, fontSize: 13, lineHeight: 18, fontWeight: "800" },
  capabilityNodeMeta: { color: "#A5B9B7", fontSize: 9, lineHeight: 13, flex: 1 },
  capabilityNodeState: { fontSize: 9, lineHeight: 13, fontWeight: "800" },
  capabilityMetrics: { flexDirection: "row", gap: 7 },
  capabilityMetric: { flex: 1, minHeight: 62, gap: 1, padding: 7, borderRadius: 10, backgroundColor: "#0D1A1D", borderWidth: 1, borderColor: "#24484A" },
  capabilityMetricLabel: { color: "#A4BEBB", fontSize: 8, lineHeight: 12, fontWeight: "700" },
  capabilityMetricValue: { fontSize: 10, lineHeight: 15, fontWeight: "800" },
  capabilityMetricDetail: { color: "#91AAA8", fontSize: 8, lineHeight: 12 },
  capabilityNodeDetail: { color: "#ADBFBD", fontSize: 9, lineHeight: 14 },
  capabilityMapFootnote: { color: "#8CA29F", fontSize: 9, lineHeight: 14 },
  statusPostcard: { gap: 10, backgroundColor: "#231226", borderColor: "#70486C" },
  statusPostcardBody: { flexDirection: "row", gap: 11, alignItems: "center", padding: 10, borderRadius: 13, backgroundColor: "#160C18", borderWidth: 1, borderColor: "#573654" },
  statusPortraitFrame: { width: 72, height: 72, borderRadius: 18, overflow: "hidden", backgroundColor: "#39223B", position: "relative" },
  statusPortrait: { width: "100%", height: "100%" },
  statusExpression: { position: "absolute", right: 5, bottom: 5, width: 26, height: 26, borderRadius: 13, backgroundColor: "#492744", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#8A5C82" },
  statusPostcardCopy: { flex: 1, gap: 3 },
  statusMood: { color: "#FFC3E4", fontSize: 14, lineHeight: 19, fontWeight: "800" },
  statusWork: { color: "#F0DFEB", fontSize: 10, lineHeight: 15 },
  statusIntent: { color: "#D9BBD5", fontSize: 10, lineHeight: 15 },
  statusPostcardFootnote: { color: "#D0ABCA", fontSize: 9, lineHeight: 14 },
  operationCard: { gap: 8, backgroundColor: "#171A27", borderColor: "#4B4D71" },
  operationLine: { flexDirection: "row", gap: 10, padding: 9, borderRadius: 11, backgroundColor: "#0D0F18" },
  operationLabel: { width: 62, color: "#9FA9C5", fontSize: 10, lineHeight: 15, fontWeight: "700" },
  operationCopy: { flex: 1 },
  operationValue: { color: palette.text, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  operationDetail: { color: palette.muted, fontSize: 9, lineHeight: 14, marginTop: 1 },
  goalCard: { gap: 11, backgroundColor: "#101C20", borderColor: "#23534D" },
  goalHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  goalCopy: { color: "#B7C5C8", fontSize: 11, lineHeight: 17 },
  goalMetrics: { flexDirection: "row", gap: 7 },
  goalMetric: { flex: 1, minHeight: 56, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#0A1317", borderWidth: 1, borderColor: "#28434A" },
  goalMetricValue: { fontSize: 16, lineHeight: 21, fontWeight: "800" },
  goalMetricLabel: { color: "#A6B9BC", fontSize: 9, lineHeight: 14, marginTop: 1 },
  tierRow: { flexDirection: "row", gap: 9, alignItems: "flex-start", padding: 10, borderRadius: 12, backgroundColor: "#0A1317" },
  tierCopy: { flex: 1, gap: 2 },
  tierTitle: { color: "#D1E8E5", fontSize: 11, lineHeight: 16, fontWeight: "700" },
  tierDetail: { color: "#9EAFB2", fontSize: 10, lineHeight: 15 },
  serviceCard: { gap: 8, backgroundColor: "#111D2A", borderColor: "#28435A" },
  serviceCopy: { color: "#B5CADB", fontSize: 11, lineHeight: 17 },
  serviceMemoryList: { gap: 7, marginTop: 2 },
  serviceMemoryRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 9, borderRadius: 11, backgroundColor: "#0B131D", borderWidth: 1, borderColor: "#28435A" },
  serviceMemoryKind: { minWidth: 44, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7, backgroundColor: "#1B3650" },
  serviceMemoryKindText: { color: "#A9D8FF", fontSize: 9, lineHeight: 13, fontWeight: "700" },
  serviceMemoryContent: { flex: 1, color: "#C5D5E4", fontSize: 11, lineHeight: 16 },
  serviceMemoryEmpty: { color: palette.muted, fontSize: 11, lineHeight: 16 },
  modelContext: { gap: 6, padding: 10, borderRadius: 13, backgroundColor: "#0C1020", borderWidth: 1, borderColor: "#323B67" },
  modelContextTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  modelContextTitle: { color: "#C5CAFF", fontSize: 11, lineHeight: 16, fontWeight: "700" },
  modelContextCount: { color: palette.muted, fontSize: 10, lineHeight: 15 },
  modelLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  modelLineLabel: { width: 28, color: "#9EA8C8", fontSize: 10, lineHeight: 15 },
  modelLineValue: { flex: 1, color: "#DFE2F5", fontSize: 10, lineHeight: 15 },
  researchComposer: { gap: 11, backgroundColor: "#112523", borderColor: "#2B6159" },
  composerHeading: { flexDirection: "row", gap: 11 },
  composerIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#1D3A37" },
  composerCopy: { flex: 1 },
  composerTitle: { color: palette.text, fontSize: 16, lineHeight: 22, fontWeight: "700" },
  composerSubtitle: { color: "#BDEEE5", fontSize: 12, lineHeight: 18, marginTop: 2 },
  topicInput: { minHeight: 86, maxHeight: 150, color: palette.text, backgroundColor: "#0C1716", borderColor: "#2D5650", borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 11, fontSize: 14, lineHeight: 20, textAlignVertical: "top" },
  sectionLabel: { color: palette.muted, fontSize: 12, lineHeight: 18, fontWeight: "700", letterSpacing: 0.7, marginTop: 2 },
  researchCard: { marginHorizontal: 20, gap: 10, padding: 13, backgroundColor: palette.surface },
  researchHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  researchIcon: { width: 35, height: 35, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: palette.surfaceRaised },
  researchTitleWrap: { flex: 1 },
  researchTitle: { color: palette.text, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  researchTime: { color: palette.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  researchResult: { color: "#C7CED8", fontSize: 12, lineHeight: 19 },
  taskMeta: { gap: 2, marginTop: 9, padding: 9, borderRadius: 11, backgroundColor: "#10141E" },
  taskMetaText: { color: "#BFC8DA", fontSize: 10, lineHeight: 15 },
  proactiveInboxCard: { gap: 10, backgroundColor: "#16182B", borderColor: "#494C78" },
  proactiveInboxCopy: { color: "#C2C8E7", fontSize: 11, lineHeight: 17 },
  inboxEventList: { gap: 7 },
  inboxEventRow: { flexDirection: "row", gap: 8, padding: 9, borderRadius: 12, borderWidth: 1, backgroundColor: "#0E1020" },
  inboxEventIcon: { width: 33, height: 33, borderRadius: 11, justifyContent: "center", alignItems: "center" },
  inboxEventCopy: { flex: 1, gap: 3 },
  inboxEventTop: { flexDirection: "row", gap: 7, alignItems: "center" },
  inboxEventTitle: { flex: 1, color: palette.text, fontSize: 11, lineHeight: 16, fontWeight: "800" },
  inboxEventSeverity: { fontSize: 9, lineHeight: 13, fontWeight: "800" },
  inboxEventBody: { color: "#CFD3ED", fontSize: 10, lineHeight: 15 },
  inboxEventMeta: { color: "#929ABA", fontSize: 8, lineHeight: 12 },
  inboxVisualChip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4, maxWidth: "100%", paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7, backgroundColor: "#311A2E" },
  inboxVisualImage: { width: "100%", height: 118, borderRadius: 9, backgroundColor: "#272244" },
  inboxVisualText: { color: "#EDBDDF", fontSize: 8, lineHeight: 12 },
  proactiveInboxFootnote: { color: "#99A1C2", fontSize: 9, lineHeight: 14 },
});
