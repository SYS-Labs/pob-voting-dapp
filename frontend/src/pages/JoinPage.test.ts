import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('svelte-routing', async () => ({
  Link: (await import('~/test/LinkStub.svelte')).default,
}));

import JoinPage from './JoinPage.svelte';

describe('JoinPage', () => {
  it('renders the join heading and all requested links', () => {
    const { container } = render(JoinPage);

    expect(screen.getByRole('heading', { name: /Unete a la comunidad de Syscoin/i })).toBeTruthy();

    expect(screen.getByRole('link', { name: /Guia de preparacion/i }).getAttribute('href')).toBe(
      'https://support.syscoin.org/t/guia-de-preparacion-para-seminarios-ia-blockchain/885'
    );
    expect(screen.getByRole('link', { name: /Syscoin en Espanol/i }).getAttribute('href')).toBe(
      'https://x.com/Syscoin_Hispano'
    );
    expect(screen.getByRole('link', { name: /Comunidad de Syscoin en Discord/i }).getAttribute('href')).toBe(
      'https://support.syscoin.org/t/como-unirse-a-la-comunidad-de-syscoin-en-discord/873'
    );
    expect(screen.getByRole('link', { name: /Portal de Proof-of-Builders/i }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: /Syscoin Global en X/i }).getAttribute('href')).toBe(
      'https://x.com/Syscoin'
    );

    expect(container.querySelectorAll('a')).toHaveLength(5);
  });
});
