<script lang="ts">
  import { Link } from 'svelte-routing';

  interface ExternalJoinLink {
    kind: string;
    label: string;
    description: string;
    href: string;
    host: string;
    external: true;
  }

  interface InternalJoinLink {
    kind: string;
    label: string;
    description: string;
    to: string;
    host: string;
    external: false;
  }

  type JoinLink = ExternalJoinLink | InternalJoinLink;

  const supportedLocales = ['en', 'es'] as const;
  type JoinLocale = (typeof supportedLocales)[number];

  interface JoinCopy {
    title: string;
    metaDescription: string;
    brand: string;
    eyebrow: string;
    heading: string;
    description: string;
    linksLabel: string;
    links: JoinLink[];
  }

  const joinCopy: Record<JoinLocale, JoinCopy> = {
    en: {
      title: 'Join Syscoin | Proof of Builders',
      metaDescription: 'Join the Syscoin community, prepare for AI and blockchain seminars, and explore Proof-of-Builders.',
      brand: 'Syscoin',
      eyebrow: 'Start here',
      heading: 'Join Syscoin and start building',
      description: 'Seminars, community, updates, and Proof-of-Builders.',
      linksLabel: 'Syscoin community links',
      links: [
        {
          kind: 'Start',
          label: 'Seminar preparation guide',
          description: 'Tools and accounts checklist',
          href: 'https://support.syscoin.org/t/guia-de-preparacion-para-seminarios-ia-blockchain/885',
          host: 'support.syscoin.org',
          external: true,
        },
        {
          kind: 'Community',
          label: 'Syscoin Spanish community on X',
          description: 'Spanish-language updates',
          href: 'https://x.com/Syscoin_Hispano',
          host: 'x.com/Syscoin_Hispano',
          external: true,
        },
        {
          kind: 'Discord',
          label: 'Join Syscoin Discord',
          description: 'Official community server',
          href: 'https://support.syscoin.org/t/como-unirse-a-la-comunidad-de-syscoin-en-discord/873',
          host: 'support.syscoin.org',
          external: true,
        },
        {
          kind: 'Portal',
          label: 'Open Proof-of-Builders',
          description: 'Projects, badges, and certs',
          to: '/',
          host: 'pob.syscoin.org',
          external: false,
        },
        {
          kind: 'Updates',
          label: 'Syscoin global updates on X',
          description: 'Ecosystem news',
          href: 'https://x.com/Syscoin',
          host: 'x.com/Syscoin',
          external: true,
        },
      ],
    },
    es: {
      title: 'Unete a Syscoin | Proof of Builders',
      metaDescription: 'Unete a la comunidad de Syscoin, preparate para seminarios de IA y blockchain, y explora Proof-of-Builders.',
      brand: 'Syscoin',
      eyebrow: 'Empieza aqui',
      heading: 'Unete a Syscoin y empieza a construir',
      description: 'Seminarios, comunidad, novedades y Proof-of-Builders.',
      linksLabel: 'Enlaces de la comunidad Syscoin',
      links: [
        {
          kind: 'Inicio',
          label: 'Guia de preparacion para seminarios',
          description: 'Checklist de herramientas y cuentas',
          href: 'https://support.syscoin.org/t/guia-de-preparacion-para-seminarios-ia-blockchain/885',
          host: 'support.syscoin.org',
          external: true,
        },
        {
          kind: 'Comunidad',
          label: 'Comunidad Syscoin en Espanol en X',
          description: 'Novedades en espanol',
          href: 'https://x.com/Syscoin_Hispano',
          host: 'x.com/Syscoin_Hispano',
          external: true,
        },
        {
          kind: 'Discord',
          label: 'Unete al Discord de Syscoin',
          description: 'Servidor oficial de la comunidad',
          href: 'https://support.syscoin.org/t/como-unirse-a-la-comunidad-de-syscoin-en-discord/873',
          host: 'support.syscoin.org',
          external: true,
        },
        {
          kind: 'Portal',
          label: 'Abrir Proof-of-Builders',
          description: 'Proyectos, badges y certs',
          to: '/',
          host: 'pob.syscoin.org',
          external: false,
        },
        {
          kind: 'Novedades',
          label: 'Novedades globales de Syscoin en X',
          description: 'Noticias del ecosistema',
          href: 'https://x.com/Syscoin',
          host: 'x.com/Syscoin',
          external: true,
        },
      ],
    },
  };

  function isSupportedLocale(language: string): language is JoinLocale {
    return supportedLocales.includes(language as JoinLocale);
  }

  function detectJoinLocale(): JoinLocale {
    if (typeof navigator === 'undefined') return 'en';

    const browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const browserLanguage of browserLanguages) {
      const locale = browserLanguage.toLowerCase().split('-')[0];
      if (isSupportedLocale(locale)) return locale;
    }

    return 'en';
  }

  const copy = joinCopy[detectJoinLocale()];
