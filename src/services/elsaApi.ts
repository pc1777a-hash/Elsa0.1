const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'https://elsa.pin-yi.uk';

export const getSystemHealth = async () => {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return await res.json();
  } catch {
    return { status: "offline" };
  }
};

export const getSystemContext = async () => {
  try {
    const res = await fetch(`${API_BASE}/api/system/context`);
    return await res.json();
  } catch {
    return { mind_link: "stopped", inner_state: "未回報" };
  }
};

export const sendAisiMessage = async (prompt: string) => {
  try {
    const res = await fetch(`${API_BASE}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    return await res.json();
  } catch {
    return { error: "Network error" };
  }
};

export const getTradePositions = async () => {
  try {
    const res = await fetch(`${API_BASE}/trade/positions`);
    return await res.json();
  } catch {
    return { positions: [] };
  }
};
