import { afterEach, describe, expect, it, vi } from "vitest";

import { getSystemBible, SYSTEM_BIBLE_URL } from "../lib/system-bible";

describe("System Bible service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the published ELSA service structure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      title: "ELSA-V5 系統聖經",
      version: "1.0.0",
      status: "operational",
      timestamp: "2026-08-18T13:57:02.634657",
      services: ["core", "trading", "memory", "plugin"],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSystemBible()).resolves.toMatchObject({
      title: "ELSA-V5 系統聖經",
      status: "operational",
      services: ["core", "trading", "memory", "plugin"],
    });
    expect(fetchMock).toHaveBeenCalledWith(SYSTEM_BIBLE_URL, { headers: { Accept: "application/json" } });
  });

  it("surfaces a helpful error for unavailable service responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 })));

    await expect(getSystemBible()).rejects.toThrow("系統架構服務回應 404");
  });
});
