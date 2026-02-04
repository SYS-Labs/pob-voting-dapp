<script lang="ts">
  import { navigate } from 'svelte-routing';

  function goHome() {
    navigate('/');
  }
</script>

<div class="pob-card mx-auto mt-12 max-w-4xl text-center">
  <div class="mb-6">
    <h1 class="mb-4 text-6xl font-bold text-pob-orange">404</h1>
    <h2 class="mb-2 text-2xl font-semibold">Iteration Not Found</h2>
    <p class="text-gray-400">The iteration you're looking for doesn't exist... yet!</p>
  </div>

  <div class="mb-8 border-t border-pob-orange/20 pt-8">
    <h3 class="mb-4 text-xl font-semibold text-pob-orange">🎮 While You Wait...</h3>
    <p class="mb-4 text-sm text-gray-400">
      Play 2048! Use arrow keys to combine tiles and reach 2048.
    </p>

    <!-- Injected 2048 Game -->
    <div class="mx-auto" style="max-width: 600px;">
      <iframe
        src="/2048-game/game.html"
        title="2048 Game"
        class="mx-auto rounded-lg border-2 border-pob-orange/30"
        style="width: 100%; height: 700px; border: none;"
        allow="autoplay"
      ></iframe>
    </div>
  </div>

  <div class="border-t border-pob-orange/20 pt-6">
    <button
      onclick={goHome}
      class="pob-button"
    >
      ← Back to Home
    </button>
  </div>
</div>
