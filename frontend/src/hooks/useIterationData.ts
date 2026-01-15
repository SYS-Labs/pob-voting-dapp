/**
 * useIterationData - Hook for fetching iteration data from the API
 *
 * This hook fetches iteration snapshots from the API indexer,
 * providing a faster alternative to direct RPC calls.
 *
 * The API data is used for display only. Critical pre-action checks
 * (isActive, votingEnded) still use RPC for validation.
 */

import { useCallback, useEffect, useState } from 'react';
import { iterationsAPI, type IterationSnapshot } from '~/utils/iterations-api';
import type { Iteration, Project, ProjectMetadata } from '~/interfaces';

interface UseIterationDataResult {
  snapshot: IterationSnapshot | null;
  projects: Project[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Transform API snapshot projects into frontend Project format
 */
function transformProjects(snapshot: IterationSnapshot): Project[] {
  if (!snapshot.projects) return [];

  return snapshot.projects.map((project, index) => ({
    id: index + 1,
    address: project.address,
    metadata: (project.metadata as unknown as ProjectMetadata) || {
      name: `Project #${index + 1}`,
      account: project.address,
      chainId: snapshot.chainId,
    },
  }));
}

/**
 * Hook for fetching iteration data from API
 *
 * @param currentIteration - The current iteration object
 * @param enabled - Whether to fetch data (default: true)
 */
export function useIterationData(
  currentIteration: Iteration | null,
  enabled = true
): UseIterationDataResult {
  const [snapshot, setSnapshot] = useState<IterationSnapshot | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!currentIteration || !enabled) {
      setSnapshot(null);
      setProjects([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await iterationsAPI.getIteration(
        currentIteration.chainId,
        currentIteration.iteration
      );

      if (data) {
        setSnapshot(data);
        setProjects(transformProjects(data));
      } else {
        // No data from API - this might be a new iteration not yet indexed
        setSnapshot(null);
        setProjects([]);
      }
    } catch (err) {
      console.error('[useIterationData] Failed to fetch iteration:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch iteration data');
      setSnapshot(null);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [currentIteration, enabled]);

  // Fetch when iteration changes
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    snapshot,
    projects,
    loading,
    error,
    refresh: fetchData,
  };
}

/**
 * Hook for fetching all iterations from API
 */
export function useAllIterations(): {
  snapshots: IterationSnapshot[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [snapshots, setSnapshots] = useState<IterationSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await iterationsAPI.getAllIterations();
      setSnapshots(data);
    } catch (err) {
      console.error('[useAllIterations] Failed to fetch iterations:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch iterations');
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    snapshots,
    loading,
    error,
    refresh: fetchData,
  };
}
