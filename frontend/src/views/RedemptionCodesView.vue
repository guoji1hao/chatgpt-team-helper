<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { authService, configService, redemptionCodeService, gptAccountService, type RedemptionCode, type GptAccount, type Channel } from '@/services/api'
import { formatShanghaiDate } from '@/lib/datetime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Search, Ticket, Trash2 } from 'lucide-vue-next'

const router = useRouter()
const { success: showSuccessToast, error: showErrorToast, warning: showWarningToast, info: showInfoToast } = useToast()

const codes = ref<RedemptionCode[]>([])
const totalCodes = ref(0)
const accounts = ref<GptAccount[]>([])
const runtimeChannels = ref<Channel[]>([])
const loading = ref(false)
const error = ref('')
const searchQuery = ref('')
const statusFilter = ref<'all' | 'unused' | 'redeemed'>('all')
const currentPage = ref(1)
const pageSize = ref(20)
const totalPages = computed(() => Math.max(1, Math.ceil(totalCodes.value / pageSize.value)))

const showBatchDialog = ref(false)
const batchCount = ref(10)
const selectedAccountEmail = ref('')
const selectedBatchChannel = ref('common')
const creating = ref(false)

const showRedeemDialog = ref(false)
const redeemTargetCode = ref<RedemptionCode | null>(null)
const redeemEmail = ref('')
const redeeming = ref(false)

const showImportExternalDialog = ref(false)
const importExternalChannel = ref('')
const importExternalCodesText = ref('')
const importingExternal = ref(false)

const selectedCodes = ref<number[]>([])
const reinvitingCodeIds = ref<number[]>([])
const updatingChannelId = ref<number | null>(null)
const checkingUpstreamCodeIds = ref<number[]>([])

const channelOptions = computed(() => {
  const list = runtimeChannels.value.filter(channel => channel.isActive)
  return list.length ? list : [{ key: 'common', name: '通用渠道', redeemMode: 'code', providerType: 'local', allowCommonFallback: false, isActive: true, isBuiltin: true, sortOrder: 10 }]
})

const batchChannelOptions = computed(() => channelOptions.value.filter(channel => channel.redeemMode !== 'external-card'))
const externalImportChannelOptions = computed(() => channelOptions.value.filter(channel => channel.redeemMode === 'external-card'))
const accountsByEmail = computed(() => new Map(accounts.value.map(account => [String(account.email || '').trim().toLowerCase(), account])))

const getCodeStatusLabel = (code: RedemptionCode) => {
  if (code.fulfillmentMode === 'external_api') {
    return code.supplierStatus || '待履约'
  }
  return code.isRedeemed ? '已使用' : '未使用'
}

const getCodeStatusClass = (code: RedemptionCode) => {
  if (code.fulfillmentMode === 'external_api') {
    return 'bg-blue-50 text-blue-700 border-blue-200'
  }
  return code.isRedeemed ? 'bg-gray-50 text-gray-500 border-gray-200' : 'bg-green-50 text-green-700 border-green-200'
}

const loadRuntimeConfig = async () => {
  const runtime = await configService.getRuntimeConfig()
  runtimeChannels.value = runtime.channels || []
}

const loadAccounts = async () => {
  const response = await gptAccountService.getAll({ page: 1, pageSize: 200 })
  accounts.value = response.accounts || []
}

const loadCodes = async () => {
  loading.value = true
  error.value = ''
  try {
    const response = await redemptionCodeService.list({
      page: currentPage.value,
      pageSize: pageSize.value,
      search: searchQuery.value.trim() || undefined,
      status: statusFilter.value,
    })
    codes.value = response.codes || []
    totalCodes.value = Number(response.pagination?.total || 0)
    currentPage.value = Number(response.pagination?.page || currentPage.value)
    pageSize.value = Number(response.pagination?.pageSize || pageSize.value)
  } catch (err: any) {
    error.value = err.response?.data?.error || '加载兑换码失败'
    if (err.response?.status === 401 || err.response?.status === 403) {
      authService.logout()
      router.push('/login')
    }
  } finally {
    loading.value = false
  }
}

const loadAll = async () => {
  await Promise.all([loadRuntimeConfig(), loadAccounts(), loadCodes()])
}

const goToPage = (page: number) => {
  if (page < 1 || page > totalPages.value || page === currentPage.value) return
  currentPage.value = page
  loadCodes()
}

const handleSearch = () => {
  currentPage.value = 1
  loadCodes()
}

const openBatchDialog = () => {
  batchCount.value = 10
  selectedAccountEmail.value = accounts.value[0]?.email || ''
  selectedBatchChannel.value = batchChannelOptions.value[0]?.key || 'common'
  showBatchDialog.value = true
}

