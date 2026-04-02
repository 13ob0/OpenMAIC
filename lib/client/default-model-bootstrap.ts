/**
 * Single entry: apply DEFAULT_MODEL from layout-injected window.__OPENMAIC_DEFAULT_MODEL__
 * after persist hydration. Does not use /api/server-providers for the model string.
 */

import type { ProviderId } from '@/lib/types/provider';
import { resolveDefaultChatModelFromEnv } from '@/lib/store/settings-validation';
import { useSettingsStore } from '@/lib/store/settings';

let bootstrapRan = false;

export type DefaultModelBootstrapResult =
  | { kind: 'already_ran' }
  | { kind: 'skipped_has_model' }
  | { kind: 'missing_env' }
  | { kind: 'invalid_env' }
  | { kind: 'applied'; providerId: ProviderId; modelId: string };

/**
 * Run once per page load. Call only after settings persist has hydrated.
 */
export function runDefaultModelBootstrap(): DefaultModelBootstrapResult {
  if (bootstrapRan) {
    return { kind: 'already_ran' };
  }
  bootstrapRan = true;

  if (typeof window === 'undefined') {
    return { kind: 'skipped_has_model' };
  }

  const state = useSettingsStore.getState();
  if (state.modelId) {
    return { kind: 'skipped_has_model' };
  }

  const raw = window.__OPENMAIC_DEFAULT_MODEL__?.trim() ?? '';
  if (!raw) {
    return { kind: 'missing_env' };
  }

  const resolved = resolveDefaultChatModelFromEnv(raw, state.providersConfig);
  if (!resolved) {
    return { kind: 'invalid_env' };
  }

  useSettingsStore.setState({
    providerId: resolved.providerId,
    modelId: resolved.modelId,
  });

  return {
    kind: 'applied',
    providerId: resolved.providerId,
    modelId: resolved.modelId,
  };
}
