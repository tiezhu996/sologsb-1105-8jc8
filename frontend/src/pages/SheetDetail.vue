<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSheetStore, type NewScanItem } from '../stores/sheetStore'
import { usePlaceStore } from '../stores/placeStore'
import type { ScanItem } from '../types/scan'
import { COLOR_MODES, SCAN_QUALITIES } from '../types/scan'
import { usePlaceSearch } from '../hooks/usePlaceSearch'
import { estimateSheetSpan, scaleToText } from '../utils/scale'
import { downloadJson } from '../utils/export'
import PairRow from '../components/common/PairRow.vue'
import ScanVersionHistory from '../components/common/ScanVersionHistory.vue'
import VacantHint from '../components/common/VacantHint.vue'

const route = useRoute()
const sheetStore = useSheetStore()
const placeStore = usePlaceStore()
const searchKeyword = ref('')
const { hits } = usePlaceSearch(searchKeyword)
const showScanForm = ref(false)

// 同名替换确认流程：命中同名当前件后挂起登记，列出当前件等待确认
const replaceTarget = ref<ScanItem | null>(null)
const replaceReason = ref('')
const replaceError = ref('')

const sheetId = computed(() => String(route.params.id ?? ''))
const sheet = computed(() => {
  const current = sheetStore.currentSheet
  return current?.id === sheetId.value ? current : undefined
})
const relatedPlaces = computed(() => placeStore.getPairsForSheet(sheetId.value))
const relatedHits = computed(() => hits.value.filter((hit) => hit.pair.sheetId === sheetId.value))
const spanEstimate = computed(() => (sheet.value ? estimateSheetSpan(sheet.value.scale, sheet.value.sheetSizeCm) : undefined))
const archivedCount = computed(() =>
  sheet.value ? sheetStore.getArchivedCount(sheet.value.id) : 0,
)

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
  clearReplaceFlow()
}

function clearReplaceFlow(): void {
  replaceTarget.value = null
  replaceReason.value = ''
  replaceError.value = ''
}

/**
 * 保存登记：先校验并按文件名查找同名当前件。
 * 命中同名件时不直接入库，先列出当前件，由整理者确认并填写替换原因。
 */
async function submitScan(): Promise<void> {
  if (!scanForm.fileName.trim() || !scanForm.storageNote.trim()) {
    scanFormError.value = '请填写扫描文件名与存放位置。'
    return
  }
  scanFormError.value = ''
  const fileName = scanForm.fileName.trim()
  const sameNameCurrent = sheetStore.findCurrentByFileName(sheetId.value, fileName)
  if (replaceTarget.value && replaceTarget.value.fileName !== fileName) {
    // 文件名已改离原同名件：丢弃旧的替换确认，按新文件名重新判定
    clearReplaceFlow()
  }
  if (sameNameCurrent && replaceTarget.value?.id !== sameNameCurrent.id) {
    replaceTarget.value = sameNameCurrent
    replaceReason.value = ''
    replaceError.value = ''
    // 同名件若为主用件，新版本承接主用，标记自动转移
    if (sameNameCurrent.isPrimary) {
      scanForm.isPrimary = true
    }
    return
  }
  if (replaceTarget.value) {
    // 确认面板已打开：必须通过“确认替换”校验原因后才入库
    await confirmReplaceScan()
    return
  }
  // 未命中同名件：作为全新扫描件直接入库
  await persistScan()
}

/** 确认替换后才把新件作为新版本入库，旧版本留档 */
async function confirmReplaceScan(): Promise<void> {
  if (!replaceTarget.value) {
    return
  }
  if (!replaceReason.value.trim()) {
    replaceError.value = '请填写替换原因，旧版本需要连同替换缘由一并留档。'
    return
  }
  await persistScan()
}

async function persistScan(): Promise<void> {
  const previousId = replaceTarget.value?.id
  const reason = replaceReason.value.trim()
  await sheetStore.addScan(
    {
      ...scanForm,
      sheetId: sheetId.value,
      fileName: scanForm.fileName.trim(),
      storageNote: scanForm.storageNote.trim(),
    },
    previousId ? { previousId, reason } : undefined,
  )
  resetScanForm()
  showScanForm.value = false
}

