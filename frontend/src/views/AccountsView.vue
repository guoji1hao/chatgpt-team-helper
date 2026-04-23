<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  authService,
  gptAccountService,
  openaiOAuthService,
  userService,
  type GptAccount,
  type CreateGptAccountDto,
  type ChatgptAccountInviteItem,
  type ChatgptAccountCheckInfo,
} from '@/services/api'
import { formatShanghaiDate } from '@/lib/datetime'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import AppleNativeDateTimeInput from '@/components/ui/apple/NativeDateTimeInput.vue'
import { Ban, Eye, FilePenLine, FolderOpen, Plus, RefreshCw, Search, Trash2 } from 'lucide-vue-next'

const router = useRouter()
const { success: showSuccessToast, error: showErrorToast, info: showInfoToast } = useToast()

const accounts = ref<GptAccount[]>([])
const loading = ref(false)
const error = ref('')
const searchQuery = ref('')
const openStatusFilter = ref<'all' | 'open' | 'closed'>('all')
const showDialog = ref(false)
const editingAccount = ref<GptAccount | null>(null)
const saving = ref(false)
const syncingAccountId = ref<number | null>(null)
const togglingOpenAccountId = ref<number | null>(null)
const banningAccountId = ref<number | null>(null)

const checkedChatgptAccounts = ref<ChatgptAccountCheckInfo[]>([])
const checkingAccessToken = ref(false)
const checkAccessTokenError = ref('')
const cachedApiKey = ref('')

const showOpenaiOAuthPanel = ref(false)
const openaiOAuthInput = ref('')
const openaiOAuthSession = ref<{ authUrl: string; sessionId: string; instructions?: string[] } | null>(null)
const generatingOpenaiAuthUrl = ref(false)
const exchangingOpenaiCode = ref(false)
const openaiOAuthError = ref('')

const formData = ref<CreateGptAccountDto>({
  email: '',
  token: '',
  refreshToken: '',
  userCount: 1,
  isBanned: false,
  isOpen: true,
  chatgptAccountId: '',
  oaiDeviceId: '',
  expireAt: '',
  remark: '',
})

const showSyncDialog = ref(false)
const selectedAccount = ref<GptAccount | null>(null)
const selectedInvites = ref<ChatgptAccountInviteItem[]>([])
const inviteEmail = ref('')
const inviteLoading = ref(false)
const removingInviteEmail = ref('')

const filteredAccounts = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase()
  return accounts.value.filter((account) => {
    const matchesKeyword = !keyword
      || account.email.toLowerCase().includes(keyword)
      || String(account.chatgptAccountId || '').toLowerCase().includes(keyword)
      || String(account.remark || '').toLowerCase().includes(keyword)
    const matchesOpen = openStatusFilter.value === 'all'
      || (openStatusFilter.value === 'open' && account.isOpen)
      || (openStatusFilter.value === 'closed' && !account.isOpen)
    return matchesKeyword && matchesOpen
  })
})

const ensureSystemApiKey = async (): Promise<string | null> => {
  if (cachedApiKey.value) return cachedApiKey.value
  try {
    const result = await userService.getApiKey()
    const apiKey = typeof result?.apiKey === 'string' ? result.apiKey.trim() : ''
    if (!apiKey) return null
    cachedApiKey.value = apiKey
    return apiKey
  } catch {
    return null
  }
}

const toDatetimeLocal = (value?: string | null) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.replace(/\//g, '-').replace(' ', 'T').slice(0, 16)
}

const fromDatetimeLocal = (value?: string | null) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.replace('T', ' ').replace(/-/g, '/').slice(0, 16)
}

const resetOAuthFlow = () => {
  showOpenaiOAuthPanel.value = false
  openaiOAuthInput.value = ''
  openaiOAuthSession.value = null
  generatingOpenaiAuthUrl.value = false
  exchangingOpenaiCode.value = false
  openaiOAuthError.value = ''
}

