import { useState } from 'react';
import type { Project } from '~/interfaces';

export function useModals() {
  const [switchNetworkModalOpen, setSwitchNetworkModalOpen] = useState<boolean>(false);
  const [disconnectModalOpen, setDisconnectModalOpen] = useState<boolean>(false);
  const [pendingRemovalVoter, setPendingRemovalVoter] = useState<string | null>(null);
  const [pendingRemovalProject, setPendingRemovalProject] = useState<Project | null>(null);

  return {
    switchNetworkModalOpen,
    setSwitchNetworkModalOpen,
    disconnectModalOpen,
    setDisconnectModalOpen,
    pendingRemovalVoter,
    setPendingRemovalVoter,
    pendingRemovalProject,
    setPendingRemovalProject,
  };
}
