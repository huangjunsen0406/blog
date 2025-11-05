<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Search, X } from 'lucide-vue-next';

interface Post {
  id: string;
  data: {
    title: string;
    description: string;
    pubDate: Date;
    tags?: string[];
    categories?: string[];
  };
}

const props = defineProps<{
  posts: Post[];
}>();

const isOpen = ref(false);
const searchQuery = ref('');
const isMounted = ref(false);

const filteredPosts = computed(() => {
  if (!searchQuery.value.trim()) {
    return [];
  }

  const query = searchQuery.value.toLowerCase();
  return props.posts
    .filter((post) => {
      const titleMatch = post.data.title.toLowerCase().includes(query);
      const descMatch = post.data.description.toLowerCase().includes(query);
      const tagsMatch = post.data.tags?.some((tag) => tag.toLowerCase().includes(query));
      const categoriesMatch = post.data.categories?.some((cat) => cat.toLowerCase().includes(query));

      return titleMatch || descMatch || tagsMatch || categoriesMatch;
    })
    .slice(0, 10);
});

const openSearch = () => {
  isOpen.value = true;
  setTimeout(() => {
    document.getElementById('search-input')?.focus();
  }, 100);
};

const closeSearch = () => {
  isOpen.value = false;
  searchQuery.value = '';
};

// 键盘快捷键
const handleKeydown = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    if (isOpen.value) {
      closeSearch();
    } else {
      openSearch();
    }
  }
  if (e.key === 'Escape' && isOpen.value) {
    closeSearch();
  }
};

