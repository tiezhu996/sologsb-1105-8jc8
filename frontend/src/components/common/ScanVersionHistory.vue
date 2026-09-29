<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ScanItem } from '../../types/scan'
import { useSheetStore } from '../../stores/sheetStore'
import ScanCard from './ScanCard.vue'

const props = defineProps<{
  scan: ScanItem
}>()

const sheetStore = useSheetStore()
const expanded = ref(false)

// 仅取这件扫描件所属谱系的记录，其他扫描件不受影响
const lineageScans = computed(() => sheetStore.getLineageScans(props.scan.lineageId))
const archivedScans = computed(() => lineageScans.value.filter((item) => !item.isCurrent))
</script>

<template>
  <div class="version-history" data-testid="version-history">
    <ScanCard :scan="scan" />

    <div v-if="archivedScans.length" class="version-history__bar">
      <el-button link size="small" :type="expanded ? 'info' : 'primary'" data-testid="toggle-versions" @click="expanded = !expanded">
        {{ expanded ? '收起历次替换' : `展开历次替换（${archivedScans.length} 个旧版本）` }}
      </el-button>
    </div>

    <div v-if="expanded && archivedScans.length" class="version-history__list" data-testid="version-list">
      <p class="version-history__title">本件替换谱系 · 共 {{ lineageScans.length }} 个版本</p>
      <ScanCard v-for="oldScan in archivedScans" :key="oldScan.id" :scan="oldScan" />
    </div>
  </div>
</template>
