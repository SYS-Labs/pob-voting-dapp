<script lang="ts">
  import { navigate } from 'svelte-routing';

  function goHome() {
    navigate('/');
  }
</script>

<div class="pob-card mx-auto mt-12 max-w-2xl text-center">
  <div class="mb-8">
    <h1 class="mb-4 text-6xl font-bold text-pob-orange">404</h1>
    <h2 class="mb-3 text-2xl font-semibold">Page not found</h2>
    <p class="text-gray-400">
      The page you requested does not exist or may have moved.
    </p>
  </div>

  <div class="border-t border-pob-orange/20 pt-6">
    <button
      type="button"
      onclick={goHome}
      class="pob-button"
    >
      Back to home
    </button>
  </div>
</div>
