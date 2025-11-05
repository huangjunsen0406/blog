<script setup lang="ts">
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'

const props = defineProps<{
  current: number
  last: number
  base: string
  itemsPerPage: number
  total: number
}>()

function linkOf(n: number) {
  const clamped = Math.max(1, Math.min(n, props.last))
  return clamped === 1 ? props.base : `${props.base}/${clamped}`
}
</script>

<template>
  <Pagination
    v-slot="{ page }"
    :items-per-page="itemsPerPage"
    :total="total"
    :page="current"
  >
    <PaginationContent v-slot="{ items }">
      <PaginationPrevious :as="'a'" :href="linkOf(current - 1)" />

      <template v-for="(item, index) in items" :key="index">
        <PaginationItem
          v-if="item.type === 'page'"
          :as="'a'"
          :href="linkOf(item.value)"
          :value="item.value"
          :is-active="item.value === page"
        >
          {{ item.value }}
        </PaginationItem>
        <PaginationEllipsis v-else-if="item.type === 'ellipsis'" :index="index" />
      </template>

      <PaginationNext :as="'a'" :href="linkOf(current + 1)" />
    </PaginationContent>
  </Pagination>
</template>
