/**
 * Maintainer API calls and TanStack hooks (see "Maintainer API" in packages/core/API.md).
 * Kept in its own file so the donor-side client stays untouched.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  ApproveDraftResponse,
  Decision,
  DraftTask,
  ImportIssuesResponse,
  MaintainerBrief,
  type ImportIssuesRequest,
  type TaskSpec,
} from "@aloe/core/contracts";
import { request } from "./client";
import { keys } from "./hooks";

const Ok = z.object({ ok: z.literal(true) });
const base = (id: string) => `/api/maintain/projects/${encodeURIComponent(id)}`;

export const maintainApi = {
  brief: (id: string) => request("GET", `${base(id)}/brief`, MaintainerBrief),
  onboard: (id: string, answers: string[]) => request("POST", `${base(id)}/onboard`, MaintainerBrief, { answers }),
  importIssues: (id: string, body: ImportIssuesRequest) => request("POST", `${base(id)}/import`, ImportIssuesResponse, body),
  drafts: (id: string) => request("GET", `${base(id)}/drafts`, z.array(DraftTask)),
  updateDraft: (id: string, draftId: string, spec: TaskSpec) => request("PUT", `${base(id)}/drafts/${draftId}`, DraftTask, { spec }),
  approve: (id: string, draftId: string) => request("POST", `${base(id)}/drafts/${draftId}/approve`, ApproveDraftResponse),
  reject: (id: string, draftId: string) => request("POST", `${base(id)}/drafts/${draftId}/reject`, Ok),
  decisions: (id: string) => request("GET", `${base(id)}/decisions`, z.array(Decision)),
  resolve: (id: string, decisionId: string, optionId: string, note?: string) =>
    request("POST", `${base(id)}/decisions/${decisionId}/resolve`, Decision, { optionId, note }),
};

const mkeys = {
  brief: (id: string) => ["maintain", id, "brief"] as const,
  drafts: (id: string) => ["maintain", id, "drafts"] as const,
  decisions: (id: string) => ["maintain", id, "decisions"] as const,
};

export const useBrief = (id: string) => useQuery({ queryKey: mkeys.brief(id), queryFn: () => maintainApi.brief(id) });
export const useDrafts = (id: string) => useQuery({ queryKey: mkeys.drafts(id), queryFn: () => maintainApi.drafts(id) });
export const useInbox = (id: string) => useQuery({ queryKey: mkeys.decisions(id), queryFn: () => maintainApi.decisions(id) });

export function useOnboard(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (answers: string[]) => maintainApi.onboard(id, answers),
    onSuccess: (b) => qc.setQueryData(mkeys.brief(id), b),
  });
}

export function useImport(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportIssuesRequest) => maintainApi.importIssues(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: mkeys.drafts(id) }),
  });
}

export function useDraftActions(id: string) {
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: mkeys.drafts(id) }), qc.invalidateQueries({ queryKey: keys.project(id) })]);
  return {
    update: useMutation({ mutationFn: (v: { draftId: string; spec: TaskSpec }) => maintainApi.updateDraft(id, v.draftId, v.spec), onSettled: refresh }),
    approve: useMutation({ mutationFn: (draftId: string) => maintainApi.approve(id, draftId), onSettled: refresh }),
    reject: useMutation({ mutationFn: (draftId: string) => maintainApi.reject(id, draftId), onSettled: refresh }),
  };
}

export function useResolveInbox(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { decisionId: string; optionId: string; note?: string }) => maintainApi.resolve(id, v.decisionId, v.optionId, v.note),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: mkeys.decisions(id) }),
        qc.invalidateQueries({ queryKey: keys.decisions }),
        qc.invalidateQueries({ queryKey: keys.project(id) }),
        qc.invalidateQueries({ queryKey: keys.dashboard }),
      ]),
  });
}