const closeBatchDialog = () => {
  showBatchDialog.value = false
  batchCount.value = 10
  selectedAccountEmail.value = ''
  selectedBatchChannel.value = batchChannelOptions.value[0]?.key || 'common'
}

const handleBatchCreate = async () => {
  if (batchCount.value < 1 || batchCount.value > 1000) {
    showWarningToast('数量必须在 1-1000 之间')
    return
  }
  if (!selectedAccountEmail.value) {
    showWarningToast('请选择所属账号')
    return
  }
  if (!selectedBatchChannel.value) {
    showWarningToast('请选择渠道')
    return
  }

  creating.value = true
  try {
    const result = await redemptionCodeService.batchCreate(batchCount.value, selectedAccountEmail.value, selectedBatchChannel.value)
    await loadCodes()
    closeBatchDialog()
    showSuccessToast(`成功创建 ${result.codes.length} 个兑换码${result.failed > 0 ? `，失败 ${result.failed} 个` : ''}`)
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '创建兑换码失败')
  } finally {
    creating.value = false
  }
}

const handleDelete = async (id: number) => {
  if (!confirm('确定要删除这个兑换码吗？')) return
  try {
    await redemptionCodeService.delete(id)
    await loadCodes()
    showSuccessToast('兑换码已删除')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '删除失败')
  }
}

const handleBatchDelete = async () => {
  if (!selectedCodes.value.length) return
  if (!confirm(`确定删除选中的 ${selectedCodes.value.length} 个兑换码吗？`)) return
  try {
    await redemptionCodeService.batchDelete(selectedCodes.value)
    selectedCodes.value = []
    await loadCodes()
    showSuccessToast('批量删除成功')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '批量删除失败')
  }
}

const isReinviting = (id: number) => reinvitingCodeIds.value.includes(id)
const handleReinvite = async (code: RedemptionCode) => {
  reinvitingCodeIds.value = [...reinvitingCodeIds.value, code.id]
  try {
    const result = await redemptionCodeService.reinvite(code.id)
    showSuccessToast(result.message || '重新邀请已发送')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '重新邀请失败')
  } finally {
    reinvitingCodeIds.value = reinvitingCodeIds.value.filter(id => id !== code.id)
  }
}

const openRedeemDialog = (code: RedemptionCode) => {
  redeemTargetCode.value = code
  redeemEmail.value = ''
  showRedeemDialog.value = true
}

const handleRedeem = async () => {
  if (!redeemTargetCode.value || !redeemEmail.value.trim()) return
  redeeming.value = true
  try {
    await redemptionCodeService.redeemAdmin({
      code: redeemTargetCode.value.code,
      email: redeemEmail.value.trim(),
      channel: redeemTargetCode.value.channel,
    })
    showSuccessToast('兑换成功')
    showRedeemDialog.value = false
    await loadCodes()
    await loadAccounts()
  } catch (err: any) {
    showErrorToast(err.response?.data?.message || err.response?.data?.error || '后台兑换失败')
  } finally {
    redeeming.value = false
  }
}

const handleChannelChange = async (target: RedemptionCode, nextChannel: string) => {
  if (!nextChannel || updatingChannelId.value === target.id || nextChannel === target.channel) return
  updatingChannelId.value = target.id
  try {
    const { message, code } = await redemptionCodeService.updateChannel(target.id, nextChannel)
    const index = codes.value.findIndex(item => item.id === target.id)
    if (index !== -1) {
      codes.value[index] = { ...codes.value[index], ...code }
      codes.value = [...codes.value]
    }
    showSuccessToast(message || '渠道已更新')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '更新渠道失败')
  } finally {
    updatingChannelId.value = null
  }
}

const openImportExternalDialog = () => {
  const first = externalImportChannelOptions.value[0]
  if (!first) {
    showWarningToast('暂无 external-card 渠道，请先在系统设置中创建')
    return
  }
  importExternalChannel.value = first.key
  importExternalCodesText.value = ''
  showImportExternalDialog.value = true
}

const handleImportExternal = async () => {
  if (!importExternalChannel.value || !importExternalCodesText.value.trim()) {
    showWarningToast('请选择渠道并填写卡密')
    return
  }
  importingExternal.value = true
  try {
    const result = await redemptionCodeService.importExternal({
      channel: importExternalChannel.value,
      codesText: importExternalCodesText.value,
    })
    await loadCodes()
    showImportExternalDialog.value = false
    showInfoToast(`成功导入 ${result.imported} 个，重复 ${result.duplicates} 个`)
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '导入外部卡密失败')
  } finally {
    importingExternal.value = false
  }
}

