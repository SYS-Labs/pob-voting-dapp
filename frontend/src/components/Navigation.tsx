interface NavigationProps {
  currentPage: 'iterations' | 'iteration' | 'badges' | 'faq';
  onNavigate: (page: 'iterations' | 'iteration' | 'badges' | 'faq') => void;
  showIterationTab: boolean;
  showBadgesTab: boolean;
}

/**
 * Tab-based navigation component
 */
export default function Navigation({ currentPage, onNavigate, showIterationTab, showBadgesTab }: NavigationProps) {
  const tabs: Array<{ id: 'iterations' | 'iteration' | 'badges' | 'faq'; label: string; show: boolean }> = [
    { id: 'iterations', label: 'Iterations', show: true },
    { id: 'iteration', label: 'Iteration', show: showIterationTab },
    { id: 'badges', label: 'Badges', show: showBadgesTab },
    { id: 'faq', label: 'FAQ', show: true },
  ];

  return (
    <nav className="pob-nav">
      <div className="pob-nav__tabs">
        {tabs
          .filter((tab) => tab.show)
          .map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onNavigate(tab.id)}
              className={`pob-nav__tab ${currentPage === tab.id ? 'pob-nav__tab--active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
      </div>
    </nav>
  );
}
