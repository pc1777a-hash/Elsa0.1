import sys

sys.path.insert(0, "docs")

from AGI_SYSTEM_PROMPT import build_agi_system_prompt


runtime_context = {
    "node_id": "test-node",
    "hardware_summary": "test hardware",
    "base_url": "https://example.invalid",
    "native_service_status": "healthy",
    "model_catalog": "test model",
    "memory_status": "ready",
    "trader_mode": "paper",
    "trading_scope": "BTC/USDT",
    "available_tools": "read-only status",
}

prompt = build_agi_system_prompt(runtime_context)
assert "test-node" in prompt
assert "操作：{operation}" in prompt
assert "模式：{trader_mode}" in prompt
print(f"AGI system prompt rendered successfully: {len(prompt)} characters")
