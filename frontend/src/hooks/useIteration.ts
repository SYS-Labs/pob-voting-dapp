import { useEffect, useMemo, useState } from 'react';
import type { Iteration } from '~/interfaces';

export function useIteration(chainId: number | null) {
  const [iterations, setIterations] = useState<Iteration[]>([]);
  const [selectedIterationNumber, setSelectedIteration] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const filteredIterations = useMemo(() => {
    if (chainId === null) return iterations;
    return iterations.filter((iteration) => iteration.chainId === chainId);
  }, [iterations, chainId]);

  const currentIteration = useMemo(() => {
    if (!filteredIterations.length) return null;
    if (selectedIterationNumber === null) return filteredIterations[0];
    return filteredIterations.find((iteration) => iteration.iteration === selectedIterationNumber) ?? filteredIterations[0];
  }, [filteredIterations, selectedIterationNumber]);

  useEffect(() => {
    if (!filteredIterations.length) {
      if (selectedIterationNumber !== null) {
        setSelectedIteration(null);
      }
      return;
    }
    if (
      selectedIterationNumber !== null &&
      !filteredIterations.some((iteration) => iteration.iteration === selectedIterationNumber)
    ) {
      setSelectedIteration(filteredIterations[0].iteration);
    }
  }, [filteredIterations, selectedIterationNumber]);

  useEffect(() => {
    // In production, always use iterations.json
    // In development, try local first, then fallback to production config
    const isProduction = import.meta.env.PROD;

    setLoading(true);
    setError(null);

    if (isProduction) {
      console.log('[Iterations] Loading from iterations.json (production)');
      fetch('/iterations.json')
        .then((res) => {
          if (!res.ok) {
            throw new Error(`Failed to load iterations.json: ${res.status}`);
          }
          return res.json();
        })
        .then((data: Iteration[]) => {
          setIterations(data);
          setLoading(false);
          console.log('[Iterations] Loaded', data.length, 'iterations');
        })
        .catch((err) => {
          console.error('[Iterations] Failed to load iterations', err);
          setError(err.message || 'Failed to load iterations manifest.');
          setLoading(false);
        });
    } else {
      // Dev mode: try local first, fallback to production
      fetch('/iterations.local.json')
        .then((res) => {
          if (res.ok) {
            console.log('[Iterations] Loading from iterations.local.json (dev mode)');
            return res.json();
          }
          throw new Error('Local config not found');
        })
        .catch(() => {
          console.log('[Iterations] Loading from iterations.json (fallback)');
          return fetch('/iterations.json').then((res) => {
            if (!res.ok) {
              throw new Error(`Failed to load iterations.json: ${res.status}`);
            }
            return res.json();
          });
        })
        .then((data: Iteration[]) => {
          setIterations(data);
          setLoading(false);
          console.log('[Iterations] Loaded', data.length, 'iterations');
        })
        .catch((err) => {
          console.error('[Iterations] Failed to load iterations', err);
          setError(err.message || 'Failed to load iterations manifest.');
          setLoading(false);
        });
    }
  }, []);

  return {
    iterations,
    iterationsLoading: loading,
    iterationsError: error,
    selectedIterationNumber,
    setSelectedIteration,
    filteredIterations,
    currentIteration,
  };
}
