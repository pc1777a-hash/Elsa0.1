import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

type IconName = ComponentProps<typeof MaterialIcons>["name"];

export const palette = {
  background: "#090B10",
  surface: "#151923",
  surfaceRaised: "#1C2230",
  border: "#2A3140",
  text: "#F2F4F8",
  muted: "#9AA4B2",
  primary: "#7C5CFC",
  accent: "#35D3B6",
  error: "#F97066",
  warning: "#F6C760",
};

export function ScreenTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <View style={styles.titleRow}>
      <View style={styles.titleContent}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function PrimaryButton({ label, icon, onPress, loading = false, variant = "primary", disabled = false }: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  const variantStyle = variant === "primary" ? styles.primaryButton : variant === "danger" ? styles.dangerButton : styles.secondaryButton;
  const textStyle = variant === "secondary" ? styles.secondaryButtonText : styles.buttonText;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, variantStyle, (disabled || loading) && styles.buttonDisabled, pressed && styles.buttonPressed]}
    >
      {loading ? <ActivityIndicator size="small" color={palette.text} /> : icon ? <MaterialIcons name={icon} size={18} color={variant === "secondary" ? palette.text : palette.text} /> : null}
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}>
      <MaterialIcons name={icon} size={20} color={palette.text} />
    </Pressable>
  );
}

export function StatusBadge({ state, label }: { state: "connected" | "disconnected" | "unknown"; label?: string }) {
  const color = state === "connected" ? palette.accent : state === "disconnected" ? palette.error : palette.muted;
  const text = label ?? (state === "connected" ? "已連線" : state === "disconnected" ? "未連線" : "尚未檢查");
  return <View style={[styles.badge, { borderColor: `${color}55`, backgroundColor: `${color}16` }]}><View style={[styles.badgeDot, { backgroundColor: color }]} /><Text style={[styles.badgeText, { color }]}>{text}</Text></View>;
}

export function InlineNotice({ type = "info", children }: { type?: "info" | "error" | "success"; children: ReactNode }) {
  const color = type === "error" ? palette.error : type === "success" ? palette.accent : palette.muted;
  const icon: IconName = type === "error" ? "error-outline" : type === "success" ? "check-circle-outline" : "info-outline";
  return <View style={[styles.notice, { borderColor: `${color}45` }]}><MaterialIcons name={icon} size={18} color={color} /><Text style={[styles.noticeText, { color }]}>{children}</Text></View>;
}

export function EmptyState({ icon, title, detail }: { icon: IconName; title: string; detail: string }) {
  return <View style={styles.empty}><View style={styles.emptyIcon}><MaterialIcons name={icon} size={26} color={palette.muted} /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyDetail}>{detail}</Text></View>;
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  titleContent: { flex: 1, paddingRight: 10 },
  title: { color: palette.text, fontSize: 30, lineHeight: 36, fontWeight: "700", letterSpacing: -0.5 },
  subtitle: { color: palette.muted, fontSize: 14, lineHeight: 20, marginTop: 4 },
  card: { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1, borderRadius: 20, padding: 16 },
  button: { minHeight: 48, borderRadius: 14, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryButton: { backgroundColor: palette.primary },
  secondaryButton: { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderWidth: 1 },
  dangerButton: { backgroundColor: "#401F28", borderColor: "#71323C", borderWidth: 1 },
  buttonText: { color: palette.text, fontWeight: "700", fontSize: 15 },
  secondaryButtonText: { color: palette.text, fontWeight: "600", fontSize: 15 },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  iconButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: palette.surfaceRaised, borderWidth: 1, borderColor: palette.border },
  iconButtonPressed: { opacity: 0.65 },
  badge: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", borderWidth: 1, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6, gap: 6 },
  badgeDot: { width: 7, height: 7, borderRadius: 7 },
  badgeText: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: 14, padding: 12 },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 19 },
  empty: { alignItems: "center", paddingHorizontal: 24, paddingVertical: 38 },
  emptyIcon: { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: palette.surfaceRaised, marginBottom: 14 },
  emptyTitle: { color: palette.text, fontSize: 16, lineHeight: 22, fontWeight: "700", textAlign: "center" },
  emptyDetail: { color: palette.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 6 },
});
