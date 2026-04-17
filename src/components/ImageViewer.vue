<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="image-viewer-overlay" @click.self="close">
        <div class="image-viewer-toolbar">
          <button class="toolbar-btn" @click="zoomOut" title="Zoom Out">
            <ZoomOut />
          </button>
          <button class="toolbar-btn" @click="zoomIn" title="Zoom In">
            <ZoomIn />
          </button>
          <button class="toolbar-btn" @click="reset" title="Reset">
            <Maximize />
          </button>
          <button class="toolbar-btn" @click="rotateLeft" title="Rotate Left">
            <RotateCcw />
          </button>
          <button class="toolbar-btn" @click="rotateRight" title="Rotate Right">
            <RotateCw />
          </button>
          <button class="toolbar-btn close-btn" @click="close" title="Close">
            <X />
          </button>
        </div>

        <button
          v-if="images.length > 1"
          class="nav-btn prev-btn"
          @click.stop="prev"
        >
          <ChevronLeft />
        </button>

        <button
          v-if="images.length > 1"
          class="nav-btn next-btn"
          @click.stop="next"
        >
          <ChevronRight />
        </button>

        <div class="image-viewer-canvas" @wheel="handleWheel" @mousedown="startDrag">
          <img
            :src="currentImage"
            class="viewer-image"
            :style="imageStyle"
            @dragstart.prevent
            alt="Preview"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCcw,
  RotateCw,
  X,
  ChevronLeft,
  ChevronRight
} from 'lucide-vue-next';

const visible = ref(false);
const images = ref<string[]>([]);
const currentIndex = ref(0);

const scale = ref(1);
const rotate = ref(0);
const offsetX = ref(0);
const offsetY = ref(0);

const currentImage = computed(() => images.value[currentIndex.value] || '');

const imageStyle = computed(() => ({
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value}) rotate(${rotate.value}deg)`,
  transition: isDragging.value ? 'none' : 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
}));

const reset = () => {
  scale.value = 1;
  rotate.value = 0;
  offsetX.value = 0;
  offsetY.value = 0;
};

const close = () => {
  visible.value = false;
};

const zoomIn = () => {
  scale.value = Math.min(scale.value + 0.2, 5);
};

const zoomOut = () => {
  scale.value = Math.max(scale.value - 0.2, 0.2);
};

const rotateLeft = () => {
  rotate.value -= 90;
};

const rotateRight = () => {
  rotate.value += 90;
};

const prev = () => {
  if (images.value.length <= 1) return;
  currentIndex.value = (currentIndex.value - 1 + images.value.length) % images.value.length;
  reset();
};

const next = () => {
  if (images.value.length <= 1) return;
  currentIndex.value = (currentIndex.value + 1) % images.value.length;
  reset();
};

const handleWheel = (e: WheelEvent) => {
  e.preventDefault();
  if (e.deltaY < 0) {
    zoomIn();
  } else {
    zoomOut();
  }
};

// Drag functionality
const isDragging = ref(false);
let startX = 0;
let startY = 0;

const startDrag = (e: MouseEvent) => {
  isDragging.value = true;
  startX = e.clientX - offsetX.value;
  startY = e.clientY - offsetY.value;
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', stopDrag);
};

const onDrag = (e: MouseEvent) => {
  if (!isDragging.value) return;
  offsetX.value = e.clientX - startX;
  offsetY.value = e.clientY - startY;
};

const stopDrag = () => {
  isDragging.value = false;
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup', stopDrag);
};

// Keyboard navigation
const handleKeydown = (e: KeyboardEvent) => {
  if (!visible.value) return;
  if (e.key === 'Escape') close();
  if (e.key === 'ArrowLeft') prev();
  if (e.key === 'ArrowRight') next();
  if (e.key === 'ArrowUp') zoomIn();
  if (e.key === 'ArrowDown') zoomOut();
};

// Initialize
onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  
  // Find all images in the prose content
  setTimeout(() => {
    const imgElements = document.querySelectorAll('.prose img');
    if (imgElements.length === 0) return;

    images.value = Array.from(imgElements).map((img) => (img as HTMLImageElement).src);

    imgElements.forEach((img, index) => {
      (img as HTMLImageElement).style.cursor = 'zoom-in';
      img.addEventListener('click', () => {
        currentIndex.value = index;
        reset();
        visible.value = true;
      });
    });
  }, 500); // Wait for Astro to render content
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});

watch(visible, (val) => {
  if (val) {
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
  }
});
</script>

<style scoped>
.image-viewer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.85);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}

.image-viewer-canvas {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.viewer-image {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  cursor: grab;
  will-change: transform;
}

.viewer-image:active {
  cursor: grabbing;
}

.image-viewer-toolbar {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  background-color: rgba(0, 0, 0, 0.6);
  padding: 10px 20px;
  border-radius: 30px;
  z-index: 10000;
  backdrop-filter: blur(4px);
}

.toolbar-btn {
  background: transparent;
  border: none;
  color: white;
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.toolbar-btn:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

.toolbar-btn svg {
  width: 20px;
  height: 20px;
}

.close-btn {
  margin-left: 8px;
  background-color: rgba(255, 0, 0, 0.4);
}
.close-btn:hover {
  background-color: rgba(255, 0, 0, 0.7);
}

.nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background-color: rgba(0, 0, 0, 0.5);
  color: white;
  border: none;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 10000;
  transition: background-color 0.2s;
}

.nav-btn:hover {
  background-color: rgba(0, 0, 0, 0.8);
}

.nav-btn svg {
  width: 30px;
  height: 30px;
}

.prev-btn {
  left: 30px;
}

.next-btn {
  right: 30px;
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
