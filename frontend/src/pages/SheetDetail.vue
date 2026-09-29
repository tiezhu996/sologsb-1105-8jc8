<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSheetStore, type NewScanItem } from '../stores/sheetStore'
import { usePlaceStore } from '../stores/placeStore'
import type { ScanItem } from '../types/scan'
import type { ColorMode, ScanQuality } from '../types/scan'
import { COLOR_MODES, SCAN_QUALITIES } from '../types/scan'
import { usePlaceSearch } from '../hooks/usePlaceSearch'
import { estimateSheetSpan, scaleToText } from '../utils/scale'
import { downloadJson } from '../utils/export'
import PairRow from '../components/common/PairRow.vue'
import ScanCard from '../components/common/ScanCard.vue'
import VacantHint from '../components/common/VacantHint.vue'

const route = useRoute()
const sheetStore = useSheetStore()
const placeStore = usePlaceStore()
const searchKeyword = ref('')
const { hits } = usePlaceSearch(searchKeyword)
const showScanForm = ref(false)
/** 同名确认阶段：命中的当前件；非空时表单进入“确认替换”步骤 */
const replaceTarget = ref<ScanItem | null>(null)
const replaceReason = ref('')
const inheritPrimary = ref(true)
const replaceError = ref('')
/** 展开查看历次替换的谱系号集合 */
const expandedLineages = ref<string[]>([])

const sheetId = computed(() => String(route.params.id ?? ''))
const sheet = computed(() => {
  const current = sheetStore.currentSheet
  return current?.id === sheetId.value ? current : undefined
})
const relatedPlaces = computed(() => placeStore.getPairsForSheet(sheetId.value))
const relatedHits = computed(() => hits.value.filter((hit) => hit.pair.sheetId === sheetId.value))
const spanEstimate = computed(() => (sheet.value ? estimateSheetSpan(sheet.value.scale, sheet.value.sheetSizeCm) : undefined))

function createScanForm(): NewScanItem {
  return {
    sheetId: sheetId.value,
    fileName: '',
    resolutionDpi: 600,
    colorMode: '彩色',
    pieces: 1,
    quality: '清晰',
    storageNote: '',
    importedAt: new Date().toISOString(),
    isPrimary: false,
  }
}

const scanForm = reactive<NewScanItem>(createScanForm())
const scanFormError = ref('')

function resetScanForm(): void {
  Object.assign(scanForm, createScanForm())
  scanFormError.value = ''
  replaceTarget.value = null
  replaceReason.value = ''
  inheritPrimary.value = true
  replaceError.value = ''
}

function toggleLineage(lineageId: string): void {
  expandedLineages.value = expandedLineages.value.includes(lineageId)
    ? expandedLineages.value.filter((id) => id !== lineageId)
    : [...expandedLineages.value, lineageId]
}

function lineageScans(scan: ScanItem): ScanItem[] {
  return sheetStore.getLineageScans(scan.id)
}

function archivedScans(scan: ScanItem): ScanItem[] {
  return lineageScans(scan).filter((item) => item.versionStatus === 'archived')
}

async function submitScan(): Promise<void> {
  if (!scanForm.fileName.trim() || !scanForm.storageNote.trim()) {
    scanFormError.value = '请填写扫描文件名与存放位置。'
    return
  }
  scanFormError.value = ''

  // 第一步：命中同名当前件，列出旧件并转入确认步骤
  if (!replaceTarget.value) {
    const existing = sheetStore.findCurrentScanByName(sheetId.value, scanForm.fileName)
    if (existing) {
      replaceTarget.value = existing
      inheritPrimary.value = existing.isPrimary
      replaceReason.value = ''
      replaceError.value = ''
      return
    }
    await sheetStore.addScan({
      ...scanForm,
      sheetId: sheetId.value,
      fileName: scanForm.fileName.trim(),
      storageNote: scanForm.storageNote.trim(),
    })
    resetScanForm()
    showScanForm.value = false
    return
  }

  // 第二步：确认后旧件留档，新件作为新版本入库
  const target = replaceTarget.value
  if (target.fileName !== scanForm.fileName.trim() || target.versionStatus !== 'current') {
    replaceTarget.value = null
    return
  }
  if (!replaceReason.value.trim()) {
    replaceError.value = '请填写替换原因，旧版本将随此说明一并留档。'
    return
  }
  await sheetStore.replaceScan({
    ...scanForm,
    sheetId: sheetId.value,
    fileName: scanForm.fileName.trim(),
    storageNote: scanForm.storageNote.trim(),
    previousScanId: target.id,
    replaceReason: replaceReason.value.trim(),
    replacedAt: new Date().toISOString(),
    isPrimary: inheritPrimary.value && target.isPrimary,
  })
  resetScanForm()
  showScanForm.value = false
}

