import { runTraceJob, type TraceJobRequest } from './tracejob';

self.onmessage = async (ev: MessageEvent<TraceJobRequest>) => {
  const res = await runTraceJob(ev.data);
  const transfer = res.ok && res.kind === 'encode' ? [res.bytes.buffer as ArrayBuffer] : [];
  (self as unknown as Worker).postMessage(res, transfer);
};
