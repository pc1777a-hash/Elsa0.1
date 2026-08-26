import { describe, expect, it } from "vitest";

import { buildStrategyDraftPrompt, getCurrentStrategy } from "../lib/trading-strategy";
import { parsePerpetualBrainStatus } from "../lib/perpetual-brain";
import { parseAixiSelfReport, parsePerpetualStrategyStatus, parsePerpetualTasks } from "../lib/perpetual-contracts";
import { parseSystemResources } from "../lib/system-resources";
import { parseSystemCapabilityInventory, parseSystemStorageInventory } from "../lib/inventory-contracts";
import { parseProactiveEventFeed } from "../lib/proactive-contracts";

describe("trading strategy helpers", () => {
  it("does not invent a strategy when the verified public exchange response has no strategy field", () => {
    const current = getCurrentStrategy({
      keys: { binance: false, bitget: true, okx: true },
      selected: "binance",
      supported: ["binance", "okx", "bitget"],
    });

    expect(current).toBeNull();
  });

  it("extracts a nested service-provided active strategy without relying on a fixed route", () => {
    expect(getCurrentStrategy({ automation: { active_strategy: "trend_breakout_v2" } })).toEqual({
      name: "trend_breakout_v2",
      source: "active_strategy",
    });
  });

  it("constructs an auditable draft request that forbids deployment and live trading", () => {
    const prompt = buildStrategyDraftPrompt({
      market: "BTCUSDT",
      timeframe: "15m",
      objective: "趨勢突破",
      riskLimit: "單筆最大虧損 1%",
    });

    expect(prompt).toContain("BTCUSDT");
    expect(prompt).toContain("Python 程式草案");
    expect(prompt).toContain("不得下單");
    expect(prompt).toContain("不得掛載策略");
  });

  it("accepts a permanent-brain status only when the worker explicitly reports online", () => {
    expect(parsePerpetualBrainStatus({ online: true, loop_state: "working", queue_depth: 2, active_task_id: "task-42" })).toMatchObject({
      online: true,
      loopState: "working",
      queueDepth: 2,
      activeTaskId: "task-42",
    });
  });

  it("rejects a chat-like or incomplete payload as an execution status", () => {
    expect(() => parsePerpetualBrainStatus({ reply: "收到請求" })).toThrow("online");
  });

  it("accepts explicit N1 resource telemetry and keeps GPU absence explicit", () => {
    expect(parseSystemResources({
      captured_at: "2026-08-18T08:00:00Z",
      gpu: null,
      disk: { used_gb: 461.57, total_gb: 915.79 },
      loaded_models: [],
      queue_depth: 0,
    })).toMatchObject({ diskUsedGb: 461.57, diskTotalGb: 915.79, gpu: null, queueDepth: 0 });
  });

  it("rejects incomplete data instead of presenting fake live resource telemetry", () => {
    expect(() => parseSystemResources({ disk: { used_gb: 10 } })).toThrow("資源端點");
  });

  it("accepts a verified N1 task queue and preserves public task metadata", () => {
    expect(parsePerpetualTasks({ tasks: [{
      task_id: "pt-42", kind: "code", title: "策略測試", objective: "測試風控", state: "running",
      created_at: "2026-08-18T08:00:00Z", updated_at: "2026-08-18T08:01:00Z", current_step: "running tests",
    }] })).toEqual([expect.objectContaining({ taskId: "pt-42", kind: "code", currentStep: "running tests" })]);
  });

  it("keeps null strategy versions and reported risk guard state instead of inventing a deployment", () => {
    expect(parsePerpetualStrategyStatus({
      development_task: null, candidate_version: null, deployed_version: null, executor_state: "stopped",
      executor_heartbeat: null, risk_guard_state: "unreported", last_cycle: null,
    })).toMatchObject({ candidateVersion: null, deployedVersion: null, executorState: "stopped", riskGuardState: "unreported" });
  });

  it("accepts Aixi inner state only with an explicit source, time, and wish list", () => {
    expect(parseAixiSelfReport({
      reported_at: "2026-08-18T08:00:00Z", source: "n1-self-report-worker", current_mood: "專注",
      current_focus: "整理脈絡", near_term_intent: null, long_term_wishes: ["維持可觀測性"],
    })).toMatchObject({ currentMood: "專注", longTermWishes: ["維持可觀測性"] });
    expect(() => parseAixiSelfReport({ reply: "我很好" })).toThrow("自我回報");
  });

  it("accepts only a complete three-node, metadata-only storage inventory", () => {
    const node = (nodeId: "N1" | "N2" | "N3") => ({
      node_id: nodeId, report_state: "reported", captured_at: "2026-08-18T08:00:00Z",
      system: { hostname: nodeId.toLowerCase(), platform: "Linux", release: "6.8" },
      volumes: [{ mount_path: "/data", filesystem_type: "ext4", total_bytes: 1000, used_bytes: 400, available_bytes: 600, usage_percent: 40 }],
      import_sources: [{ id: "user-home", label: "使用者資料夾", state: "available", access: "user_selected" }], error_summary: null,
    });
    expect(parseSystemStorageInventory({ captured_at: "2026-08-18T08:00:00Z", source: "n1-storage-inventory/1", nodes: [node("N1"), node("N2"), node("N3")] }).nodes[0]).toMatchObject({ nodeId: "N1", reportState: "reported" });
  });

  it("rejects incomplete or chat-like storage inventory payloads", () => {
    expect(() => parseSystemStorageInventory({ reply: "都已掃描" })).toThrow("來源契約");
  });

  it("accepts aggregate capability candidates but keeps them distinct from verified capability", () => {
    const node = (nodeId: "N1" | "N2" | "N3") => ({
      node_id: nodeId, report_state: "reported", captured_at: "2026-08-18T08:00:00Z",
      scan: { max_entries: 5000, scanned_files: 300, excluded_sensitive_or_cache: 20, truncated: false },
      asset_counts: { docs: 8 }, capability_counts: { models: 1 }, candidate_counts: { reuse_candidate: 2, completion_candidate: 1 },
      service_signals: [{ manager: "pm2", name: "elsa-native", state: "online" }], error_summary: null,
    });
    expect(parseSystemCapabilityInventory({ captured_at: "2026-08-18T08:00:00Z", source: "n1-capability-inventory/1", nodes: [node("N1"), node("N2"), node("N3")] }).nodes[0].candidateCounts).toEqual({ reuse_candidate: 2, completion_candidate: 1 });
  });

  it("accepts only explicit proactive worker events with source, trigger and verification", () => {
    const event = {
      event_id: "evt-storage-1", kind: "system_report", severity: "attention", created_at: "2026-08-18T08:00:00Z",
      source: "n1-perpetual-worker", trigger: "N2 storage report became stale", title: "N2 儲存回報需要更新",
      body: "最近回報已超過設定期限。", verification_state: "reported", related_report_id: "storage-n2-1",
      visual: { kind: "portrait_card", label: "等待確認", is_visualization: true },
    };
    expect(parseProactiveEventFeed({ captured_at: "2026-08-18T08:00:01Z", source: "n1-proactive-events/1", events: [event] }).events[0]).toMatchObject({ eventId: "evt-storage-1", kind: "system_report", verificationState: "reported" });
  });

  it("rejects chat-like payloads or unverified proactive events", () => {
    expect(() => parseProactiveEventFeed({ reply: "我想跟你聊天" })).toThrow("來源契約");
    expect(() => parseProactiveEventFeed({
      captured_at: "2026-08-18T08:00:01Z", source: "n1-proactive-events/1",
      events: [{ event_id: "evt-1", kind: "chat_invite", severity: "info", created_at: "2026-08-18T08:00:00Z", source: "n1-worker", trigger: "idle", title: "想聊天", body: "嗨" }],
    })).toThrow("驗證狀態");
  });

  it("accepts new status art only when it declares fresh generation provenance", () => {
    const event = {
      event_id: "evt-visual-new-1", kind: "status_card", severity: "info", created_at: "2026-08-18T08:10:00Z",
      source: "n1-perpetual-worker", trigger: "active inventory task", title: "正在整理能力素材", body: "已開始分析 N1 的模組清單。",
      verification_state: "reported", visual: {
        kind: "generated_scene", label: "整理中", is_visualization: true, image_origin: "new_generation",
        image_url: "https://brain.pin-yi.uk/media/events/evt-visual-new-1.webp", generated_at: "2026-08-18T08:10:00Z",
        character_reference_version: "aixi-v5-portrait/1", prompt_digest: "專注整理模組的艾西，工作臺與星圖背景",
      },
    };
    expect(parseProactiveEventFeed({ captured_at: "2026-08-18T08:10:01Z", source: "n1-proactive-events/1", events: [event] }).events[0].visual).toMatchObject({
      imageOrigin: "new_generation", characterReferenceVersion: "aixi-v5-portrait/1",
    });
  });

  it("allows an old image only for an explicit memory echo with its source and intent", () => {
    const event = {
      event_id: "evt-memory-echo-1", kind: "status_card", severity: "info", created_at: "2026-08-18T08:20:00Z",
      source: "n1-perpetual-worker", trigger: "memory recall", title: "想帶你回看第一次完成的盤點", body: "這是已封存的歷史畫面。",
      verification_state: "reported", visual: {
        kind: "memory_echo", label: "記憶回響", is_visualization: true, image_origin: "memory_echo",
        image_url: "https://brain.pin-yi.uk/media/archive/first-scan.webp", memory_source_id: "archive-report-20260818-01",
        memory_intent: "回顧首次完成三機盤點的歷史事件",
      },
    };
    expect(parseProactiveEventFeed({ captured_at: "2026-08-18T08:20:01Z", source: "n1-proactive-events/1", events: [event] }).events[0].visual).toMatchObject({
      kind: "memory_echo", imageOrigin: "memory_echo", memorySourceId: "archive-report-20260818-01",
    });
  });

  it("rejects an old image that is not explicitly marked as a memory echo", () => {
    expect(() => parseProactiveEventFeed({
      captured_at: "2026-08-18T08:30:01Z", source: "n1-proactive-events/1",
      events: [{
        event_id: "evt-invalid-old-image", kind: "status_card", severity: "info", created_at: "2026-08-18T08:30:00Z",
        source: "n1-perpetual-worker", trigger: "idle", title: "目前狀態", body: "未提供新圖來源。", verification_state: "reported",
        visual: { kind: "portrait_card", label: "目前狀態", is_visualization: true, image_url: "https://brain.pin-yi.uk/media/old.webp" },
      }],
    })).toThrow("新生成");
  });
});
