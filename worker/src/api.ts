/**
 * The worker's two calls to Stead (DECISIONS D03). Bearer secret, JSON in,
 * JSON out, and nothing else: the worker holds no database credential.
 */
import type { ScanJob, ScanJobFinish } from "../../src/lib/types";

export type WorkerApi = {
  claim(workerId: string): Promise<ScanJob | null>;
  finish(scanId: string, body: ScanJobFinish): Promise<{ state: string; notified: boolean }>;
};

export function workerApi(baseUrl: string, secret: string, fetchImpl: typeof fetch = fetch): WorkerApi {
  const base = baseUrl.replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
  return {
    async claim(workerId) {
      const response = await fetchImpl(`${base}/api/scan-worker/jobs/claim`, {
        method: "POST",
        headers,
        body: JSON.stringify({ workerId }),
      });
      if (response.status === 204) return null;
      if (!response.ok) throw new Error(`claim failed: ${response.status} ${await response.text()}`);
      const { job } = (await response.json()) as { job: ScanJob };
      return job;
    },
    async finish(scanId, body) {
      const response = await fetchImpl(`${base}/api/scan-worker/jobs/${scanId}/finish`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`finish failed: ${response.status} ${await response.text()}`);
      return (await response.json()) as { state: string; notified: boolean };
    },
  };
}
