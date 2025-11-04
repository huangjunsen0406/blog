<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Moon, Sun } from 'lucide-vue-next'

const theme = ref<'light' | 'dark'>('light')

const toggleTheme = () => {
  theme.value = theme.value === 'light' ? 'dark' : 'light'

  if (theme.value === 'dark') {
    document.documentElement.classList.add('dark')
    localStorage.setItem('theme', 'dark')
  } else {
    document.documentElement.classList.remove('dark')
    localStorage.setItem('theme', 'light')
  }
}

onMounted(() => {
  const savedTheme = localStorage.getItem('theme')
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

  if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
    theme.value = 'dark'
    document.documentElement.classList.add('dark')
  } else {
    theme.value = 'light'
    document.documentElement.classList.remove('dark')
  }
})
</script>

<template>
  <button
    @click="toggleTheme"
    class="theme-toggle"
    :aria-label="theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'"
  >
    <Sun v-if="theme === 'light'" :size="20" />
    <Moon v-else :size="20" />
  </button>
</template>

<style scoped>
.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: rgb(var(--black));
  transition: all 0.2s ease;
  border-radius: 8px;
  padding: 0.5rem;
}

.theme-toggle:hover {
  background: rgba(var(--gray-light), 0.6);
  transform: scale(1.05);
}
</style>
