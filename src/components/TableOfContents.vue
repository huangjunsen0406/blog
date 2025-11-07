<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue';

interface Heading {
  depth: number;
  slug: string;
  text: string;
}

const props = defineProps<{
  headings: Heading[];
}>();

const activeId = ref('');
const tocListRef = ref<HTMLElement | null>(null);

const handleScroll = () => {
  const headingElements = props.headings
    .map(({ slug }) => document.getElementById(slug))
    .filter((el): el is HTMLElement => el !== null);

  const scrollPosition = window.scrollY + 150;

  let currentActiveId = '';
  
  for (let i = 0; i < headingElements.length; i++) {
    const element = headingElements[i];
    const elementTop = element.offsetTop;
    
    if (elementTop <= scrollPosition) {
      currentActiveId = element.id;
    } else {
      break;
    }
  }

  if (currentActiveId && currentActiveId !== activeId.value) {
    activeId.value = currentActiveId;
    nextTick(() => {
      scrollActiveItemIntoView();
    });
  }
};

const scrollActiveItemIntoView = () => {
  if (!tocListRef.value) return;
  
  const activeElement = tocListRef.value.querySelector('.toc-active');
  if (activeElement) {
    activeElement.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }
};

onMounted(() => {
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
});

const scrollToHeading = (slug: string) => {
  const element = document.getElementById(slug);
  if (element) {
    const offset = 100;
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
    <ul class="toc-list" ref="tocListRef">
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
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1.5rem;
  background: rgba(var(--gray-light), 0.1);
  border-radius: 0.5rem;
  border: 1px solid rgb(var(--gray-light));
  box-sizing: border-box;
}

.toc-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 1rem 0;
  color: rgb(var(--black));
  flex-shrink: 0;
}

.toc-list {
  list-style: none;
  padding: 0;
  margin: 0;
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
  min-height: 0;
}

.toc-item {
  margin: 0.5rem 0;
  line-height: 1.6;
  transition: all 0.2s ease;
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
  transition: all 0.2s ease;
  display: block;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
}

.toc-link:hover {
  color: var(--title);
  background: rgba(var(--gray-light), 0.1);
}

.toc-active .toc-link {
  color: var(--title);
  font-weight: 600;
}

/* 滚动条样式 */
.toc-list::-webkit-scrollbar {
  width: 4px;
}

.toc-list::-webkit-scrollbar-track {
  background: transparent;
}

.toc-list::-webkit-scrollbar-thumb {
  background: rgba(var(--gray-light), 0.5);
  border-radius: 2px;
}

.toc-list::-webkit-scrollbar-thumb:hover {
  background: rgb(var(--gray));
}

@media (max-width: 1200px) {
  .toc {
    display: none;
  }
}
</style>
