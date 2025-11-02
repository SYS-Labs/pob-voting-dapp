import { useCallback, useState } from 'react';

export function useAdminPanel() {
  const [openAdminSection, setOpenAdminSection] = useState<string | null>('activate');

  const handleToggleAdminSection = useCallback((sectionId: string) => {
    setOpenAdminSection((current) => (current === sectionId ? null : sectionId));
  }, []);

  return {
    openAdminSection,
    handleToggleAdminSection,
  };
}
