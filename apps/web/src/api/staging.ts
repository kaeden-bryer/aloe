/**
 * Staging status (GET /api/projects/:id/staging): where merged tasks are on their way to the
 * fork's PR. Its own file so the main client and hooks stay untouched.
 */
import { useQuery } from "@tanstack/react-query";
import { StagingStatus } from "@aloe/core/contracts";
import { request } from "./client";

/** Polls every 5 s so the PR link appears by itself during a live demo (the route only reads our DB). */
export const useStaging = (projectId: string) =>
  useQuery({
    queryKey: ["staging", projectId] as const,
    queryFn: () => request("GET", `/api/projects/${encodeURIComponent(projectId)}/staging`, StagingStatus),
    refetchInterval: 5000,
  });
