<script lang="ts">
  import { Link } from 'svelte-routing';

  interface ExternalJoinLink {
    label: string;
    description: string;
    href: string;
    host: string;
    external: true;
  }

  interface InternalJoinLink {
    label: string;
    description: string;
    to: string;
    host: string;
    external: false;
  }

  type JoinLink = ExternalJoinLink | InternalJoinLink;

  const links: JoinLink[] = [
    {
      label: 'Guia de preparacion',
      description: 'Prepara tu entorno para los seminarios de IA + blockchain.',
      href: 'https://support.syscoin.org/t/guia-de-preparacion-para-seminarios-ia-blockchain/885',
      host: 'support.syscoin.org',
      external: true,
    },
    {
      label: 'Syscoin en Espanol',
      description: 'Sigue anuncios, novedades y contenido de la comunidad hispana.',
      href: 'https://x.com/Syscoin_Hispano',
      host: 'x.com/Syscoin_Hispano',
      external: true,
    },
    {
      label: 'Comunidad de Syscoin en Discord',
      description: 'Entra al Discord oficial con la guia de acceso para la comunidad.',
      href: 'https://support.syscoin.org/t/como-unirse-a-la-comunidad-de-syscoin-en-discord/873',
      host: 'support.syscoin.org',
      external: true,
    },
    {
      label: 'Portal de Proof-of-Builders',
      description: 'Ve al portal principal para explorar iteraciones, badges y certs.',
      to: '/',
      host: 'pob.syscoin.org',
      external: false,
    },
    {
      label: 'Syscoin Global en X',
      description: 'Sigue las actualizaciones globales del ecosistema Syscoin.',
      href: 'https://x.com/Syscoin',
      host: 'x.com/Syscoin',
      external: true,
    },
  ];
</script>

<svelte:head>
  <title>Join Syscoin | Proof of Builders</title>
  <meta
    name="description"
    content="Quick links to join the Syscoin community, prepare for seminars, and enter the Proof-of-Builders portal."
  />
</svelte:head>

<div class="pob-page join-page">
  <div class="join-page__shell">
    <section class="pob-pane join-page__panel">
      <div class="join-page__brand">
        <div class="join-page__badge">
          <img src="/syscoin.svg" alt="Syscoin" class="join-page__logo" />
          <span class="pob-pane__meta">Syscoin Hispano</span>
        </div>
        <span class="pob-pill pob-pill--upcoming">Accesos rapidos</span>
      </div>

      <div class="join-page__copy">
        <h2 class="join-page__title">Unete a la comunidad de Syscoin desde un solo lugar</h2>
        <p class="join-page__description">
          Una pagina ligera, estilo linktree, con los enlaces principales para prepararte, entrar a la comunidad y volver al portal de Proof-of-Builders.
        </p>
      </div>

      <div class="join-page__links" aria-label="Join links">
        {#each links as link, index (link.label)}
          {#if link.external}
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              class="join-page__link pob-button pob-button--outline"
            >
              <span class="join-page__index">{String(index + 1).padStart(2, '0')}</span>
              <span class="join-page__text">
                <span class="join-page__label">{link.label}</span>
                <span class="join-page__meta">{link.description}</span>
              </span>
              <span class="join-page__host">{link.host}</span>
            </a>
          {:else}
            <Link to={link.to} class="join-page__link pob-button pob-button--outline">
              <span class="join-page__index">{String(index + 1).padStart(2, '0')}</span>
              <span class="join-page__text">
                <span class="join-page__label">{link.label}</span>
                <span class="join-page__meta">{link.description}</span>
              </span>
              <span class="join-page__host">{link.host}</span>
            </Link>
          {/if}
        {/each}
      </div>
    </section>
  </div>
</div>

<style>
  .join-page {
    display: grid;
  }

  .join-page__shell {
    width: 100%;
    max-width: 42rem;
    margin: 0 auto;
  }

  .join-page__panel {
    display: grid;
    gap: 1.5rem;
    padding: 2rem;
    overflow: hidden;
  }

  .join-page__panel::before {
    content: '';
    position: absolute;
    inset: 0 auto auto 0;
    width: 100%;
    height: 1px;
    background: linear-gradient(90deg, rgba(247, 147, 26, 0.7), transparent 70%);
  }

  .join-page__brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .join-page__badge {
    display: inline-flex;
    align-items: center;
    gap: 0.9rem;
  }

  .join-page__logo {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 9999px;
    padding: 0.55rem;
    background: rgba(247, 147, 26, 0.12);
    border: 1px solid rgba(247, 147, 26, 0.25);
  }

  .join-page__copy {
    display: grid;
    gap: 0.85rem;
  }

  .join-page__title {
    margin: 0;
    font-size: clamp(2rem, 4vw, 3rem);
    line-height: 1;
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  .join-page__description {
    margin: 0;
    color: var(--pob-text-muted);
    font-size: 1rem;
    line-height: 1.7;
  }

  .join-page__links {
    display: grid;
    gap: 0.9rem;
  }

  .join-page__link {
    width: 100%;
    justify-content: space-between;
    text-align: left;
    padding: 1rem 1.15rem;
    color: var(--pob-text);
    text-transform: none;
    letter-spacing: 0;
    gap: 1rem;
    background: rgba(255, 255, 255, 0.02);
  }

  .join-page__index {
    flex: 0 0 auto;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--pob-primary);
  }

  .join-page__text {
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    gap: 0.2rem;
  }

  .join-page__label {
    font-size: 1rem;
    font-weight: 600;
    color: var(--pob-text);
  }

  .join-page__meta {
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--pob-text-muted);
  }

  .join-page__host {
    flex: 0 0 auto;
    font-size: 0.75rem;
    color: var(--pob-primary);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  @media (max-width: 768px) {
    .join-page__panel {
      padding: 1.4rem;
    }

    .join-page__link {
      align-items: flex-start;
      flex-direction: column;
    }

    .join-page__host {
      font-size: 0.7rem;
      letter-spacing: 0.05em;
    }
  }
</style>
