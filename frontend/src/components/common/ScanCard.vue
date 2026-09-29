<script setup lang="ts">
import type { ScanItem } from '../../types/scan'

defineProps<{
  scan: ScanItem
}>()

const qualityType: Record<ScanItem['quality'], 'success' | 'warning' | 'danger'> = {
  清晰: 'success',
  偏淡: 'warning',
  破损: 'danger',
}
</script>

<template>
  <article class="scan-card" :class="{ 'scan-card--archived': !scan.isCurrent }">
    <div class="scan-card__topline">
      <span class="scan-card__file">{{ scan.fileName }}</span>
      <span class="scan-card__tags">
        <el-tag size="small" type="info" effect="plain">第 {{ scan.versionNo }} 版</el-tag>
        <el-tag v-if="scan.isPrimary" type="warning" size="small">主用件</el-tag>
        <el-tag v-else-if="scan.isCurrent" size="small" effect="plain">副本</el-tag>
        <el-tag v-else size="small" type="danger" effect="plain">已留档</el-tag>
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
    <p class="scan-card__date">录入：{{ new Date(scan.importedAt).toLocaleDateString('zh-CN') }}</p>
    <p v-if="!scan.isCurrent && scan.replacedAt" class="scan-card__archive">
      已于 {{ new Date(scan.replacedAt).toLocaleDateString('zh-CN') }} 被新版本替换留档
      <template v-if="scan.replaceReason">，替换原因：{{ scan.replaceReason }}</template>
    </p>
  </article>
</template>
