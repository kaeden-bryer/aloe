/**
 * TanStack Query hooks: the only way screens touch server data.
 *
 * Queries cache by key, so two components asking for "me" share one request.
 * Mutations invalidate the keys whose data they change, which makes every
 * screen showing that data refetch on its own; no manual prop-drilling.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DonorSettings, Me } from "@aloe/core/contracts";
import { api } from "./client";

export const keys = {
  causes: ["causes"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  me: ["me"] as const,
  dashboard: ["dashboard"] as const,
  decisions: ["decisions"] as const,
};

// ---------- Queries ----------

export const useCauses = () => useQuery({ queryKey: keys.causes, queryFn: api.causes, staleTime: Infinity });

export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: () => api.projects() });

export const useProject = (id: string) => useQuery({ queryKey: keys.project(id), queryFn: () => api.project(id) });

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me });

/** Polls every 3 s so the live "Claimed / Working / Verify / Merge" strip moves during the demo. */
export const useDashboard = () =>
  useQuery({ queryKey: keys.dashboard, queryFn: api.dashboard, refetchInterval: 3000 });

export const useOpenDecisions = () => useQuery({ queryKey: keys.decisions, queryFn: api.decisions });

// ---------- Mutations ----------

/**
 * Saves donor settings with an optimistic update: the UI flips immediately,
 * and rolls back if the server says no.
 */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.saveSettings,
    onMutate: async (settings: DonorSettings) => {
      await qc.cancelQueries({ queryKey: keys.me });
      const previous = qc.getQueryData<Me>(keys.me);
      if (previous) qc.setQueryData<Me>(keys.me, { ...previous, settings });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.me, ctx.previous);
    },
    onSuccess: (me) => {
      qc.setQueryData(keys.me, me);
      void qc.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

function invalidateBackingData(qc: ReturnType<typeof useQueryClient>) {
  // keys.projects is a prefix of keys.project(id), so this refreshes the list and every detail.
  return Promise.all([
    qc.invalidateQueries({ queryKey: keys.projects }),
    qc.invalidateQueries({ queryKey: keys.me }),
    qc.invalidateQueries({ queryKey: keys.dashboard }),
  ]);
}

export function useToggleBacking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, back }: { id: string; back: boolean }) => (back ? api.back(id) : api.unback(id)),
    onSettled: () => invalidateBackingData(qc),
  });
}

/** Onboarding's "Start donating": save settings, then make backings match the picked projects. */
export function useStartDonating() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ settings, picked, previous }: { settings: DonorSettings; picked: string[]; previous: string[] }) => {
      await api.saveSettings(settings);
      // Sequential on purpose: small list, and it keeps server logs readable.
      for (const id of previous) if (!picked.includes(id)) await api.unback(id);
      for (const id of picked) if (!previous.includes(id)) await api.back(id);
    },
    onSettled: () => invalidateBackingData(qc),
  });
}

export function useResolveDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, optionId }: { id: string; optionId: string }) => api.resolveDecision(id, optionId),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.decisions }),
        qc.invalidateQueries({ queryKey: keys.dashboard }),
        qc.invalidateQueries({ queryKey: keys.projects }),
      ]),
  });
}

export function useResetDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.resetDemo,
    // Everything cached belongs to the old demo state, so drop it all.
    onSuccess: () => qc.clear(),
  });
}
