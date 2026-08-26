export interface SystemNodeSnapshot {
  id: "N1" | "N2" | "N3";
  name: string;
  role: string;
  address: string;
  sshPort: string;
  services: string[];
  status: "reported" | "awaiting_inventory";
}

/**
 * Manually supplied system-context snapshot. It contains topology only, never secrets.
 * A future N1-proxied /api/ops/inventory response should replace these values at runtime.
 */
export const SYSTEM_TOPOLOGY_SNAPSHOT = {
  reportedAt: "2026-08-18T20:21:00+08:00",
  brain: {
    name: "N1 桌機中心",
    role: "大腦中心",
    address: "elsa-proxy.pc1777a.workers.dev",
    gpu: "NVIDIA GeForce GTX 1080 Ti · 11 GB VRAM",
    gpuMemory: "358 MiB / 11,264 MiB",
    gpuUtilization: "0%",
    ollama: "llama-server 已回報使用 322 MiB GPU 記憶體",
  },
  nodes: [
    { id: "N1", name: "N1 桌機", role: "大腦中心", address: "elsa-proxy.pc1777a.workers.dev", sshPort: "2222／22", services: ["elsa-native", "Ollama", "elsa-watchdog", "SSH 已驗證"], status: "reported" },
    { id: "N2", name: "N2 筆電", role: "公網隧道", address: "100.120.139.65", sshPort: "2223", services: ["SSH 已驗證"], status: "reported" },
    { id: "N3", name: "N3 手機", role: "SSH 遠端", address: "100.98.242.48", sshPort: "8022", services: ["SSH 已驗證"], status: "reported" },
  ] satisfies SystemNodeSnapshot[],
} as const;
