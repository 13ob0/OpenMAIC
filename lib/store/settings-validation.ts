/**
 * Provider selection validation utilities.
 *
 * Pure functions used by fetchServerProviders() to detect and fix
 * stale provider/model selections after server config changes.
 */

import type { ProviderId } from '@/lib/types/provider';
import { parseModelString, PROVIDERS } from '@/lib/ai/providers';
import type { ProvidersConfig } from '@/lib/types/settings';

export type ProviderCfgLike = {
  isServerConfigured?: boolean;
  apiKey?: string;
};

/** Check whether a provider has a usable path (server config or client key). */
export function isProviderUsable(cfg: ProviderCfgLike | undefined): boolean {
  if (!cfg) return false;
  return !!cfg.isServerConfigured || !!cfg.apiKey;
}

/**
 * Validate current provider selection against updated config.
 * Returns the current ID if still usable, otherwise the first usable
 * provider from fallbackOrder, or defaultId if provided, or ''.
 */
export function validateProvider<T extends string>(
  currentId: T | '',
  configMap: Partial<Record<T, ProviderCfgLike>>,
  fallbackOrder: T[],
  defaultId?: T,
): T | '' {
  if (!currentId) return currentId;
  if (isProviderUsable(configMap[currentId])) return currentId;

  for (const id of fallbackOrder) {
    if (isProviderUsable(configMap[id])) return id;
  }
  return defaultId ?? '';
}

/**
 * Validate current model selection against available models list.
 * Falls back to first available model, or '' if list is empty.
 */
export function validateModel(
  currentModelId: string,
  availableModels: Array<{ id: string }>,
): string {
  if (!currentModelId) return currentModelId;
  if (availableModels.some((m) => m.id === currentModelId)) return currentModelId;
  return availableModels[0]?.id ?? '';
}

/**
 * Resolve DEFAULT_MODEL from server-providers API into a chat selection for the UI.
 * Returns null if raw is empty, provider is missing, or model is not allowed.
 *
 * Does not require a client API key: when the deployment sets DEFAULT_MODEL, we still
 * select that model so the UI matches the server default (keys may live only on the server).
 *
 * When the server restricts models (serverModels), cfg.models is filtered to that list.
 * DEFAULT_MODEL may still name a model that only exists on the built-in catalog (e.g. admin
 * sets MiniMax-M2.7-highspeed while server allowlist is narrower) — accept if inBuiltIn.
 */
export function resolveDefaultChatModelFromEnv(
  raw: string | null | undefined,
  providersConfig: ProvidersConfig,
): { providerId: ProviderId; modelId: string } | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  const { providerId, modelId } = parseModelString(trimmed);
  const cfg = providersConfig[providerId];
  if (!cfg) return null;

  const inCfg = (cfg.models ?? []).some((m) => m.id === modelId);
  const builtIn =
    providerId in PROVIDERS
      ? PROVIDERS[providerId as keyof typeof PROVIDERS]?.models
      : undefined;
  const inBuiltIn = builtIn?.some((m) => m.id === modelId) ?? false;

  if (cfg.serverModels?.length) {
    if (!inCfg && !inBuiltIn) return null;
  } else if (!inCfg && !inBuiltIn) {
    return null;
  }

  return { providerId, modelId };
}
