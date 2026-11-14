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
  auth: ["auth"] as const,
  demoUsers: ["auth", "demo-users"] as const,
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

/** Who is signed in (null user = signed out) and which projects they maintain. Everything else waits on this. */
export const useAuth = () => useQuery({ queryKey: keys.auth, queryFn: api.authMe, retry: false, staleTime: 60_000 });

/** True once we know someone is signed in: donor-only queries stay idle until then (they'd just 401). */
const useSignedIn = () => !!useAuth().data?.user;

/** Demo personas for the "Sign in as" picker. Errors (404) when the server has demo login off. */
export const useDemoUsers = () => useQuery({ queryKey: keys.demoUsers, queryFn: api.demoUsers, retry: false });

export const useMe = () => {
  const enabled = useSignedIn();
  return useQuery({ queryKey: keys.me, queryFn: api.me, enabled });
};

/** Polls every 3 s so the live "Claimed / Working / Verify / Merge" strip moves during the demo. */
export const useDashboard = () => {
  const enabled = useSignedIn();
  return useQuery({ queryKey: keys.dashboard, queryFn: api.dashboard, refetchInterval: 3000, enabled });
};

export const useOpenDecisions = () => {
  const enabled = useSignedIn();
  return useQuery({ queryKey: keys.decisions, queryFn: api.decisions, enabled });
};

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

/**
 * Demo sign-in / switch persona. Everything cached belongs to the previous user
 * (backings, dashboard, "can I maintain this"), so reset every query but the
 * new auth answer and let the screens refetch as the new person.
 */
export function useSwitchUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.demoLogin,
    onSuccess: async (auth) => {
      qc.setQueryData(keys.auth, auth);
      await qc.resetQueries({ predicate: (q) => q.queryKey[0] !== keys.auth[0] });
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.auth[0] });
      qc.setQueryData(keys.auth, { user: null, maintainerOf: [] });
    },
  });
}

export function useResetDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.resetDemo,
    // Everything cached belongs to the old demo state, so drop it all (but keep who is signed in: a reset doesn't sign you out).
    onSuccess: () => qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.auth[0] }),
  });
}
