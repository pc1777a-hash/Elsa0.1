import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { StyleSheet, Text, View } from "react-native";

import { Card, StatusBadge, palette } from "@/components/elsa-ui";

export function MultiPlatformControlCard() {
  return <Card style={styles.card}>
    <View style={styles.heading}>
      <View>
        <Text style={styles.eyebrow}>MULTI-PLATFORM CONTROL</Text>
        <Text style={styles.title}>多平台集中視圖</Text>
      </View>
      <StatusBadge state="unknown" label="待 N1 接線" />
    </View>

    <Text style={styles.copy}>策略在單一平台完成可驗證的回測、模擬與實盤觀察後，艾西才可為每個已授權平台建立獨立的並行任務；平台之間不共用帳戶範圍、風控額度或執行證據。</Text>

    <View style={styles.flow}>
      <FlowStage order="01" icon="fact-check" title="策略驗證" detail="版本、回測、模擬與風控" />
      <View style={styles.connector}><View style={styles.connectorDot} /></View>
      <FlowStage order="02" icon="account-tree" title="平台分流" detail="帳戶、授權、上限與核准" />
      <View style={styles.connector}><View style={styles.connectorDot} /></View>
      <FlowStage order="03" icon="verified-user" title="獨立證據" detail="任務 ID、輸出、失敗與取消" />
    </View>

    <View style={styles.unreportedPanel}>
      <MaterialIcons name="hub" size={21} color="#AFA7FF" />
      <View style={styles.unreportedCopy}>
        <Text style={styles.unreportedTitle}>尚未回報已接線平台或並行任務</Text>
        <Text style={styles.unreportedDetail}>預定讀取：GET /api/platforms/report。N1 需先回報平台 ID、帳戶／工作區範圍、能力、風控檔、核准狀態與任務證據。</Text>
      </View>
    </View>

    <View style={styles.rule}><MaterialIcons name="lock-outline" size={15} color="#E5C66A" /><Text style={styles.ruleText}>「策略可擴展」只代表可進入主人審閱；每個平台仍需有自己的風控設定與有效核准，未收到平台執行證據時不顯示為已下單。</Text></View>
  </Card>;
}

function FlowStage({ order, icon, title, detail }: { order: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; title: string; detail: string }) {
  return <View style={styles.stage}><View style={styles.stageTop}><Text style={styles.order}>{order}</Text><MaterialIcons name={icon} size={17} color="#B6AEFF" /></View><Text style={styles.stageTitle}>{title}</Text><Text style={styles.stageDetail}>{detail}</Text></View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#15152A", borderColor: "#3D3972", gap: 12 },
  heading: { alignItems: "flex-start", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  eyebrow: { color: "#AFA7FF", fontSize: 10, fontWeight: "800", letterSpacing: 1.1 },
  title: { color: palette.text, fontSize: 20, fontWeight: "800", marginTop: 3 },
  copy: { color: "#C0C2E6", fontSize: 13, lineHeight: 19 },
  flow: { alignItems: "stretch", flexDirection: "row" },
  stage: { backgroundColor: "#202041", borderColor: "#3A3966", borderRadius: 12, borderWidth: 1, flex: 1, gap: 5, padding: 9 },
  stageTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  order: { color: "#8884C6", fontSize: 10, fontWeight: "800" },
  stageTitle: { color: "#E7E5FF", fontSize: 12, fontWeight: "800" },
  stageDetail: { color: "#A9A9CD", fontSize: 10, lineHeight: 14 },
  connector: { alignItems: "center", justifyContent: "center", width: 9 },
  connectorDot: { backgroundColor: "#716BC7", borderRadius: 2, height: 4, width: 4 },
  unreportedPanel: { alignItems: "flex-start", backgroundColor: "#1C1B36", borderColor: "#39365E", borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 10, padding: 12 },
  unreportedCopy: { flex: 1, gap: 3 },
  unreportedTitle: { color: "#E2E2FC", fontSize: 13, fontWeight: "800" },
  unreportedDetail: { color: "#A5A7C9", fontSize: 11, lineHeight: 17 },
  rule: { alignItems: "flex-start", flexDirection: "row", gap: 7 },
  ruleText: { color: "#D4C68E", flex: 1, fontSize: 11, lineHeight: 17 },
});
