'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { runDefaultModelBootstrap } from '@/lib/client/default-model-bootstrap';

/**
 * After persist hydration: apply DEFAULT_MODEL from `window.__OPENMAIC_DEFAULT_MODEL__`
 * (see root layout), toast if missing/invalid, then fetch server provider capabilities.
 */
export function ServerProvidersInit() {
  const { t } = useI18n();

  useEffect(() => {
    const run = async () => {
      // Merge server provider lists first so resolveDefaultChatModelFromEnv uses the
      // same filtered models as the rest of the app; also avoids fetch overwriting
      // modelId with '' via validateModel when this ran before fetch.
      try {
        await useSettingsStore.getState().fetchServerProviders();
      } catch {
        /* optional network failure — bootstrap still uses built-in providersConfig */
      }
      const result = runDefaultModelBootstrap();
      if (result.kind === 'missing_env') {
        toast.error(t('settings.defaultModelEnvMissing'));
      } else if (result.kind === 'invalid_env') {
        toast.error(t('settings.defaultModelEnvInvalid'));
      }
    };

    if (useSettingsStore.persist.hasHydrated()) {
      void run();
      return;
    }

    return useSettingsStore.persist.onFinishHydration(() => {
      void run();
    });
  }, [t]);

  return null;
}
