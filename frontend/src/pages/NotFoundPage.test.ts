import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
}));

vi.mock('svelte-routing', () => ({
  navigate: navigateMock,
}));

import NotFoundPage from './NotFoundPage.svelte';

describe('NotFoundPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a generic 404 page without the missing game iframe', () => {
    const { container } = render(NotFoundPage);

    expect(screen.getByRole('heading', { name: '404' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Page not found/i })).toBeTruthy();
    expect(screen.getByText(/does not exist or may have moved/i)).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('navigates home from the action button', async () => {
    render(NotFoundPage);

    await fireEvent.click(screen.getByRole('button', { name: /Back to home/i }));

    expect(navigateMock).toHaveBeenCalledWith('/');
  });
});