const isCheckingUpstream = (id: number) => checkingUpstreamCodeIds.value.includes(id)
const handleSelectAllCodes = (event: Event) => {
  const target = event.target as HTMLInputElement | null
  selectedCodes.value = target?.checked ? codes.value.map(code => code.id) : []
}

const handleCodeChannelSelect = (code: RedemptionCode, event: Event) => {
  const target = event.target as HTMLSelectElement | null
  if (!target) return
  handleChannelChange(code, target.value)
}

const handleCheckUpstream = async (code: RedemptionCode) => {
  checkingUpstreamCodeIds.value = [...checkingUpstreamCodeIds.value, code.id]
  try {
    const result = await redemptionCodeService.checkUpstream(code.id)
    showInfoToast(result.result?.message || result.message || '已完成上游状态检查')
    if (result.code) {
      const index = codes.value.findIndex(item => item.id === code.id)
      if (index !== -1) {
        codes.value[index] = { ...codes.value[index], ...result.code }
        codes.value = [...codes.value]
      }
    }
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '检查上游状态失败')
  } finally {
    checkingUpstreamCodeIds.value = checkingUpstreamCodeIds.value.filter(id => id !== code.id)
  }
}

onMounted(async () => {
  if (!authService.isAuthenticated()) {
    router.push('/login')
    return
  }
  await loadAll()
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">兑换码管理</h1>
        <p class="text-sm text-gray-500">管理库存、创建兑换码、后台兑换和外部卡密导入。</p>
      </div>
      <div class="flex gap-3">
        <Input v-model="searchQuery" placeholder="搜索兑换码 / 账号邮箱" class="h-11 w-[280px] rounded-xl" @keyup.enter="handleSearch" />
        <select v-model="statusFilter" class="h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm" @change="handleSearch">
          <option value="all">全部</option>
          <option value="unused">未使用</option>
          <option value="redeemed">已使用</option>
        </select>
        <Button variant="outline" class="h-11 rounded-xl" :disabled="loading" @click="loadAll">
          <RefreshCw class="mr-2 h-4 w-4" :class="loading ? 'animate-spin' : ''" />刷新
        </Button>
        <Button variant="outline" class="h-11 rounded-xl" @click="openImportExternalDialog">导入外部卡密</Button>
        <Button class="h-11 rounded-xl bg-black hover:bg-gray-800 text-white" @click="openBatchDialog">
          <Plus class="mr-2 h-4 w-4" />批量创建
        </Button>
      </div>
    </div>

    <div v-if="error" class="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">{{ error }}</div>

    <div class="flex items-center justify-between rounded-2xl border border-gray-100 bg-gray-50/40 px-4 py-3 text-sm text-gray-600">
      <div>当前共 {{ totalCodes }} 个兑换码，已选中 {{ selectedCodes.length }} 个</div>
      <Button variant="outline" class="rounded-xl border-red-200 text-red-600" :disabled="!selectedCodes.length" @click="handleBatchDelete">
        <Trash2 class="mr-2 h-4 w-4" />批量删除
      </Button>
    </div>

    <div class="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-100">
          <thead class="bg-gray-50/70">
            <tr>
              <th class="px-4 py-4"><input type="checkbox" :checked="selectedCodes.length === codes.length && codes.length > 0" @change="handleSelectAllCodes" /></th>
              <th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">兑换码</th>
              <th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">账号</th>
              <th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">渠道</th>
              <th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">状态</th>
              <th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">创建时间</th>
              <th class="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-if="loading">
              <td colspan="7" class="px-6 py-10 text-center text-sm text-gray-500">加载中...</td>
            </tr>
            <tr v-else-if="codes.length === 0">
              <td colspan="7" class="px-6 py-10 text-center text-sm text-gray-500">暂无兑换码</td>
            </tr>
            <tr v-for="code in codes" :key="code.id" class="hover:bg-gray-50/60 transition-colors">
              <td class="px-4 py-4"><input v-model="selectedCodes" type="checkbox" :value="code.id" /></td>
              <td class="px-6 py-4">
                <div class="font-mono text-sm font-semibold text-gray-900">{{ code.code }}</div>
                <div v-if="code.redeemedBy" class="text-xs text-gray-500">{{ code.redeemedBy }}</div>
              </td>
              <td class="px-6 py-4 text-sm text-gray-700">{{ code.accountEmail || '-' }}</td>
              <td class="px-6 py-4">
                <select
                  :value="code.channel"
                  :disabled="updatingChannelId === code.id"
                  class="h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm"
                  @change="handleCodeChannelSelect(code, $event)"
                >
                  <option v-for="channel in channelOptions" :key="channel.key" :value="channel.key">{{ channel.name }}</option>
                </select>
              </td>
              <td class="px-6 py-4">
                <span class="rounded-full px-2 py-1 text-xs border" :class="getCodeStatusClass(code)">
                  {{ getCodeStatusLabel(code) }}
                </span>
              </td>
              <td class="px-6 py-4 text-sm text-gray-500">{{ formatShanghaiDate(code.createdAt) }}</td>
              <td class="px-6 py-4 text-right">
                <div class="flex items-center justify-end gap-2">
                  <Button v-if="!code.isRedeemed" variant="outline" class="rounded-xl" @click="openRedeemDialog(code)">
                    <Ticket class="mr-2 h-4 w-4" />后台兑换
                  </Button>
                  <Button v-if="code.isRedeemed && code.fulfillmentMode !== 'external_api'" variant="outline" class="rounded-xl" :disabled="isReinviting(code.id)" @click="handleReinvite(code)">
                    {{ isReinviting(code.id) ? '处理中...' : '重新邀请' }}
                  </Button>
                  <Button v-if="code.fulfillmentMode === 'external_api'" variant="outline" class="rounded-xl" :disabled="isCheckingUpstream(code.id)" @click="handleCheckUpstream(code)">
                    {{ isCheckingUpstream(code.id) ? '检查中...' : '检查上游' }}
                  </Button>
                  <Button variant="outline" class="rounded-xl border-red-200 text-red-600" @click="handleDelete(code.id)">
                    <Trash2 class="h-4 w-4" />
                  </Button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!loading" class="flex items-center justify-between border-t border-gray-100 px-6 py-4 text-sm text-gray-500 bg-gray-50/30">
        <p>第 {{ currentPage }} / {{ totalPages }} 页，共 {{ totalCodes }} 个兑换码</p>
        <div class="flex items-center gap-2">
          <Button size="icon-sm" variant="outline" class="rounded-lg border-gray-200" :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">
            <ChevronLeft class="h-4 w-4" />
          </Button>
          <Button size="icon-sm" variant="outline" class="rounded-lg border-gray-200" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">
            <ChevronRight class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>

    <Dialog v-model:open="showBatchDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>批量创建兑换码</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div class="space-y-2">
            <Label for="batch-account">所属账号</Label>
            <select id="batch-account" v-model="selectedAccountEmail" class="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm">
              <option value="">请选择账号</option>
              <option v-for="account in accounts" :key="account.id" :value="account.email">{{ account.email }} (当前{{ account.userCount }}人)</option>
            </select>
          </div>
          <div class="space-y-2">
            <Label for="batch-channel">渠道</Label>
            <select id="batch-channel" v-model="selectedBatchChannel" class="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm">
              <option v-for="channel in batchChannelOptions" :key="channel.key" :value="channel.key">{{ channel.name }}</option>
            </select>
          </div>
          <div class="space-y-2">
            <Label for="batch-count">数量</Label>
            <Input id="batch-count" v-model="batchCount" type="number" class="h-11 rounded-xl" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" class="rounded-xl" @click="closeBatchDialog">取消</Button>
          <Button class="rounded-xl bg-black hover:bg-gray-800 text-white" :disabled="creating" @click="handleBatchCreate">
            {{ creating ? '创建中...' : '创建' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="showRedeemDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>后台兑换</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div class="rounded-2xl border border-gray-100 bg-gray-50/40 px-4 py-3 text-sm text-gray-700">
            兑换码：{{ redeemTargetCode?.code }}
          </div>
          <div class="space-y-2">
            <Label for="redeem-email">邮箱</Label>
            <Input id="redeem-email" v-model="redeemEmail" class="h-11 rounded-xl" placeholder="name@example.com" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" class="rounded-xl" @click="showRedeemDialog = false">取消</Button>
          <Button class="rounded-xl bg-black hover:bg-gray-800 text-white" :disabled="redeeming" @click="handleRedeem">
            {{ redeeming ? '兑换中...' : '确认兑换' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="showImportExternalDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导入外部卡密</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div class="space-y-2">
            <Label for="external-channel">渠道</Label>
            <select id="external-channel" v-model="importExternalChannel" class="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm">
              <option v-for="channel in externalImportChannelOptions" :key="channel.key" :value="channel.key">{{ channel.name }}</option>
            </select>
          </div>
          <div class="space-y-2">
            <Label for="external-codes">卡密列表</Label>
            <textarea id="external-codes" v-model="importExternalCodesText" class="min-h-[220px] w-full rounded-2xl border border-gray-200 p-4 text-sm outline-none focus:ring-2 focus:ring-blue-100" placeholder="一行一个卡密" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" class="rounded-xl" @click="showImportExternalDialog = false">取消</Button>
          <Button class="rounded-xl bg-black hover:bg-gray-800 text-white" :disabled="importingExternal" @click="handleImportExternal">
            {{ importingExternal ? '导入中...' : '导入' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