onMounted(() => {
  isMounted.value = true;
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div>
    <!-- 搜索按钮 -->
    <button @click="openSearch" class="search-button" aria-label="搜索">
      <Search :size="20" />
    </button>

    <!-- 搜索弹窗 -->
    <Teleport to="body" v-if="isMounted">
      <Transition name="modal">
        <div v-if="isOpen" class="modal-overlay" @click="closeSearch">
          <div class="modal-content" @click.stop>
            <div class="search-header">
              <Search :size="20" class="search-icon" />
              <input
                id="search-input"
                v-model="searchQuery"
                type="text"
                placeholder="搜索文章..."
                class="search-input"
              />
              <button @click="closeSearch" class="close-button" aria-label="关闭">
                <X :size="20" />
              </button>
            </div>

            <div class="search-results">
              <div v-if="searchQuery && filteredPosts.length === 0" class="no-results">
                未找到相关文章
              </div>
              <a
                v-for="post in filteredPosts"
                :key="post.id"
                :href="`/blog/${post.id}/`"
                class="result-item"
                @click="closeSearch"
              >
                <div class="result-title">{{ post.data.title }}</div>
                <div class="result-desc">{{ post.data.description }}</div>
                <div v-if="post.data.tags && post.data.tags.length > 0" class="result-tags">
                  <span v-for="tag in post.data.tags.slice(0, 3)" :key="tag" class="tag">
                    #{{ tag }}
                  </span>
                </div>
              </a>
            </div>

            <div class="search-footer">
              <span class="hint"><kbd>Esc</kbd> 关闭</span>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.search-button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: rgba(var(--gray-light), 0.2);
  border: 1px solid rgb(var(--gray-light));
  border-radius: 0.5rem;
  color: rgb(var(--gray));
  cursor: pointer;
  transition: all 0.2s ease;
}

.search-button:hover {
  background: rgba(var(--gray-light), 0.3);
  border-color: rgb(var(--gray));
}

.search-hint {
  font-size: 0.75rem;
  padding: 0.125rem 0.375rem;
  background: rgba(var(--gray-light), 0.5);
  border-radius: 0.25rem;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
  z-index: 9999;
}

.modal-content {
  width: 90%;
  max-width: 600px;
  background: var(--card);
  border-radius: 0.75rem;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.search-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  border-bottom: 1px solid rgb(var(--gray-light));
}

.search-icon {
  color: rgb(var(--gray));
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 1rem;
  color: rgb(var(--black));
}

.close-button {
  background: none;
  border: none;
  cursor: pointer;
  color: rgb(var(--gray));
  padding: 0.25rem;
  border-radius: 0.25rem;
  transition: background 0.2s ease;
}

.close-button:hover {
  background: rgba(var(--gray-light), 0.3);
}

.search-results {
  max-height: 400px;
  overflow-y: auto;
}

.no-results {
  padding: 2rem;
  text-align: center;
  color: rgb(var(--gray));
}

.result-item {
  display: block;
  padding: 1rem;
  border-bottom: 1px solid rgb(var(--gray-light));
  text-decoration: none;
  transition: background 0.2s ease;
}

.result-item:hover {
  background: rgba(var(--gray-light), 0.2);
}

.result-title {
  font-size: 1rem;
  font-weight: 500;
  color: rgb(var(--black));
  margin-bottom: 0.25rem;
}

.result-desc {
  font-size: 0.875rem;
  color: rgb(var(--gray));
  margin-bottom: 0.5rem;
}

.result-tags {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.tag {
  font-size: 0.75rem;
  color: var(--ring);
}

.search-footer {
  display: flex;
  gap: 1rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid rgb(var(--gray-light));
  background: rgba(var(--gray-light), 0.1);
}

.hint {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: rgb(var(--gray));
}

kbd {
  padding: 0.125rem 0.375rem;
  background: rgba(var(--gray-light), 0.5);
  border-radius: 0.25rem;
  font-family: monospace;
  font-size: 0.75rem;
}

/* 过渡动画 */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active .modal-content,
.modal-leave-active .modal-content {
  transition: transform 0.2s ease;
}

.modal-enter-from .modal-content,
.modal-leave-to .modal-content {
  transform: translateY(-20px);
}

/* 滚动条 */
.search-results::-webkit-scrollbar {
  width: 6px;
}

.search-results::-webkit-scrollbar-track {
  background: transparent;
}

.search-results::-webkit-scrollbar-thumb {
  background: rgb(var(--gray-light));
  border-radius: 3px;
}

.search-results::-webkit-scrollbar-thumb:hover {
  background: rgb(var(--gray));
}

/* 移动端适配 */
@media (max-width: 768px) {
  .modal-overlay {
    padding: 1rem;
    padding-top: 3rem;
    align-items: flex-start;
  }

  .modal-content {
    width: 100%;
    max-height: calc(100vh - 4rem);
    display: flex;
    flex-direction: column;
  }

  .search-header {
    padding: 0.875rem;
  }

  .search-input {
    font-size: 0.95rem;
  }

  .search-results {
    max-height: calc(100vh - 12rem);
    flex: 1;
    overflow-y: auto;
  }

  .result-item {
    padding: 0.875rem;
  }

  .result-title {
    font-size: 0.95rem;
  }

  .result-desc {
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .result-tags {
    gap: 0.375rem;
  }

  .tag {
    font-size: 0.7rem;
  }

  .search-footer {
    padding: 0.625rem 0.875rem;
  }

  .hint {
    font-size: 0.7rem;
  }
}

@media (max-width: 640px) {
  .modal-overlay {
    padding: 0.75rem;
    padding-top: 2rem;
  }

  .modal-content {
    max-height: calc(100vh - 3rem);
  }

  .search-header {
    padding: 0.75rem;
    gap: 0.5rem;
  }

  .search-input {
    font-size: 0.9rem;
  }

  .search-results {
    max-height: calc(100vh - 10rem);
  }

  .result-item {
    padding: 0.75rem;
  }

  .result-title {
    font-size: 0.9rem;
    line-height: 1.4;
  }

  .result-desc {
    font-size: 0.75rem;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .search-hint {
    display: none;
  }
}

@media (max-width: 480px) {
  .modal-overlay {
    padding: 0.5rem;
    padding-top: 1.5rem;
  }

  .modal-content {
    max-height: calc(100vh - 2.5rem);
    border-radius: 0.5rem;
  }

  .search-header {
    padding: 0.625rem;
  }

  .search-results {
    max-height: calc(100vh - 9rem);
  }

  .result-item {
    padding: 0.625rem;
  }

  .result-title {
    font-size: 0.875rem;
  }

  .result-desc {
    font-size: 0.7rem;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    margin-bottom: 0.375rem;
  }

  .tag {
    font-size: 0.65rem;
  }

  .search-footer {
    padding: 0.5rem 0.625rem;
  }

  kbd {
    font-size: 0.7rem;
  }
}

/* 极小屏幕 */
@media (max-width: 360px) {
  .modal-content {
    max-height: calc(100vh - 2rem);
  }

  .search-results {
    max-height: calc(100vh - 8rem);
  }

  .result-title {
    font-size: 0.85rem;
  }
}
</style>