function cancelReplaceFlow(): void {
  clearReplaceFlow()
}

function closeScanForm(): void {
  showScanForm.value = false
  resetScanForm()
}

function exportSheet(): void {
  if (!sheet.value) {
    return
  }
  downloadJson(`${sheet.value.code}-编目.json`, {
    sheet: sheet.value,
    scans: sheetStore.getScansForSheet(sheet.value.id),
    archivedScans: sheetStore
      .getAllScansForSheet(sheet.value.id)
      .filter((scan) => !scan.isCurrent),
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
            <span class="muted">默认显示当前版本，可逐件展开历次替换；主用件优先作为地名核录与拼合基准</span>
          </div>
          <el-button type="primary" plain @click="showScanForm = true">登记扫描件</el-button>
        </div>

        <form v-if="showScanForm" class="inline-form" @submit.prevent="submitScan">
          <h2>登记扫描件</h2>
          <div class="form-grid">
            <el-form-item label="扫描文件名" required>
              <input v-model="scanForm.fileName" class="native-field" data-testid="field-scan-filename" />
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
            <el-form-item label="设为主用件">
              <el-switch
                v-model="scanForm.isPrimary"
                :disabled="!!replaceTarget && replaceTarget.isPrimary"
              />
              <span v-if="replaceTarget?.isPrimary" class="form-hint">
                当前同名件为主用件，主用标记将随新版本自动转移。
              </span>
            </el-form-item>
            <div class="form-actions">
              <el-button @click="closeScanForm">取消</el-button>
              <el-button type="primary" native-type="submit" data-testid="submit-scan">保存扫描件</el-button>
            </div>
          </div>
          <p v-if="scanFormError" class="text-danger">{{ scanFormError }}</p>

          <!-- 同名确认：先列出当前件，确认后才作为新版本入库 -->
          <div v-if="replaceTarget" class="replace-confirm" data-testid="replace-confirm">
            <h3>发现同名当前件</h3>
            <p class="replace-confirm__intro">
              本图幅已登记同名文件 <strong>「{{ replaceTarget.fileName }}」</strong>（第 {{ replaceTarget.versionNo }} 版，
              录入于 {{ new Date(replaceTarget.importedAt).toLocaleDateString('zh-CN') }}
              <template v-if="replaceTarget.isPrimary">，当前为主用件</template>）。
              确认后当前件将<strong>留档为第 {{ replaceTarget.versionNo }} 版</strong>，
              新登记件作为<strong>第 {{ replaceTarget.versionNo + 1 }} 版</strong>入库；
              <template v-if="replaceTarget.isPrimary">主用标记自动转移到新版本，</template>
              旧版本保留替换日期与原因，不能再被选为主用。
            </p>
            <el-form-item label="替换原因" required>
              <textarea
                v-model="replaceReason"
                class="native-field"
                data-testid="field-replace-reason"
                placeholder="例如：原扫描件边角破损，档案馆提供重新扫描件"
                @keydown.enter.prevent
              />
            </el-form-item>
            <p v-if="replaceError" class="text-danger">{{ replaceError }}</p>
            <div class="replace-confirm__actions">
              <el-button @click="cancelReplaceFlow">返回修改</el-button>
              <el-button type="danger" data-testid="confirm-replace" @click="confirmReplaceScan">
                确认替换并入库新版本
              </el-button>
            </div>
          </div>
        </form>

        <div class="scan-list">
          <ScanVersionHistory v-for="scan in sheetStore.currentScans" :key="scan.id" :scan="scan" />
          <div v-if="sheetStore.currentScans.length === 0" class="empty-inline">该图幅尚未登记扫描件。</div>
        </div>
        <p v-if="archivedCount" class="muted scan-archive-hint">
          另有 {{ archivedCount }} 件旧版本已留档，可在对应当前件下展开“历次替换”查看。
        </p>
        <div v-if="sheetStore.currentScans.length" class="section-title">
          <span class="muted">主用件标记可在当前版本间切换，原主用件会自动取消；留档旧版本不可再设为主用。</span>
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
            <div><dt>扫描件</dt><dd>{{ sheetStore.currentScans.length }} 件（留档 {{ archivedCount }} 件）</dd></div>
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
