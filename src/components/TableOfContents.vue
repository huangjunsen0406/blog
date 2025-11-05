<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

interface Heading {
  depth: number;
  slug: string;
  text: string;
}

const props = defineProps<{
  headings: Heading[];
}>();

const activeId = ref('');

const handleScroll = () => {
  const headingElements = props.headings
    .map(({ slug }) => document.getElementById(slug))
    .filter((el): el is HTMLElement => el !== null);

  const scrollPosition = window.scrollY + 100;

  for (let i = headingElements.length - 1; i >= 0; i--) {
    const element = headingElements[i];
    if (element.offsetTop <= scrollPosition) {
      activeId.value = element.id;
      break;
    }
  }
};

onMounted(() => {
  window.addEventListener('scroll', handleScroll);
  handleScroll();
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
});

const scrollToHeading = (slug: string) => {
  const element = document.getElementById(slug);
  if (element) {
    const offset = 80;
    const elementPosition = element.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - offset;

    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth',
    });
  }
};
</script>

<template>
  <nav class="toc">
    <h3 class="toc-title">目录</h3>
    <ul class="toc-list">
      <li
        v-for="heading in headings"
        :key="heading.slug"
        :class="[
          'toc-item',
          `toc-level-${heading.depth}`,
          { 'toc-active': activeId === heading.slug }
        ]"
      >
        <a
          :href="`#${heading.slug}`"
          class="toc-link"
          @click.prevent="scrollToHeading(heading.slug)"
        >
          {{ heading.text }}
        </a>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.toc {
  position: sticky;
  top: 2rem;
  max-height: calc(100vh - 4rem);
  overflow-y: auto;
  padding: 1.5rem;
  background: rgba(var(--gray-light), 0.1);
  border-radius: 0.5rem;
  border: 1px solid rgb(var(--gray-light));
}

.toc-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 1rem 0;
  color: rgb(var(--black));
}

.toc-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.toc-item {
  margin: 0.5rem 0;
  line-height: 1.6;
}

.toc-level-2 {
  padding-left: 0;
}

.toc-level-3 {
  padding-left: 1rem;
}

.toc-level-4 {
  padding-left: 2rem;
}

.toc-link {
  text-decoration: none;
  color: var(--ring);
  font-size: 0.875rem;
  transition: color 0.2s ease;
  display: block;
}

.toc-link:hover {
  color: var(--title);
}

.toc-active .toc-link {
  color: var(--title);
  font-weight: 500;
}

/* 滚动条样式 */
.toc::-webkit-scrollbar {
  width: 4px;
}

.toc::-webkit-scrollbar-track {
  background: transparent;
}

.toc::-webkit-scrollbar-thumb {
  background: rgb(var(--gray-light));
  border-radius: 2px;
}

.toc::-webkit-scrollbar-thumb:hover {
  background: rgb(var(--gray));
}

@media (max-width: 1200px) {
  .toc {
    display: none;
  }
}
</style>