const closeDialog = () => {
  showDialog.value = false
  editingAccount.value = null
  formData.value = {
    email: '',
    token: '',
    refreshToken: '',
    userCount: 1,
    isBanned: false,
    isOpen: true,
    chatgptAccountId: '',
    oaiDeviceId: '',
    expireAt: '',
    remark: '',
  }
  checkedChatgptAccounts.value = []
  checkAccessTokenError.value = ''
  resetOAuthFlow()
}

const loadAccounts = async () => {
  loading.value = true
  error.value = ''
  try {
    const response = await gptAccountService.getAll({ page: 1, pageSize: 200 })
    accounts.value = response.accounts || []
  } catch (err: any) {
    error.value = err.response?.data?.error || '加载账号失败'
    if (err.response?.status === 401 || err.response?.status === 403) {
      authService.logout()
      router.push('/login')
    }
  } finally {
    loading.value = false
  }
}

const openCreateDialog = () => {
  closeDialog()
  showDialog.value = true
}

const openEditDialog = (account: GptAccount) => {
  editingAccount.value = account
  formData.value = {
    email: account.email,
    token: account.token,
    refreshToken: account.refreshToken || '',
    userCount: account.userCount,
    isBanned: Boolean(account.isBanned),
    isOpen: Boolean(account.isOpen),
    chatgptAccountId: account.chatgptAccountId || '',
    oaiDeviceId: account.oaiDeviceId || '',
    expireAt: toDatetimeLocal(account.expireAt || ''),
    remark: account.remark || '',
  }
  showDialog.value = true
}

const checkAccessToken = async () => {
  const token = formData.value.token.trim()
  if (!token) {
    checkAccessTokenError.value = '请先填写 access token'
    return
  }

  checkingAccessToken.value = true
  checkAccessTokenError.value = ''
  try {
    const result = await gptAccountService.checkAccessToken(token)
    checkedChatgptAccounts.value = result.accounts || []
    if (!checkedChatgptAccounts.value.length) {
      checkAccessTokenError.value = '未找到可用 Team 工作空间'
    }
  } catch (err: any) {
    checkAccessTokenError.value = err.response?.data?.error || '校验 access token 失败'
  } finally {
    checkingAccessToken.value = false
  }
}

const generateOpenaiAuthUrl = async () => {
  const apiKey = await ensureSystemApiKey()
  if (!apiKey) {
    openaiOAuthError.value = '系统未配置 API Key，请先到系统设置中配置'
    return
  }

  generatingOpenaiAuthUrl.value = true
  openaiOAuthError.value = ''
  try {
    const session = await openaiOAuthService.generateAuthUrl(apiKey)
    openaiOAuthSession.value = session
    showOpenaiOAuthPanel.value = true
  } catch (err: any) {
    openaiOAuthError.value = err.response?.data?.message || err.message || '生成授权链接失败'
  } finally {
    generatingOpenaiAuthUrl.value = false
  }
}

