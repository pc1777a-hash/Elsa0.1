import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { Card, StatusBadge, palette } from "@/components/elsa-ui";
import type { DocumentArtifact, DocumentProductionReport, DocumentTaskStatus } from "@/lib/elsa-types";

const STATUS_ORDER: DocumentTaskStatus[] = ["draft", "queued", "producing", "verified"];

export function DocumentWorkflowCard({ report }: { report: DocumentProductionReport | null }) {
  const tasks = report?.tasks ?? [];
  const artifacts = report?.artifacts ?? [];
  const verifiedArtifacts = artifacts.filter((artifact) =>
    ["verified", "indexed", "archived"].includes(artifact.status) && isSafeHttpsUrl(artifact.downloadUrl),
  );

  return (
    <Card style={styles.card}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.eyebrow}>DOCUMENT PRODUCTION</Text>
          <Text style={styles.title}>文件工坊</Text>
        </View>
        <StatusBadge state={report ? "connected" : "unknown"} label={report ? `${tasks.length} 個任務` : "待 N1 啟用"} />
      </View>

      <Text style={styles.copy}>DOCX、PDF 與 Markdown 僅在 N1 明確回報產製、雜湊驗證與產物關聯後才會顯示；排隊請求不是成品。</Text>

      {!report ? (
        <View style={styles.unreportedPanel}>
          <MaterialIcons name="description" size={22} color="#99A6CA" />
          <View style={styles.unreportedCopy}>
            <Text style={styles.unreportedTitle}>尚未收到文件產製報告</Text>
            <Text style={styles.unreportedDetail}>預定契約：GET /api/documents/report。N1 安裝工作者前，這裡會保持「待 N1 啟用」。</Text>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.metrics}>
            <Metric label="任務" value={`${tasks.length}`} tone="#BDAFFF" />
            <Metric label="產物" value={`${artifacts.length}`} tone="#66DACA" />
            <Metric label="可下載" value={`${verifiedArtifacts.length}`} tone="#F5C66B" />
          </View>

          <View style={styles.statusStrip}>
            {STATUS_ORDER.map((status) => <View key={status} style={styles.statusItem}><Text style={styles.statusLabel}>{taskStatusLabel(status)}</Text><Text style={styles.statusValue}>{tasks.filter((task) => task.status === status).length}</Text></View>)}
          </View>

          {tasks.length ? (
            <View style={styles.taskList}>
              {tasks.slice(0, 3).map((task) => <View key={task.id} style={styles.taskRow}><View style={styles.taskIcon}><MaterialIcons name={task.status === "failed" ? "error-outline" : "article"} size={16} color={task.status === "failed" ? palette.error : "#BDAFFF"} /></View><View style={styles.taskCopy}><Text numberOfLines={1} style={styles.taskTitle}>{task.title}</Text><Text numberOfLines={2} style={styles.taskDetail}>{taskStatusLabel(task.status)} · {task.requestedFormats.join(" / ")} · 更新 {formatTime(task.updatedAt)}</Text>{task.failureReason ? <Text numberOfLines={2} style={styles.taskFailure}>失敗：{task.failureReason}</Text> : null}</View></View>)}
            </View>
          ) : <Text style={styles.emptyText}>N1 已回應文件工坊契約，但尚未回報任何文件任務。</Text>}

          {verifiedArtifacts.length ? (
            <View style={styles.artifactPanel}>
              <View style={styles.artifactHeading}><Text style={styles.artifactTitle}>已驗證成品</Text><Text style={styles.artifactMeta}>僅顯示 HTTPS 下載連結</Text></View>
              {verifiedArtifacts.slice(0, 3).map((artifact) => <ArtifactDownloadRow key={artifact.artifactId} artifact={artifact} />)}
            </View>
          ) : <Text style={styles.artifactEmpty}>尚無具 HTTPS 下載連結的已驗證成品。</Text>}

          <Text style={styles.footnote}>來源：{report.source} · 最近回報：{formatTime(report.capturedAt)}</Text>
        </>
      )}
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, { color: tone }]}>{value}</Text></View>;
}

