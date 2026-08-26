self.onmessage = async (e) => {
  const { message } = e.data;
  try {
    const response = await fetch('/api/chat/brain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const data = await response.json();
    self.postMessage({ success: true, data });
  } catch (error) {
    self.postMessage({ success: false, error });
  }
};
