// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

import vue from '@astrojs/vue';
import tailwindcss from '@tailwindcss/vite';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import mermaid from 'astro-mermaid';

// https://astro.build/config
export default defineConfig({
  site: 'https://example.com',
  experimental: {
    fonts: [
      {
        name: 'LXGWZhenKai',
        cssVariable: '--font-lxgw',
        provider: 'local',
        variants: [
          {
            src: ['./src/assets/fonts/LXGWZhenKai-Regular.ttf'],
          }
        ],
      },
    ],
  },
  integrations: [
    mdx({
      remarkPlugins: [remarkMath, remarkGfm],
      rehypePlugins: [
        rehypeKatex,
        rehypeSlug,
        [
          rehypeAutolinkHeadings,
          {
            behavior: 'wrap',
            properties: {
              className: ['anchor-link'],
            },
          },
        ],
      ],
    }),
    sitemap(),
    vue(),
    mermaid({
      mermaidConfig: {
        securityLevel: 'loose',
        theme: 'default',
      },
    }),
  ],

  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    remarkPlugins: [remarkMath, remarkGfm],
    rehypePlugins: [
      rehypeKatex,
      rehypeSlug,
      [
        rehypeAutolinkHeadings,
        {
          behavior: 'wrap',
          properties: {
            className: ['anchor-link'],
          },
        },
      ],
    ],
  },
});