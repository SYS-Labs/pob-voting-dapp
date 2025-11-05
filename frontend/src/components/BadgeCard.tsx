import type { Badge } from '~/interfaces';
import { ROLE_LABELS, ROLE_COLORS } from '~/constants/roles';

interface BadgeCardProps {
  badge: Badge;
}

const BadgeCard = ({ badge }: BadgeCardProps) => {
  return (
    <div className="space-y-3">
      {/* NFT Image Placeholder */}
      <div className="aspect-square w-full rounded-lg bg-gradient-to-br from-[var(--pob-orange)]/20 to-[var(--pob-orange)]/5 flex items-center justify-center border border-[var(--pob-orange)]/30">
        <div className="text-center space-y-2">
          <div className="text-4xl">🏅</div>
          <div className="text-xs text-[var(--pob-text-muted)]">
            Iteration {badge.iteration}{badge.round ? ` - Round #${badge.round}` : ''}
          </div>
        </div>
      </div>

      {/* Badge Info: Role tag and ID */}
      <div className="flex items-center justify-between mt-3">
        <span className={`pob-pill ${ROLE_COLORS[badge.role]}`}>
          {ROLE_LABELS[badge.role]}
        </span>
        <span className="text-sm text-[var(--pob-text-muted)]">
          #{badge.tokenId}
        </span>
      </div>
    </div>
  );
};

export default BadgeCard;