const extractOAuthCode = (value: string) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    return url.searchParams.get('code') || raw
  } catch {
    const match = raw.match(/[?&]code=([^&#]+)/)
    return match?.[1] ? decodeURIComponent(match[1]) : raw
  }
}

const exchangeOpenaiCode = async () => {
  const apiKey = await ensureSystemApiKey()
  if (!apiKey || !openaiOAuthSession.value?.sessionId) {
    openaiOAuthError.value = '授权会话不存在，请重新生成链接'
    return
  }

  const code = extractOAuthCode(openaiOAuthInput.value)
  if (!code) {
    openaiOAuthError.value = '请输入回调 URL 或授权码'
    return
  }

  exchangingOpenaiCode.value = true
  openaiOAuthError.value = ''
  try {
    const result = await openaiOAuthService.exchangeCode(apiKey, {
      code,
      sessionId: openaiOAuthSession.value.sessionId,
    })
    formData.value.email = result.accountInfo.email || formData.value.email
    formData.value.token = result.tokens.accessToken || formData.value.token
    formData.value.refreshToken = result.tokens.refreshToken || formData.value.refreshToken
    formData.value.chatgptAccountId = result.accountInfo.accountId || formData.value.chatgptAccountId
    checkedChatgptAccounts.value = [
      {
        accountId: result.accountInfo.accountId,
        name: result.accountInfo.organizationTitle || result.accountInfo.name,
        planType: result.accountInfo.planType,
        expiresAt: null,
        hasActiveSubscription: true,
        isDemoted: false,
      },
    ]
    showSuccessToast('已获取 OpenAI 凭证')
    showOpenaiOAuthPanel.value = false
  } catch (err: any) {
    openaiOAuthError.value = err.response?.data?.message || err.message || '交换授权码失败'
  } finally {
    exchangingOpenaiCode.value = false
  }
}

const handleSubmit = async () => {
  saving.value = true
  error.value = ''
  try {
    const payload: CreateGptAccountDto = {
      ...formData.value,
      email: formData.value.email.trim(),
      token: formData.value.token.trim(),
      refreshToken: formData.value.refreshToken?.trim() || '',
      chatgptAccountId: formData.value.chatgptAccountId?.trim() || '',
      oaiDeviceId: formData.value.oaiDeviceId?.trim() || '',
      expireAt: fromDatetimeLocal(formData.value.expireAt),
      remark: formData.value.remark?.trim() || '',
      isOpen: formData.value.isOpen !== false,
      isBanned: Boolean(formData.value.isBanned),
    }

    if (!payload.email || !payload.token || !payload.chatgptAccountId) {
      showErrorToast('邮箱、token 和 ChatGPT ID 为必填')
      return
    }

    if (editingAccount.value) {
      await gptAccountService.update(editingAccount.value.id, payload)
      showSuccessToast('账号更新成功')
    } else {
      const response = await gptAccountService.create(payload) as any
      const generatedCodes = Array.isArray(response?.generatedCodes) ? response.generatedCodes : []
      showSuccessToast(generatedCodes.length ? `账号创建成功，已自动生成 ${generatedCodes.length} 个兑换码` : '账号创建成功')
    }

    await loadAccounts()
    closeDialog()
  } catch (err: any) {
    error.value = err.response?.data?.error || '保存账号失败'
    showErrorToast(error.value)
  } finally {
    saving.value = false
  }
}

const handleDelete = async (id: number) => {
  if (!confirm('确定要删除这个账号吗？')) return
  try {
    await gptAccountService.delete(id)
    showSuccessToast('账号已删除')
    await loadAccounts()
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '删除账号失败')
  }
}

const handleToggleOpen = async (account: GptAccount) => {
  togglingOpenAccountId.value = account.id
  try {
    const updated = await gptAccountService.setOpen(account.id, !Boolean(account.isOpen))
    const index = accounts.value.findIndex(a => a.id === account.id)
    if (index !== -1) {
      accounts.value[index] = { ...accounts.value[index], ...updated }
      accounts.value = [...accounts.value]
    }
    showSuccessToast(updated.isOpen ? '账号已公开' : '账号已隐藏')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '更新公开状态失败')
  } finally {
    togglingOpenAccountId.value = null
  }
}

const handleBanAccount = async (account: GptAccount) => {
  if (account.isBanned) return
  if (!confirm(`确定将账号 ${account.email} 标记为封号吗？`)) return
  banningAccountId.value = account.id
  try {
    const updated = await gptAccountService.ban(account.id)
    const index = accounts.value.findIndex(a => a.id === account.id)
    if (index !== -1) {
      accounts.value[index] = { ...accounts.value[index], ...updated }
      accounts.value = [...accounts.value]
    }
    showSuccessToast('账号已标记为封号')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '封号操作失败')
  } finally {
    banningAccountId.value = null
  }
}

const handleSyncAccount = async (account: GptAccount) => {
  syncingAccountId.value = account.id
  try {
    const result = await gptAccountService.syncUserCount(account.id)
    const index = accounts.value.findIndex(a => a.id === account.id)
    if (index !== -1) {
      accounts.value[index] = {
        ...accounts.value[index],
        ...result.account,
        userCount: result.syncedUserCount,
        inviteCount: result.inviteCount,
      }
      accounts.value = [...accounts.value]
    }
    selectedAccount.value = accounts.value[index] || account
    selectedInvites.value = await gptAccountService.getInvites(account.id).then(res => res.items || [])
    showSyncDialog.value = true
    showSuccessToast('账号同步成功')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '同步账号失败')
  } finally {
    syncingAccountId.value = null
  }
}

