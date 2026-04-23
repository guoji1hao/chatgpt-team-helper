<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { AlertTriangle, BarChart3, RefreshCw } from 'lucide-vue-next'
import { authService, adminStatsService, type AdminStatsOverviewResponse } from '@/services/api'
import { useAppConfigStore } from '@/stores/appConfig'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import NativeDateInput from '@/components/ui/apple/NativeDateInput.vue'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const router = useRouter()
const appConfigStore = useAppConfigStore()

const teleportReady = ref(false)
const loading = ref(false)
const error = ref('')
const overview = ref<AdminStatsOverviewResponse | null>(null)

type RangePreset = 'today' | '7d' | '30d' | 'custom'
const rangePreset = ref<RangePreset>('today')
const rangeFrom = ref('')
const rangeTo = ref('')
const applyingPreset = ref(false)

const formatLocalDateOnly = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const addDays = (date: Date, days: number) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

const applyRangePreset = (preset: RangePreset) => {
  const today = new Date()
  applyingPreset.value = true
  if (preset === 'today') {
    rangeFrom.value = formatLocalDateOnly(today)
    rangeTo.value = formatLocalDateOnly(today)
  } else if (preset === '7d') {
    rangeFrom.value = formatLocalDateOnly(addDays(today, -6))
    rangeTo.value = formatLocalDateOnly(today)
  } else if (preset === '30d') {
    rangeFrom.value = formatLocalDateOnly(addDays(today, -29))
    rangeTo.value = formatLocalDateOnly(today)
  }
  applyingPreset.value = false
}

watch(rangePreset, (preset) => {
  if (preset === 'custom') return
  applyRangePreset(preset)
}, { immediate: true })

watch([rangeFrom, rangeTo], () => {
  if (applyingPreset.value) return
  if (rangePreset.value !== 'custom') {
    rangePreset.value = 'custom'
  }
}, { flush: 'sync' })

const locale = computed(() => appConfigStore.locale || 'zh-CN')
const numberFmt = computed(() => new Intl.NumberFormat(locale.value))
const percentFmt = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 1 }))

const formatNumber = (value?: number | null) => numberFmt.value.format(Number(value || 0))
const formatPercent = (value?: number | null) => percentFmt.value.format(Number(value || 0))

const loadOverview = async () => {
  loading.value = true
  error.value = ''
  try {
    overview.value = await adminStatsService.getOverview({
      from: rangeFrom.value,
      to: rangeTo.value,
    })
  } catch (err: any) {
    const message = err?.response?.data?.error || '加载统计数据失败'
    error.value = message
    if (err?.response?.status === 401 || err?.response?.status === 403) {
      authService.logout()
      router.push('/login')
      return
    }
  } finally {
    loading.value = false
  }
}

const cards = computed(() => {
  const data = overview.value
  if (!data) return []
  return [
    { label: '用户总数', value: formatNumber(data.users.total), hint: `区间新增 ${formatNumber(data.users.created)}` },
    { label: '可公开账号', value: formatNumber(data.gptAccounts.open), hint: `总账号 ${formatNumber(data.gptAccounts.total)}` },
    { label: '封号账号', value: formatNumber(data.gptAccounts.banned), hint: `7 天内到期 ${formatNumber(data.gptAccounts.expiringSoon)}` },
    { label: '席位利用率', value: formatPercent(data.gptAccounts.seatUtilization), hint: `${formatNumber(data.gptAccounts.usedSeats)} / ${formatNumber(data.gptAccounts.totalSeats)}` },
    { label: '待处理邀请', value: formatNumber(data.gptAccounts.invitePending), hint: `超员账号 ${formatNumber(data.gptAccounts.openAccountsOverCapacity)}` },
    { label: '兑换码总量', value: formatNumber(data.redemptionCodes.total), hint: `未使用 ${formatNumber(data.redemptionCodes.unused)}` },
    { label: '已兑换', value: formatNumber(data.redemptionCodes.redeemed), hint: `区间兑换 ${formatNumber(data.redemptionCodes.redeemedInRange)}` },
    { label: '新增兑换码', value: formatNumber(data.redemptionCodes.created), hint: '按当前查询区间统计' },
  ]
})

onMounted(async () => {
  await nextTick()
  teleportReady.value = !!document.getElementById('header-actions')
  await appConfigStore.loadConfig()

  if (!authService.isAuthenticated()) {
    router.push('/login')
    return
  }

  if (!rangeFrom.value || !rangeTo.value) {
    applyRangePreset(rangePreset.value)
  }

  await loadOverview()
})
</script>