</script>

<svelte:head>
  <title>{copy.title}</title>
  <meta
    name="description"
    content={copy.metaDescription}
  />
</svelte:head>

<div class="pob-page join-page">
  <div class="join-page__shell">
    <section class="pob-pane join-page__panel">
      <div class="join-page__brand">
        <div class="join-page__badge">
          <img src="/syscoin.svg" alt="Syscoin" class="join-page__logo" />
          <span class="pob-pane__meta">{copy.brand}</span>
        </div>
        <span class="pob-pill pob-pill--upcoming">{copy.eyebrow}</span>
      </div>

      <div class="join-page__copy">
        <h2 class="join-page__title">{copy.heading}</h2>
        <p class="join-page__description">
          {copy.description}
        </p>
      </div>

      <div class="join-page__links" aria-label={copy.linksLabel}>
        {#each copy.links as link (link.label)}
          {#if link.external}
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              class="join-page__link pob-button pob-button--outline"
            >
              <span class="join-page__kind">{link.kind}</span>
              <span class="join-page__text">
                <span class="join-page__label">{link.label}</span>
                <span class="join-page__meta">{link.description}</span>
              </span>
            </a>
          {:else}
            <Link to={link.to} class="join-page__link pob-button pob-button--outline">
              <span class="join-page__kind">{link.kind}</span>
              <span class="join-page__text">
                <span class="join-page__label">{link.label}</span>
                <span class="join-page__meta">{link.description}</span>
              </span>
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
    max-width: 40rem;
    margin: 0 auto;
  }

  .join-page__panel {
    display: grid;
    gap: 1.5rem;
    padding: 2rem;
    overflow: hidden;
    background:
      radial-gradient(circle at top right, rgba(247, 147, 26, 0.12), transparent 34%),
      rgba(12, 12, 14, 0.82);
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
    position: relative;
    z-index: 1;
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
    position: relative;
    z-index: 1;
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
    letter-spacing: 0.01em;
  }

  .join-page__links {
    position: relative;
    z-index: 1;
    display: grid;
    gap: 0.75rem;
  }

  .join-page__link {
    width: 100%;
    justify-content: space-between;
    text-align: left;
    padding: 0.9rem 1rem;
    color: var(--pob-text);
    text-transform: none;
    letter-spacing: 0.01em;
    gap: 1rem;
    background: rgba(16, 17, 17, 0.78);
    border-color: rgba(255, 255, 255, 0.07);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.05),
      inset 0 -1px 0 rgba(0, 0, 0, 0.2);
    transition: transform 160ms ease, border-color 160ms ease, opacity 160ms ease, box-shadow 160ms ease;
  }

  .join-page__link:hover,
  .join-page__link:focus-visible {
    transform: translateY(-1px);
    opacity: 0.92;
    border-color: rgba(247, 147, 26, 0.36);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      inset 0 -1px 0 rgba(0, 0, 0, 0.22),
      0 14px 32px rgba(0, 0, 0, 0.18);
  }

  .join-page__kind {
    flex: 0 0 auto;
    min-width: 5rem;
    border-radius: 0.4rem;
    padding: 0.28rem 0.5rem;
    background: rgba(255, 255, 255, 0.055);
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--pob-primary);
    text-align: center;
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

  @media (max-width: 768px) {
    .join-page__panel {
      padding: 1.4rem;
    }

    .join-page__link {
      align-items: flex-start;
      flex-direction: column;
    }

    .join-page__kind {
      min-width: 0;
    }
  }
</style>
