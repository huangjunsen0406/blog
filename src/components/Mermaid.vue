<script setup lang="ts">
import { onMounted } from 'vue';
import mermaid from 'mermaid';

onMounted(() => {
  mermaid.initialize({
    startOnLoad: true,
    theme: 'default',
    securityLevel: 'loose',
  });
  mermaid.run();
});
</script>

<template>
  <div class="mermaid-container">
    <slot />
  </div>
</template>

<style scoped>
.mermaid-container {
  margin: 2rem 0;
  padding: 1rem;
  background: rgba(var(--gray-light), 0.1);
  border-radius: 0.5rem;
  overflow-x: auto;
}
</style>
