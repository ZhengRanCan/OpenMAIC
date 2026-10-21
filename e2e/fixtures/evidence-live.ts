import { test as base, expect } from '@playwright/test';
import {
  preflightEvidenceSources,
  validateLiveEvidenceOrigin,
} from '../../scripts/evidence-live-preflight';
/** No browser/base fixture imports: this context has no model mocks or seeded records. */
export const test = base.extend({
  request: async ({ playwright }, use) => {
    if (
      process.env.F64_LIVE_EVIDENCE !== '1' ||
      !process.env.F64_LIVE_BASE_URL ||
      !process.env.F64_LIVE_STORAGE_STATE
    )
      throw new Error(
        'Explicit opt-in, origin and session state are required for a live paid call',
      );
    const origin = validateLiveEvidenceOrigin(process.env.F64_LIVE_BASE_URL);
    if (!process.env.F64_SOURCE_BASELINE || !process.env.F64_PROVENANCE_OUTPUT)
      throw new Error('Live source preflight configuration required');
    await preflightEvidenceSources({
      baseUrl: origin,
      storageStatePath: process.env.F64_LIVE_STORAGE_STATE,
      baselinePath: process.env.F64_SOURCE_BASELINE,
      outputPath: process.env.F64_PROVENANCE_OUTPUT,
    });
    const api = await playwright.request.newContext({
      baseURL: origin,
      storageState: process.env.F64_LIVE_STORAGE_STATE,
      timeout: 230000,
      extraHTTPHeaders: { origin, 'content-type': 'application/json' },
    });
    try {
      await use(api);
    } finally {
      await api.dispose();
    }
  },
});
export { expect };
