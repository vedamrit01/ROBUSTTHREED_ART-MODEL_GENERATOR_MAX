import { exportThreeMf, type ThreeMfRequest, type ThreeMfMessage } from './export-3mf';

self.onmessage = (event: MessageEvent<ThreeMfRequest>) => {
  try {
    const bytes = exportThreeMf(event.data);
    self.postMessage({ type: 'result', bytes } satisfies ThreeMfMessage, { transfer: [bytes.buffer] });
  } catch (error) {
    self.postMessage({ type: 'error', error: error instanceof Error ? error.message : 'The 3MF could not be created. Please try again.' } satisfies ThreeMfMessage);
  }
};