<template>
  <div class="space-y-8">
    <Teleport v-if="teleportReady" to="#header-actions">
      <div class="w-full flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-end">
        <div class="grid grid-cols-2 gap-3 w-full sm:w-auto sm:flex sm:items-end sm:gap-2">
          <div class="space-y-1 col-span-2 sm:col-span-1">
            <Label class="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">范围</Label>
            <Select v-model="rangePreset">
              <SelectTrigger class="h-10 w-full sm:w-[120px] bg-white border-gray-200 rounded-xl">
                <SelectValue placeholder="选择范围" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">今日</SelectItem>
                <SelectItem value="7d">近 7 天</SelectItem>
                <SelectItem value="30d">近 30 天</SelectItem>
                <SelectItem value="custom">自定义</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-1">
            <Label class="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">开始</Label>
            <NativeDateInput v-model="rangeFrom" placeholder="开始日期" class="w-full sm:w-[160px]" />
          </div>

          <div class="space-y-1">
            <Label class="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">结束</Label>
            <NativeDateInput v-model="rangeTo" placeholder="结束日期" class="w-full sm:w-[160px]" />
          </div>
        </div>

        <Button
          variant="outline"
          class="h-10 w-full rounded-xl border-gray-200 bg-white sm:w-auto"
          :disabled="loading"
          @click="loadOverview"
        >
          <RefreshCw class="w-4 h-4 mr-2" :class="{ 'animate-spin': loading }" />
          刷新
        </Button>
      </div>
    </Teleport>

    <div v-if="error" class="rounded-2xl border border-red-100 bg-red-50/50 p-4 flex items-center gap-3 text-red-600">
      <AlertTriangle class="h-5 w-5" />
      <span class="font-medium">{{ error }}</span>
    </div>

    <div class="bg-white rounded-[32px] shadow-sm border border-gray-100 overflow-hidden min-h-[400px]">
      <div v-if="loading && !overview" class="flex flex-col items-center justify-center py-20">
        <div class="w-10 h-10 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
        <p class="text-gray-400 text-sm font-medium mt-4">正在加载统计数据...</p>
      </div>

      <div v-else class="p-6 lg:p-8 space-y-8">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600">
            <BarChart3 class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-lg font-semibold text-gray-900">系统概览</h3>
            <p v-if="overview" class="text-xs text-gray-400 mt-0.5">
              范围：{{ overview.range.from }} ~ {{ overview.range.to }}
            </p>
          </div>
        </div>

        <div v-if="overview" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card v-for="card in cards" :key="card.label" class="rounded-2xl border-gray-100">
            <CardContent class="p-5 space-y-2">
              <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">{{ card.label }}</p>
              <p class="text-2xl font-bold text-gray-900">{{ card.value }}</p>
              <p class="text-xs text-gray-500">{{ card.hint }}</p>
            </CardContent>
          </Card>
        </div>

        <div v-if="overview" class="grid gap-6 lg:grid-cols-2">
          <Card class="rounded-2xl border-gray-100">
            <CardContent class="p-6 space-y-4">
              <div>
                <h4 class="text-base font-semibold text-gray-900">按渠道库存</h4>
                <p class="text-sm text-gray-500">仅统计保留的兑换码渠道</p>
              </div>
              <div class="space-y-3">
                <div
                  v-for="item in overview.redemptionCodes.byChannel"
                  :key="item.channel"
                  class="flex items-center justify-between rounded-2xl border border-gray-100 px-4 py-3"
                >
                  <div>
                    <p class="font-medium text-gray-900">{{ item.channel }}</p>
                    <p class="text-xs text-gray-500">总量 {{ formatNumber(item.total) }}</p>
                  </div>
                  <div class="text-right">
                    <p class="text-lg font-semibold text-gray-900">{{ formatNumber(item.unused) }}</p>
                    <p class="text-xs text-gray-500">未使用</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card class="rounded-2xl border-gray-100">
            <CardContent class="p-6 space-y-4">
              <div>
                <h4 class="text-base font-semibold text-gray-900">最近兑换</h4>
                <p class="text-sm text-gray-500">最近 10 条成功兑换记录</p>
              </div>
              <div v-if="overview.recentRedeems.length" class="space-y-3">
                <div
                  v-for="item in overview.recentRedeems"
                  :key="`${item.code}-${item.redeemedAt}`"
                  class="rounded-2xl border border-gray-100 px-4 py-3"
                >
                  <div class="flex items-center justify-between gap-3">
                    <p class="font-medium text-gray-900">{{ item.code }}</p>
                    <span class="text-xs text-gray-500">{{ item.channel }}</span>
                  </div>
                  <p class="text-sm text-gray-600 mt-1">{{ item.redeemedBy || item.accountEmail || '未知兑换者' }}</p>
                  <p class="text-xs text-gray-400 mt-1">{{ item.redeemedAt || '-' }}</p>
                </div>
              </div>
              <div v-else class="rounded-2xl border border-dashed border-gray-200 px-4 py-8 text-sm text-gray-400 text-center">
                暂无兑换记录
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  </div>
</template>
