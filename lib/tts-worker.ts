self.onmessage = async (e) => {
  const { text } = e.data;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.pitch = 0.72;
  utterance.rate = 0.88;
  utterance.volume = 1.0;
  window.speechSynthesis.speak(utterance);
};