function exportSheet(): void {
  if (!sheet.value) {
    return
  }
  downloadJson(`${sheet.value.code}-编目.json`, {
    sheet: sheet.value,
    scans: sheetStore.getScansForSheet(sheet.value.id),
    placePairs: relatedPlaces.value,
  })
}

async function initialize(): Promise<void> {
  await Promise.all([sheetStore.init(), placeStore.init()])
  await sheetStore.loadSheet(sheetId.value)
}

onMounted(() => {
  void initialize()
})

watch(sheetId, () => {
  resetScanForm()
  showScanForm.value = false
  expandedLineages.value = []
  void sheetStore.loadSheet(sheetId.value)
})
</script>

<template>
  <section v-if="sheet" class="page" data-testid="detail-sheet">
    <div class="detail-layout">
      <div>
        <header class="detail-hero">
          <span class="detail-hero__code">{{ sheet.code }} · {{ sheet.series }}</span>
          <h1>{{ sheet.title }}</h1>
          <p>{{ sheet.projection }}，图幅尺寸 {{ sheet.sheetSizeCm }}。现登记 {{ relatedPlaces.length }} 条地名对照。</p>
          <div class="detail-hero__tags">
            <el-tag type="warning" effect="dark">{{ sheet.year }} 年</el-tag>
            <el-tag type="info" effect="dark">{{ sheet.scale }}</el-tag>
            <el-tag effect="dark">{{ sheet.status }}</el-tag>
            <el-tag v-if="spanEstimate" effect="dark">
              约 {{ spanEstimate.widthKm }} × {{ spanEstimate.heightKm }} 公里
            </el-tag>
          </div>
        </header>

        <div class="section-title">
          <div>
            <h2>扫描件条目</h2>
            <span class="muted">主用件优先作为地名核录与拼合基准</span>
          </div>
          <el-button
            type="primary"
            plain
            @click="showScanForm = true; resetScanForm()"
          >登记扫描件</el-button>
        </div>

        <form v-if="showScanForm" class="inline-form" @submit.prevent="submitScan">
          <h2>登记扫描件</h2>
          <div class="form-grid">
            <el-form-item label="扫描文件名" required>
              <input v-model="scanForm.fileName" class="native-field" :disabled="!!replaceTarget" />
            </el-form-item>
            <el-form-item label="分辨率">
              <input v-model.number="scanForm.resolutionDpi" class="native-field" type="number" min="72" max="1200" />
            </el-form-item>
            <el-form-item label="色彩模式">
              <select v-model="scanForm.colorMode" class="native-field">
                <option v-for="mode in COLOR_MODES" :key="mode" :value="mode">{{ mode }}</option>
              </select>
            </el-form-item>
            <el-form-item label="分块数">
              <input v-model.number="scanForm.pieces" class="native-field" type="number" min="1" />
            </el-form-item>
            <el-form-item label="图像质量">
              <select v-model="scanForm.quality" class="native-field">
                <option v-for="quality in SCAN_QUALITIES" :key="quality" :value="quality">{{ quality }}</option>
              </select>
            </el-form-item>
            <el-form-item label="存放位置" required>
              <input v-model="scanForm.storageNote" class="native-field" />
            </el-form-item>
            <el-form-item v-if="!replaceTarget" label="设为主用件">
              <el-switch v-model="scanForm.isPrimary" />
            </el-form-item>
            <div class="form-actions">
              <template v-if="replaceTarget">
                <el-button @click="replaceTarget = null; replaceReason = ''; replaceError = ''">返回修改</el-button>
                <el-button type="warning" native-type="submit">确认作为新版本入库</el-button>
              </template>
              <template v-else>
                <el-button @click="showScanForm = false; resetScanForm()">取消</el-button>
                <el-button type="primary" native-type="submit">保存扫描件</el-button>
              </template>
            </div>
          </div>

          <div v-if="replaceTarget" class="replace-confirm">
            <p class="replace-confirm__head">
              检测到同名当前件，将把新登记件作为
              <strong>「{{ replaceTarget.fileName }}」</strong>
              的新版本入库；下列旧件会留档，不再作为当前版本，也不能再设为主用。
            </p>
            <ScanCard :scan="replaceTarget" :version-count="lineageScans(replaceTarget).length" />
            <el-form-item label="替换原因" required class="mt-20">
              <textarea
                v-model="replaceReason"
                class="native-field"
                placeholder="例如：原扫描件局部破损，据馆藏原卷重新扫描。"
              ></textarea>
            </el-form-item>
            <el-form-item v-if="replaceTarget.isPrimary">
              <el-checkbox v-model="inheritPrimary">
                承接主用件标记（旧件的主用标记将自动转移到新版本）
              </el-checkbox>
            </el-form-item>
            <p v-else class="muted replace-confirm__secondary">
              旧件当前为副本，新版本入库后仍为副本；主用件标记不受影响。
            </p>
            <p v-if="replaceError" class="text-danger">{{ replaceError }}</p>
          </div>

          <p v-if="scanFormError" class="text-danger">{{ scanFormError }}</p>
        </form>

        <div class="scan-list">
          <template v-for="scan in sheetStore.currentScans" :key="scan.id">
            <ScanCard :scan="scan" :version-count="lineageScans(scan).length" />
            <div v-if="archivedScans(scan).length" class="scan-lineage">
              <el-button link type="primary" size="small" @click="toggleLineage(scan.lineageId)">
                {{
                  expandedLineages.includes(scan.lineageId)
                    ? '收起历次替换'
                    : `展开历次替换（${archivedScans(scan).length} 个留档版本）`
                }}
              </el-button>
              <div v-if="expandedLineages.includes(scan.lineageId)" class="scan-lineage__archive">
                <ScanCard
                  v-for="oldScan in archivedScans(scan)"
                  :key="oldScan.id"
                  :scan="oldScan"
                  :version-count="lineageScans(scan).length"
                />
              </div>
            </div>
          </template>
          <div v-if="sheetStore.currentScans.length === 0" class="empty-inline">该图幅尚未登记扫描件。</div>
        </div>
        <div v-if="sheetStore.currentScans.length" class="section-title">
          <span class="muted">主用件只在当前版本之间切换；旧版本留档后不能再被选为主用。</span>
          <div>
            <el-button
              v-for="scan in sheetStore.currentScans"
              :key="`primary-${scan.id}`"
              link
              :type="scan.isPrimary ? 'success' : 'primary'"
              :disabled="scan.isPrimary"
              @click="sheetStore.setPrimaryScan(scan.id)"
            >
              {{ scan.isPrimary ? '当前主用件' : `设为主用件：${scan.fileName}` }}
            </el-button>
          </div>
        </div>
      </div>

      <aside>
        <section class="side-panel">
          <h2>编目摘要</h2>
          <dl class="fact-list">
            <div><dt>图幅号</dt><dd>{{ sheet.code }}</dd></div>
            <div><dt>所属图组</dt><dd>{{ sheet.series }}</dd></div>
            <div><dt>年代</dt><dd>{{ sheet.year }} 年</dd></div>
            <div><dt>比例尺</dt><dd>{{ sheet.scale }}</dd></div>
            <div><dt>比例尺说明</dt><dd>{{ scaleToText(sheet.scale) }}</dd></div>
            <div><dt>投影</dt><dd>{{ sheet.projection }}</dd></div>
            <div><dt>尺寸</dt><dd>{{ sheet.sheetSizeCm }}</dd></div>
            <div v-if="spanEstimate"><dt>估算跨度</dt><dd>{{ spanEstimate.longitudeSpan }} × {{ spanEstimate.latitudeSpan }}</dd></div>
            <div><dt>扫描件</dt><dd>{{ sheetStore.currentScans.length }} 件</dd></div>
            <div><dt>地名对照</dt><dd>{{ relatedPlaces.length }} 条</dd></div>
          </dl>
          <div class="mt-20">
            <router-link :to="`/sheets/${sheet.id}/neighbors`"><el-button>查看邻接与拼合预览</el-button></router-link>
            <el-button type="primary" plain @click="exportSheet">导出 JSON</el-button>
          </div>
        </section>
      </aside>
    </div>

    <section class="section-title">
      <div>
        <h2>图内地名核录</h2>
        <span class="muted">可检索本图幅的古名、今名、异写与图上方位。</span>
      </div>
      <el-input v-model="searchKeyword" clearable placeholder="检索本地名" style="width: 260px" />
    </section>

    <div v-if="relatedPlaces.length" class="place-list">
      <PairRow
        v-for="pair in relatedHits.length || !searchKeyword ? relatedPlaces : []"
        :key="pair.id"
        :pair="pair"
        :query="searchKeyword"
        :sheet-code="sheet.code"
      />
      <div v-if="searchKeyword && relatedHits.length === 0" class="empty-inline">本地名未检索到吻合记录。</div>
    </div>
  </section>

  <section v-else class="page">
    <h1>图幅详情</h1>
    <VacantHint title="未找到该图幅" description="图幅可能已被移除，请返回编目台重新选择。" />
  </section>
</template>
