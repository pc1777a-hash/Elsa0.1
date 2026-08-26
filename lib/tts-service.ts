export function speak(text: string): void {
  if (!window.Worker) return;
  const worker = new Worker('./lib/tts-worker.ts');
  worker.postMessage({ text });
}
