import { useQuery } from '@tanstack/react-query';
import type { BotActivityResponse } from '@/app/api/bots/activity/route';
import { apiErrorMessage, apiFetch } from '@/lib/data/api-fetch';
import { INDEXED_VAULT_QUERY_OPTIONS } from '@/lib/data/query-config';

export type BotActivityPanel = 'allocator' | 'sentinel' | 'rebater';

export function useBotActivity(options?: {
  enabled?: boolean;
  limit?: number;
  panel?: BotActivityPanel;
}) {
  const limit = options?.limit ?? 25;
  const panel = options?.panel ?? 'allocator';
  return useQuery({
    queryKey: ['bot-activity', 'v5', panel, limit],
    queryFn: async (): Promise<BotActivityResponse> => {
      const params = new URLSearchParams({
        limit: String(limit),
        panel,
      });
      const res = await apiFetch(`/api/bots/activity?${params}`);
      if (!res.ok) {
        throw new Error(await apiErrorMessage(res, 'Failed to fetch bot activity'));
      }
      return res.json();
    },
    enabled: options?.enabled ?? true,
    ...INDEXED_VAULT_QUERY_OPTIONS,
  });
}
