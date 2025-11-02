import { useCallback, useEffect, useState } from 'react';
import type { Project, ProjectMetadata } from '~/interfaces';
import { formatAddress } from '~/utils/format';

export function useProjectMetadata() {
  const [projectMetadata, setProjectMetadata] = useState<Record<string, ProjectMetadata>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const isProduction = import.meta.env.PROD;

    const loadProjectMetadata = async (): Promise<ProjectMetadata[]> => {
      if (isProduction) {
        console.log('[Projects] Loading metadata from projects.json (production)');
        const response = await fetch('/projects.json');
        if (!response.ok) {
          throw new Error(`Failed to load projects.json: ${response.status}`);
        }
        return (await response.json()) as ProjectMetadata[];
      } else {
        // Dev mode: try local first, fallback to production
        try {
          const localResponse = await fetch('/projects.local.json');
          if (!localResponse.ok) {
            throw new Error(`projects.local.json responded with ${localResponse.status}`);
          }
          console.log('[Projects] Loading metadata from projects.local.json (dev mode)');
          return (await localResponse.json()) as ProjectMetadata[];
        } catch (localError) {
          console.log('[Projects] Fallback to projects.json', localError);
          const response = await fetch('/projects.json');
          if (!response.ok) {
            throw new Error(`Failed to load projects.json: ${response.status}`);
          }
          return (await response.json()) as ProjectMetadata[];
        }
      }
    };

    setLoading(true);
    setError(null);
    loadProjectMetadata()
      .then((entries) => {
        const map: Record<string, ProjectMetadata> = {};
        entries.forEach((entry) => {
          if (!entry?.account) return;
          const key = `${entry.chainId}:${entry.account.toLowerCase()}`;
          map[key] = entry;
        });
        setProjectMetadata(map);
        setLoading(false);
        console.log('[Projects] Loaded metadata entries:', Object.keys(map).length);
      })
      .catch((metadataError) => {
        console.error('[Projects] Failed to load metadata', metadataError);
        setError(metadataError.message || 'Failed to load project metadata');
        setLoading(false);
      });
  }, []);

  const getProjectLabel = useCallback(
    (address: string | null, projects: Project[]) => {
      if (!address) return null;
      const match = projects.find((projectItem) => projectItem.address.toLowerCase() === address.toLowerCase());
      if (match) {
        if (match.metadata?.name) {
          return match.metadata.name;
        }
        return `Project #${match.id}`;
      }
      return formatAddress(address);
    },
    [],
  );

  return {
    projectMetadata,
    projectMetadataLoading: loading,
    projectMetadataError: error,
    getProjectLabel,
  };
}