const handleRefreshToken = async (account: GptAccount) => {
  syncingAccountId.value = account.id
  try {
    await gptAccountService.refreshToken(account.id)
    await loadAccounts()
    showSuccessToast('Token 刷新成功')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '刷新 token 失败')
  } finally {
    syncingAccountId.value = null
  }
}

const loadInvites = async (accountId: number) => {
  const response = await gptAccountService.getInvites(accountId)
  selectedInvites.value = response.items || []
}

const openSyncDialog = async (account: GptAccount) => {
  selectedAccount.value = account
  await loadInvites(account.id)
  showSyncDialog.value = true
}

const handleInviteUser = async () => {
  if (!selectedAccount.value || !inviteEmail.value.trim()) return
  inviteLoading.value = true
  try {
    await gptAccountService.inviteAccountUser(selectedAccount.value.id, inviteEmail.value.trim())
    inviteEmail.value = ''
    await loadInvites(selectedAccount.value.id)
    await loadAccounts()
    showSuccessToast('邀请已发送')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '发送邀请失败')
  } finally {
    inviteLoading.value = false
  }
}

const handleDeleteInvite = async (email: string) => {
  if (!selectedAccount.value) return
  removingInviteEmail.value = email
  try {
    await gptAccountService.deleteAccountInvite(selectedAccount.value.id, email)
    await loadInvites(selectedAccount.value.id)
    await loadAccounts()
    showSuccessToast('邀请已撤回')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '撤回邀请失败')
  } finally {
    removingInviteEmail.value = ''
  }
}

