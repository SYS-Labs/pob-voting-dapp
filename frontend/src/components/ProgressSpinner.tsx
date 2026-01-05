interface ProgressSpinnerProps {
  size?: number;
  rotationDuration?: number;
  className?: string;
  /**
   * Progress value from 0 to 100
   * If provided, shows static progress instead of spinning animation
   */
  progress?: number;
}

/**
 * Reusable circular progress spinner
 * Used for transaction pending states and confirmation progress
 *
 * @param progress - Optional progress value (0-100). If provided, shows static progress circle.
 *                   If omitted, shows continuous spinning animation.
 */
export const ProgressSpinner = ({
  size = 48,
  rotationDuration = 2,
  className = '',
  progress,
}: ProgressSpinnerProps) => {
  const radius = (size / 48) * 20;
  const strokeWidth = (size / 48) * 4;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  // If progress is provided, calculate offset for static progress display
  // Otherwise use 25% offset for spinning animation
  const progressOffset = progress !== undefined
    ? circumference * (1 - progress / 100)
    : circumference * 0.25;

  return (
    <div
      className={`tx-spinner ${className}`}
      style={{
        ['--rotation-duration' as string]: `${rotationDuration}s`,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ transform: 'rotate(-90deg)' }}
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke="rgba(247, 147, 26, 0.2)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke="rgb(247, 147, 26)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={progressOffset}
          className={progress === undefined ? 'tx-spinner__circle' : ''}
        />
      </svg>
    </div>
  );
};
