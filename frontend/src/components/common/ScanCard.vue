<script setup lang="ts">
import type { ScanItem } from '../../types/scan'

withDefaults(
  defineProps<{
    scan: ScanItem
    /** 谱系内版本总数；大于 1 时显示“第 n 版 · 共 m 版”谱系标记 */
    versionCount?: number
  }>(),
  { versionCount: 1 },
)

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('zh-CN')
}

const qualityType: Record<ScanItem['quality'], 'success' | 'warning' | 'danger'> = {
  清晰: 'success',
  偏淡: 'warning',
  破损: 'danger',
}
</script>

<template>
  <article class="scan-card" :class="{ 'scan-card--archived': scan.versionStatus === 'archived' }">
    <div class="scan-card__topline">
      <span class="scan-card__file">{{ scan.fileName }}</span>
      <span class="scan-card__tags">
        <el-tag
          v-if="versionCount > 1"
          size="small"
          :type="scan.versionStatus === 'current' ? 'primary' : 'info'"
          effect="plain"
        >
          第 {{ scan.version }} 版 / 共 {{ versionCount }} 版
        </el-tag>
        <el-tag v-if="scan.versionStatus === 'archived'" type="info" size="small">已留档</el-tag>
        <el-tag v-else-if="scan.isPrimary" type="warning" size="small">主用件</el-tag>
        <el-tag v-else size="small" effect="plain">副本</el-tag>
      </span>
    </div>
    <dl class="scan-card__metrics">
      <div>
        <dt>分辨率</dt>
        <dd>{{ scan.resolutionDpi }} dpi</dd>
      </div>
      <div>
        <dt>色彩</dt>
        <dd>{{ scan.colorMode }}</dd>
      </div>
      <div>
        <dt>分块</dt>
        <dd>{{ scan.pieces }} 块</dd>
      </div>
      <div>
        <dt>质量</dt>
        <dd><el-tag :type="qualityType[scan.quality]" size="small">{{ scan.quality }}</el-tag></dd>
      </div>
    </dl>
    <p class="scan-card__note">存放：{{ scan.storageNote }}</p>
    <p v-if="scan.versionStatus === 'archived'" class="scan-card__replaced">
      已于 {{ formatDate(scan.replacedAt ?? scan.importedAt) }} 被第 {{ scan.version + 1 }} 版替换
      <template v-if="scan.replaceReason">，原因：{{ scan.replaceReason }}</template>
    </p>
    <p v-else class="scan-card__date">录入：{{ formatDate(scan.importedAt) }}</p>
  </article>
</template>
