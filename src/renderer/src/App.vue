<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useProjectsStore } from '@renderer/stores/projects'

const store = useProjectsStore()

// 主进程只接受已登记的路径，所以要等首次扫描完成后再显示页面
onMounted(() => void store.refresh())
</script>

<template>
  <RouterView v-if="store.loaded" />
  <p v-else class="py-16 text-center text-zinc-500">正在扫描项目…</p>
</template>
