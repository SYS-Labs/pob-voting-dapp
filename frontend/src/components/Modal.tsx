import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  isOpen: boolean;
  onClose?: () => void;
  children: ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

/**
 * Generic centered modal wrapper component
 * Provides consistent backdrop, centering, and styling for all modals
 * Uses React Portal to render at document root for proper fixed positioning
 */
export default function Modal({
  isOpen,
  onClose,
  children,
  maxWidth = 'md',
  closeOnBackdropClick = true,
  closeOnEscape = true,
  showCloseButton = true,
}: ModalProps) {
  // Handle ESC key press
  useEffect(() => {
    if (!isOpen || !closeOnEscape || !onClose) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, closeOnEscape, onClose]);

  if (!isOpen) return null;

  const handleBackdropClick = () => {
    if (closeOnBackdropClick && onClose) {
      onClose();
    }
  };

  const modalContent = (
    <div
      className="fixed left-0 top-0 z-50 flex h-screen w-screen items-center justify-center p-4"
      style={{ position: 'fixed', inset: 0 }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Modal Content */}
      <div className={`relative z-10 ${maxWidthClasses[maxWidth]}`}>
        {showCloseButton && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center border-0 bg-transparent text-2xl leading-none text-[var(--pob-primary)] transition-all hover:brightness-125 hover:scale-110"
            aria-label="Close modal"
            style={{ position: 'absolute', right: '1rem', top: '1rem' }}
          >
            ✕
          </button>
        )}
        {children}
      </div>
    </div>
  );

  // Render modal at document root to escape relative positioned parents
  return createPortal(modalContent, document.body);
}
