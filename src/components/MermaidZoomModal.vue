<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="mermaid-viewer-overlay" @click.self="close">
        <div class="mermaid-viewer-toolbar">
          <button class="toolbar-btn" @click="zoomOut" title="Zoom Out">
            <ZoomOut />
          </button>
          <button class="toolbar-btn" @click="zoomIn" title="Zoom In">
            <ZoomIn />
          </button>
          <button class="toolbar-btn" @click="reset" title="Reset">
            <Maximize />
          </button>
          <button class="toolbar-btn close-btn" @click="close" title="Close">
            <X />
          </button>
        </div>

        <div class="mermaid-viewer-canvas" ref="canvasRef">
          <!-- The SVG will be injected here -->
          <div ref="contentRef" class="mermaid-content-wrapper" v-html="svgContent"></div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import Panzoom, { type PanzoomObject } from '@panzoom/panzoom';
import { ZoomIn, ZoomOut, Maximize, X } from 'lucide-vue-next';

const visible = ref(false);
const svgContent = ref('');
const canvasRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
let pz: PanzoomObject | null = null;

const close = () => {
  visible.value = false;
  if (pz) {
    pz.destroy();
    pz = null;
  }
};

const initPanZoom = () => {
  if (!contentRef.value || !canvasRef.value) return;

  // Wait a brief moment to ensure SVG is fully rendered and has dimensions
  setTimeout(() => {
    if (!contentRef.value) return;
    
    const svgEl = contentRef.value.querySelector('svg');
    if (svgEl) {
      // Force SVG to take its intrinsic size
      svgEl.style.width = '100%';
      svgEl.style.height = '100%';
      
      // Get intrinsic dimensions from viewBox or attributes
      const viewBox = svgEl.getAttribute('viewBox');
      let intrinsicWidth = svgEl.clientWidth;
      let intrinsicHeight = svgEl.clientHeight;
      
      if (viewBox) {
        const [, , w, h] = viewBox.split(' ').map(Number);
        if (w && h) {
          intrinsicWidth = w;
          intrinsicHeight = h;
          // Set explicit dimensions based on viewBox
          contentRef.value.style.width = `${w}px`;
          contentRef.value.style.height = `${h}px`;
        }
      }

      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      let startScale = 1;
      // If the diagram is larger than 90% of the screen, scale it down initially
      if (intrinsicWidth > windowWidth * 0.9 || intrinsicHeight > windowHeight * 0.9) {
        const scaleX = (windowWidth * 0.9) / intrinsicWidth;
        const scaleY = (windowHeight * 0.9) / intrinsicHeight;
        startScale = Math.min(scaleX, scaleY);
      }

      // Calculate position to center the diagram exactly
      const startX = (windowWidth - intrinsicWidth) / 2;
      const startY = (windowHeight - intrinsicHeight) / 2;
      
      pz = Panzoom(contentRef.value, {
        maxScale: 5,
        minScale: 0.1,
        startX: startX,
        startY: startY,
        startScale: startScale,
        canvas: true,
        transformOrigin: { x: 0.5, y: 0.5 } // Ensure zooming happens from the center
      });

      if (canvasRef.value && pz) {
        canvasRef.value.parentElement?.addEventListener('wheel', pz.zoomWithWheel);
      }
    }
  }, 50);
};

const zoomIn = () => {
  if (pz) pz.zoomIn();
};

const zoomOut = () => {
  if (pz) pz.zoomOut();
};

const reset = () => {
  if (pz) pz.reset();
};

// Keyboard navigation
const handleKeydown = (e: KeyboardEvent) => {
  if (!visible.value) return;
  if (e.key === 'Escape') close();
  if (e.key === 'ArrowUp') zoomIn();
  if (e.key === 'ArrowDown') zoomOut();
};

// Initialize
onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  
  // Find all mermaid SVGs in the prose content
  setTimeout(() => {
    // astro-mermaid usually creates a container with class 'mermaid'
    const mermaidElements = document.querySelectorAll('.prose .mermaid');
    if (mermaidElements.length === 0) return;

    mermaidElements.forEach((el) => {
      (el as HTMLElement).style.cursor = 'zoom-in';
      el.addEventListener('click', () => {
        // Clone the HTML of the clicked mermaid diagram
        svgContent.value = el.innerHTML;
        visible.value = true;
      });
    });
  }, 1000); // Wait for Astro and Mermaid to render content
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  if (canvasRef.value && pz) {
    canvasRef.value.parentElement?.removeEventListener('wheel', pz.zoomWithWheel);
  }
  if (pz) {
    pz.destroy();
  }
});

watch(visible, async (val) => {
  if (val) {
    document.body.style.overflow = 'hidden';
    await nextTick();
    initPanZoom();
  } else {
    document.body.style.overflow = '';
  }
});
</script>

<style scoped>
.mermaid-viewer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: #f8f9fa; /* Light canvas background */
  z-index: 9999;
}

/* Dark mode support: Since mermaid is always 'default' (light) in astro config, 
   we keep the canvas light to ensure black text is visible, or use a slightly dimmed white.
   We will keep it #f8f9fa to act as a proper whiteboard canvas. */
:global(.dark) .mermaid-viewer-overlay {
  background-color: #e5e7eb; /* Slightly darker in dark mode but still light enough for black text */
}

.mermaid-viewer-toolbar {
  position: absolute;
  top: 20px;
  right: 20px;
  display: flex;
  gap: 10px;
  z-index: 10000;
  background: white;
  padding: 8px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  border: 1px solid #e5e7eb;
}

.toolbar-btn {
  background: none;
  border: none;
  color: #4b5563; /* Dark gray */
  cursor: pointer;
  padding: 8px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s, color 0.2s;
}

.toolbar-btn:hover {
  background-color: #f3f4f6;
  color: #111827;
}

.close-btn {
  color: #ef4444;
}

.close-btn:hover {
  background-color: #fee2e2;
  color: #dc2626;
}

.mermaid-viewer-canvas {
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  overflow: hidden;
  cursor: grab;
}

.mermaid-viewer-canvas:active {
  cursor: grabbing;
}

.mermaid-content-wrapper {
  display: inline-block;
  transform-origin: center center;
  /* Removed the card-like background, padding, and shadow to make it feel like an infinite canvas */
}

.mermaid-content-wrapper :deep(svg) {
  /* Ensure the SVG doesn't have max-width restricting its scaling */
  max-width: none !important;
  height: auto;
}

/* Global transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