onMounted(async () => {
  if (!authService.isAuthenticated()) {
    router.push('/login')
    return
  }
  await loadAccounts()
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">账号管理</h1>
        <p class="text-sm text-gray-500">管理 Team 账号、同步人数、控制公开状态与封号。</p>
      </div>
      <div class="flex gap-3">
        <Input v-model="searchQuery" placeholder="搜索邮箱 / ChatGPT ID / 备注" class="h-11 w-[280px] rounded-xl" />
        <select v-model="openStatusFilter" class="h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm">
          <option value="all">全部</option>
          <option value="open">公开</option>
          <option value="closed">隐藏</option>
        </select>
        <Button variant="outline" class="h-11 rounded-xl" :disabled="loading" @click="loadAccounts">
          <RefreshCw class="mr-2 h-4 w-4" :class="loading ? 'animate-spin' : ''" />
          刷新
        </Button>
        <Button class="h-11 rounded-xl bg-black hover:bg-gray-800 text-white" @click="openCreateDialog">
          <Plus class="mr-2 h-4 w-4" />
          新建账号
        </Button>
      </div>
    </div>

    <div v-if="error" class="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">
      {{ error }}
    </div>

    <div class="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <Card v-for="account in filteredAccounts" :key="account.id" class="rounded-[28px] border border-gray-100 shadow-sm">
        <CardHeader class="space-y-3">
          <div class="flex items-start justify-between gap-3">
            <div>
              <CardTitle class="text-base font-semibold text-gray-900">{{ account.email }}</CardTitle>
              <p class="text-xs text-gray-500 mt-1">{{ account.chatgptAccountId || '未配置 ChatGPT ID' }}</p>
            </div>
            <div class="flex gap-2">
              <span class="rounded-full px-2 py-1 text-xs" :class="account.isOpen ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'">
                {{ account.isOpen ? '公开' : '隐藏' }}
              </span>
              <span class="rounded-full px-2 py-1 text-xs" :class="account.isBanned ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'">
                {{ account.isBanned ? '封号' : '正常' }}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="grid grid-cols-2 gap-4 rounded-2xl border border-gray-100 bg-gray-50/40 px-4 py-3 text-sm">
            <div>
              <div class="text-gray-500">成员数</div>
              <div class="font-semibold text-gray-900">{{ account.userCount }}</div>
            </div>
            <div>
              <div class="text-gray-500">待邀请</div>
              <div class="font-semibold text-gray-900">{{ account.inviteCount ?? 0 }}</div>
            </div>
            <div>
              <div class="text-gray-500">到期时间</div>
              <div class="font-semibold text-gray-900">{{ formatShanghaiDate(account.expireAt) }}</div>
            </div>
            <div>
              <div class="text-gray-500">更新时间</div>
              <div class="font-semibold text-gray-900">{{ formatShanghaiDate(account.updatedAt) }}</div>
            </div>
          </div>
          <p v-if="account.remark" class="text-sm text-gray-600">{{ account.remark }}</p>
          <div class="flex flex-wrap gap-2">
            <Button variant="outline" class="rounded-xl" @click="openEditDialog(account)">
              <FilePenLine class="mr-2 h-4 w-4" />编辑
            </Button>
            <Button variant="outline" class="rounded-xl" :disabled="togglingOpenAccountId === account.id" @click="handleToggleOpen(account)">
              <Eye class="mr-2 h-4 w-4" />{{ account.isOpen ? '隐藏' : '公开' }}
            </Button>
            <Button variant="outline" class="rounded-xl" :disabled="syncingAccountId === account.id" @click="handleSyncAccount(account)">
              <RefreshCw class="mr-2 h-4 w-4" :class="syncingAccountId === account.id ? 'animate-spin' : ''" />同步
            </Button>
            <Button variant="outline" class="rounded-xl" :disabled="syncingAccountId === account.id" @click="handleRefreshToken(account)">
              <FolderOpen class="mr-2 h-4 w-4" />刷新 Token
            </Button>
            <Button variant="outline" class="rounded-xl border-red-200 text-red-600" :disabled="account.isBanned || banningAccountId === account.id" @click="handleBanAccount(account)">
              <Ban class="mr-2 h-4 w-4" />封号
            </Button>
            <Button variant="outline" class="rounded-xl border-red-200 text-red-600" @click="handleDelete(account.id)">
              <Trash2 class="mr-2 h-4 w-4" />删除
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <Dialog v-model:open="showDialog">
      <DialogContent class="sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>{{ editingAccount ? '编辑账号' : '新建账号' }}</DialogTitle>
        </DialogHeader>

        <div class="grid gap-4 md:grid-cols-2">
          <div class="space-y-2 md:col-span-2">
            <Button variant="outline" class="rounded-xl" :disabled="generatingOpenaiAuthUrl" @click="generateOpenaiAuthUrl">
              {{ generatingOpenaiAuthUrl ? '生成中...' : '通过 OpenAI OAuth 获取凭证' }}
            </Button>
          </div>

          <div v-if="showOpenaiOAuthPanel && openaiOAuthSession" class="space-y-2 md:col-span-2 rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
            <p class="text-sm text-gray-700">打开下面链接授权，然后把回调 URL 或 code 粘贴回来。</p>
            <a :href="openaiOAuthSession.authUrl" target="_blank" class="break-all text-sm text-blue-600 hover:underline">{{ openaiOAuthSession.authUrl }}</a>
            <Input v-model="openaiOAuthInput" placeholder="粘贴回调 URL 或授权码" class="h-11 rounded-xl" />
            <div class="flex gap-3">
              <Button class="rounded-xl bg-black hover:bg-gray-800 text-white" :disabled="exchangingOpenaiCode" @click="exchangeOpenaiCode">
                {{ exchangingOpenaiCode ? '处理中...' : '交换授权码' }}
              </Button>
              <Button variant="outline" class="rounded-xl" @click="resetOAuthFlow">关闭</Button>
            </div>
            <p v-if="openaiOAuthError" class="text-sm text-red-600">{{ openaiOAuthError }}</p>
          </div>

          <div class="space-y-2">
            <Label for="account-email">邮箱</Label>
            <Input id="account-email" v-model="formData.email" class="h-11 rounded-xl" />
          </div>
          <div class="space-y-2">
            <Label for="account-user-count">当前成员数</Label>
            <Input id="account-user-count" v-model="formData.userCount" type="number" class="h-11 rounded-xl" />
          </div>
          <div class="space-y-2 md:col-span-2">
            <Label for="account-token">Access Token</Label>
            <Input id="account-token" v-model="formData.token" class="h-11 rounded-xl" />
            <Button variant="outline" class="mt-2 rounded-xl" :disabled="checkingAccessToken" @click="checkAccessToken">
              {{ checkingAccessToken ? '校验中...' : '校验 Token' }}
            </Button>
            <p v-if="checkAccessTokenError" class="text-sm text-red-600">{{ checkAccessTokenError }}</p>
          </div>
          <div class="space-y-2 md:col-span-2">
            <Label for="account-refresh-token">Refresh Token</Label>
            <Input id="account-refresh-token" v-model="formData.refreshToken" class="h-11 rounded-xl" />
          </div>
          <div class="space-y-2">
            <Label for="account-chatgpt-id">ChatGPT ID</Label>
            <select id="account-chatgpt-id" v-model="formData.chatgptAccountId" class="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm">
              <option value="">请选择</option>
              <option v-for="item in checkedChatgptAccounts" :key="item.accountId" :value="item.accountId">
                {{ item.name }} ({{ item.accountId }})
              </option>
            </select>
          </div>
          <div class="space-y-2">
            <Label for="account-device-id">OAI Device ID</Label>
            <Input id="account-device-id" v-model="formData.oaiDeviceId" class="h-11 rounded-xl" />
          </div>
          <div class="space-y-2">
            <Label for="account-expire-at">到期时间</Label>
            <AppleNativeDateTimeInput id="account-expire-at" v-model="formData.expireAt" class="w-full" />
          </div>
          <div class="space-y-2">
            <Label for="account-open">公开状态</Label>
            <select id="account-open" v-model="formData.isOpen" class="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm">
              <option :value="true">公开</option>
              <option :value="false">隐藏</option>
            </select>
          </div>
          <div class="space-y-2 md:col-span-2">
            <Label for="account-remark">备注</Label>
            <Input id="account-remark" v-model="formData.remark as string" class="h-11 rounded-xl" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" class="rounded-xl" @click="closeDialog">取消</Button>
          <Button class="rounded-xl bg-black hover:bg-gray-800 text-white" :disabled="saving" @click="handleSubmit">
            {{ saving ? '保存中...' : '保存' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="showSyncDialog">
      <DialogContent class="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>邀请管理</DialogTitle>
        </DialogHeader>
        <div v-if="selectedAccount" class="space-y-4">
          <div class="rounded-2xl border border-gray-100 bg-gray-50/40 px-4 py-3 text-sm text-gray-700">
            {{ selectedAccount.email }} · 成员 {{ selectedAccount.userCount }} · 待邀请 {{ selectedAccount.inviteCount ?? 0 }}
          </div>
          <div class="flex gap-3">
            <Input v-model="inviteEmail" placeholder="输入邮箱后发送邀请" class="h-11 rounded-xl" />
            <Button class="rounded-xl bg-black hover:bg-gray-800 text-white" :disabled="inviteLoading" @click="handleInviteUser">
              {{ inviteLoading ? '发送中...' : '发送邀请' }}
            </Button>
          </div>
          <div class="space-y-3 max-h-[320px] overflow-auto">
            <div v-if="selectedInvites.length === 0" class="text-sm text-gray-500">暂无待处理邀请</div>
            <div v-for="invite in selectedInvites" :key="invite.id" class="flex items-center justify-between rounded-2xl border border-gray-100 px-4 py-3">
              <div>
                <div class="font-medium text-gray-900">{{ invite.email_address || '-' }}</div>
                <div class="text-xs text-gray-500">{{ formatShanghaiDate(invite.created_time || '') }}</div>
              </div>
              <Button variant="outline" class="rounded-xl border-red-200 text-red-600" :disabled="removingInviteEmail === invite.email_address" @click="handleDeleteInvite(invite.email_address || '')">
                {{ removingInviteEmail === invite.email_address ? '撤回中...' : '撤回邀请' }}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
