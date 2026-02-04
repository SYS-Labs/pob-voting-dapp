<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    isOpen: boolean;
    onClose?: () => void;
    children: Snippet;
    maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
    closeOnBackdropClick?: boolean;
    closeOnEscape?: boolean;
    showCloseButton?: boolean;
  }

  let {
    isOpen,
    onClose,
    children,
    maxWidth = 'md',
    closeOnBackdropClick = true,
    closeOnEscape = true,
    showCloseButton = true,
  }: Props = $props();

  const maxWidthClasses: Record<string, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
  };

  // Portal container reference
  let portalContainer: HTMLDivElement | null = null;
  let modalElement = $state<HTMLDivElement | null>(null);

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && closeOnEscape && onClose) {
      onClose();
    }
  }

  function handleBackdropClick() {
    if (closeOnBackdropClick && onClose) {
      onClose();
    }
  }

  // Create portal container and move modal to body
  function createPortal() {
    if (typeof document === 'undefined') return;

    portalContainer = document.createElement('div');
    portalContainer.setAttribute('data-modal-portal', '');
    document.body.appendChild(portalContainer);
  }

  function destroyPortal() {
    if (portalContainer && portalContainer.parentNode) {
      portalContainer.parentNode.removeChild(portalContainer);
      portalContainer = null;
    }
  }

  // Move the modal element to the portal when it exists
  $effect(() => {
    if (isOpen && modalElement && portalContainer) {
      portalContainer.appendChild(modalElement);
    }
  });

  $effect(() => {
    if (isOpen && closeOnEscape) {
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  });

  onMount(() => {
    createPortal();
  });

  onDestroy(() => {
    destroyPortal();
  });
</script>

{#if isOpen}
  <div
    bind:this={modalElement}
    class="fixed left-0 top-0 z-50 flex h-screen w-screen items-center justify-center p-4"
    style="position: fixed; inset: 0;"
  >
    <!-- Backdrop -->
    <div
      class="absolute inset-0 bg-black/80 backdrop-blur-sm"
      onclick={handleBackdropClick}
      onkeydown={(e) => e.key === 'Escape' && handleBackdropClick()}
      role="button"
      tabindex="-1"
      aria-hidden="true"
    ></div>

    <!-- Modal Content -->
    <div class="relative z-10 {maxWidthClasses[maxWidth]}">
      {#if showCloseButton && onClose}
        <button
          type="button"
          onclick={onClose}
          class="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center border-0 bg-transparent text-2xl leading-none text-[var(--pob-primary)] transition-all hover:brightness-125 hover:scale-110"
          aria-label="Close modal"
          style="position: absolute; right: 1rem; top: 1rem;"
        >
          ✕
        </button>
      {/if}
      {@render children()}
    </div>
  </div>
{/if}