function ArtifactDownloadRow({ artifact }: { artifact: DocumentArtifact }) {
  const onOpen = () => {
    if (isSafeHttpsUrl(artifact.downloadUrl)) {
      void Linking.openURL(artifact.downloadUrl);
    }
  };

  return <Pressable onPress={onOpen} style={({ pressed }) => [styles.artifactRow, pressed && styles.artifactPressed]} accessibilityRole="link" accessibilityLabel={`開啟 ${artifact.fileName}`}>
    <View style={styles.artifactIcon}><MaterialIcons name="verified" size={17} color="#65DBC8" /></View>
    <View style={styles.artifactCopy}><Text numberOfLines={1} style={styles.artifactName}>{artifact.fileName}</Text><Text numberOfLines={1} style={styles.artifactDetail}>{artifact.format.toUpperCase()} · {formatBytes(artifact.sizeBytes)} · SHA-256 已驗證</Text></View>
    <MaterialIcons name="open-in-new" size={18} color="#BDB5FF" />
  </Pressable>;
}

function taskStatusLabel(status: DocumentTaskStatus): string {
  return ({ draft: "草稿", queued: "已排隊", producing: "產製中", verified: "已驗證", indexed: "已索引", archived: "已封存", failed: "失敗" })[status];
}

function formatTime(value: string | undefined): string {
  if (!value) return "未回報";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未回報";
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "大小未回報";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function isSafeHttpsUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#0B1122", borderColor: "#26395C", gap: 12 },
  heading: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", gap: 12 },
  eyebrow: { color: "#91A4D1", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  title: { color: palette.text, fontSize: 20, fontWeight: "800", marginTop: 3 },
  copy: { color: "#A9B3CC", fontSize: 13, lineHeight: 19 },
  unreportedPanel: { alignItems: "flex-start", backgroundColor: "#10182C", borderColor: "#2A3B5E", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 11, padding: 13 },
  unreportedCopy: { flex: 1, gap: 3 },
  unreportedTitle: { color: "#DCE4FF", fontSize: 13, fontWeight: "800" },
  unreportedDetail: { color: "#96A1BF", fontSize: 12, lineHeight: 17 },
  metrics: { flexDirection: "row", gap: 8 },
  metric: { backgroundColor: "#10192E", borderColor: "#283B60", borderRadius: 12, borderWidth: 1, flex: 1, gap: 3, padding: 10 },
  metricLabel: { color: "#98A4C0", fontSize: 11 },
  metricValue: { fontSize: 20, fontWeight: "800" },
  statusStrip: { flexDirection: "row", gap: 6 },
  statusItem: { backgroundColor: "#111B31", borderRadius: 10, flex: 1, paddingHorizontal: 7, paddingVertical: 8 },
  statusLabel: { color: "#95A1BE", fontSize: 10, textAlign: "center" },
  statusValue: { color: "#E7EBFF", fontSize: 16, fontWeight: "800", marginTop: 2, textAlign: "center" },
  taskList: { borderTopColor: "#263656", borderTopWidth: StyleSheet.hairlineWidth, gap: 9, paddingTop: 10 },
  taskRow: { alignItems: "flex-start", flexDirection: "row", gap: 9 },
  taskIcon: { alignItems: "center", backgroundColor: "#171B36", borderRadius: 9, height: 31, justifyContent: "center", width: 31 },
  taskCopy: { flex: 1, gap: 2 },
  taskTitle: { color: "#E5E9FF", fontSize: 13, fontWeight: "700" },
  taskDetail: { color: "#94A0BC", fontSize: 11, lineHeight: 16 },
  taskFailure: { color: "#FFA4A4", fontSize: 11, lineHeight: 16 },
  emptyText: { color: "#98A3BD", fontSize: 12, lineHeight: 18 },
  artifactPanel: { backgroundColor: "#0E1A2B", borderColor: "#244B52", borderRadius: 14, borderWidth: 1, gap: 5, padding: 10 },
  artifactHeading: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: 2 },
  artifactTitle: { color: "#DDFBF4", fontSize: 13, fontWeight: "800" },
  artifactMeta: { color: "#77BEB1", fontSize: 10 },
  artifactRow: { alignItems: "center", borderTopColor: "#24434B", borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 8, paddingVertical: 9 },
  artifactPressed: { opacity: 0.66 },
  artifactIcon: { alignItems: "center", backgroundColor: "#12302F", borderRadius: 9, height: 30, justifyContent: "center", width: 30 },
  artifactCopy: { flex: 1, gap: 2 },
  artifactName: { color: "#E2F9F5", fontSize: 12, fontWeight: "700" },
  artifactDetail: { color: "#86ABA8", fontSize: 10 },
  artifactEmpty: { color: "#8E9AB6", fontSize: 12, lineHeight: 17 },
  footnote: { color: "#74809B", fontSize: 10, lineHeight: 15 },
});
