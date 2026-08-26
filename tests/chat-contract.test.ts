import { describe, expect, it } from "vitest";

import { AixiChatContractError, buildAixiAskRequest, parseAixiChatReply } from "../lib/chat-contracts";

describe("Aixi chat response contract", () => {
  it("uses N1's verified text request field instead of the legacy message field", () => {
    expect(buildAixiAskRequest("你是誰")).toEqual({ text: "你是誰", type: "text" });
  });

  it("preserves a concrete N1 text reply and its optional Aixi voice directive", () => {
    expect(parseAixiChatReply({
      response: "我已整理好可驗證的 N1 狀態摘要。",
      voice_mode: "speak",
    })).toEqual({ text: "我已整理好可驗證的 N1 狀態摘要。", voiceDirective: "speak" });
  });

  it("keeps text primary when N1 has not explicitly chosen a voice mode", () => {
    expect(parseAixiChatReply({ reply: "這段文字必須保留可複製。" })).toEqual({
      text: "這段文字必須保留可複製。",
      voiceDirective: "auto",
    });
  });

  it("rejects the N1 gateway acknowledgement instead of storing it as an Aixi answer", () => {
    expect(() => parseAixiChatReply({ response: "收到請求: " })).toThrow(AixiChatContractError);
  });

  it("rejects an empty or missing reply field", () => {
    expect(() => parseAixiChatReply({ ok: true })).toThrow("文字回覆");
  });
});
