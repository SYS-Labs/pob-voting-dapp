import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('svelte-routing', async () => ({
  Link: (await import('~/test/LinkStub.svelte')).default,
}));

import JoinPage from './JoinPage.svelte';

function setBrowserLanguages(languages: string[]) {
  Object.defineProperty(window.navigator, 'languages', {
    value: languages,
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'language', {
    value: languages[0] ?? 'en-US',
    configurable: true,
  });
}

describe('JoinPage', () => {
  afterEach(() => {
    setBrowserLanguages(['en-US']);
  });

  it('renders English by default with all requested links', () => {
    setBrowserLanguages(['en-US']);

    const { container } = render(JoinPage);

    expect(screen.getByRole('heading', { name: /Join Syscoin and start building/i })).toBeTruthy();
    expect(screen.queryByText(/linktree/i)).toBeNull();

    expect(screen.getByRole('link', { name: /Seminar preparation guide/i }).getAttribute('href')).toBe(
      'https://support.syscoin.org/t/guia-de-preparacion-para-seminarios-ia-blockchain/885'
    );
    expect(screen.getByRole('link', { name: /Syscoin Spanish community on X/i }).getAttribute('href')).toBe(
      'https://x.com/Syscoin_Hispano'
    );
    expect(screen.getByRole('link', { name: /Join Syscoin Discord/i }).getAttribute('href')).toBe(
      'https://support.syscoin.org/t/como-unirse-a-la-comunidad-de-syscoin-en-discord/873'
    );
    expect(screen.getByRole('link', { name: /Open Proof-of-Builders/i }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: /Syscoin global updates on X/i }).getAttribute('href')).toBe(
      'https://x.com/Syscoin'
    );

    expect(container.querySelectorAll('a')).toHaveLength(5);
  });

  it('renders Spanish when the browser language is Spanish', () => {
    setBrowserLanguages(['es-ES', 'en-US']);

    render(JoinPage);

    expect(screen.getByRole('heading', { name: /Unete a Syscoin y empieza a construir/i })).toBeTruthy();
    expect(screen.queryByText(/linktree/i)).toBeNull();
    expect(screen.getByRole('link', { name: /Guia de preparacion para seminarios/i }).getAttribute('href')).toBe(
      'https://support.syscoin.org/t/guia-de-preparacion-para-seminarios-ia-blockchain/885'
    );
    expect(screen.getByRole('link', { name: /Comunidad Syscoin en Espanol en X/i }).getAttribute('href')).toBe(
      'https://x.com/Syscoin_Hispano'
    );
  });
});
