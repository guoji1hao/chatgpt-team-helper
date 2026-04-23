<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminService, userService, type Channel, type AdminProxyTestResult } from '@/services/api'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'

const { success: showSuccessToast, error: showErrorToast, info: showInfoToast } = useToast()

const apiKey = ref('')
const apiKeyLoading = ref(false)
const apiKeyConfigured = ref(false)

const emailDomainWhitelist = ref('')
const emailWhitelistLoading = ref(false)

const turnstileSiteKey = ref('')
const turnstileSecretKey = ref('')
const turnstileLoading = ref(false)
const turnstileSecretSet = ref(false)
const turnstileEnabled = ref(false)

const telegramAllowedUserIds = ref('')
const telegramBotToken = ref('')
const telegramNotifyEnabled = ref(true)
const telegramNotifyChatIds = ref('')
const telegramNotifyTimeoutMs = ref('8000')
const telegramLoading = ref(false)
const telegramTokenSet = ref(false)

const proxyUrls = ref('')
const proxyLoading = ref(false)
const proxyEffectiveCount = ref(0)
const proxyTestResults = ref<AdminProxyTestResult[]>([])
const proxyTesting = ref(false)

const channels = ref<Channel[]>([])
const channelsLoading = ref(false)
const channelDialogOpen = ref(false)
const channelDialogMode = ref<'create' | 'edit'>('create')
const channelFormKey = ref('')
const channelFormName = ref('')
const channelFormRedeemMode = ref('code')
const channelFormProviderType = ref('local')
const channelFormAllowFallback = ref(false)
const channelFormIsActive = ref(true)
const channelFormSortOrder = ref('0')

const loadApiKey = async () => {
  const response = await userService.getApiKey()
  apiKey.value = response.apiKey || ''
  apiKeyConfigured.value = Boolean(response.configured)
}

const saveApiKey = async () => {
  apiKeyLoading.value = true
  try {
    const response = await userService.updateApiKey(apiKey.value.trim())
    apiKey.value = response.apiKey
    apiKeyConfigured.value = true
    showSuccessToast(response.message || 'API Key 已更新')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '更新 API Key 失败')
  } finally {
    apiKeyLoading.value = false
  }
}

const loadEmailWhitelist = async () => {
  const response = await adminService.getEmailDomainWhitelist()
  emailDomainWhitelist.value = (response.domains || []).join('\n')
}

const saveEmailWhitelist = async () => {
  emailWhitelistLoading.value = true
  try {
    const domains = emailDomainWhitelist.value
      .split(/[\n,;]+/)
      .map(item => item.trim())
      .filter(Boolean)
    const response = await adminService.updateEmailDomainWhitelist(domains)
    emailDomainWhitelist.value = (response.domains || []).join('\n')
    showSuccessToast('邮箱白名单已更新')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '更新邮箱白名单失败')
  } finally {
    emailWhitelistLoading.value = false
  }
}

const loadTurnstile = async () => {
  const response = await adminService.getTurnstileSettings()
  turnstileSiteKey.value = response.turnstile.siteKey || ''
  turnstileSecretSet.value = Boolean(response.turnstile.secretSet)
  turnstileEnabled.value = Boolean(response.enabled)
  turnstileSecretKey.value = ''
}

const saveTurnstile = async () => {
  turnstileLoading.value = true
  try {
    const response = await adminService.updateTurnstileSettings({
      turnstile: {
        siteKey: turnstileSiteKey.value.trim(),
        ...(turnstileSecretKey.value.trim() ? { secretKey: turnstileSecretKey.value.trim() } : {}),
      },
    })
    turnstileSiteKey.value = response.turnstile.siteKey || ''
    turnstileSecretSet.value = Boolean(response.turnstile.secretSet)
    turnstileEnabled.value = Boolean(response.enabled)
    turnstileSecretKey.value = ''
    showSuccessToast('Turnstile 配置已更新')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '更新 Turnstile 失败')
  } finally {
    turnstileLoading.value = false
  }
}

const loadTelegram = async () => {
  const response = await adminService.getTelegramSettings()
  telegramAllowedUserIds.value = response.telegram.allowedUserIds || ''
  telegramNotifyEnabled.value = Boolean(response.telegram.notifyEnabled)
  telegramNotifyChatIds.value = response.telegram.notifyChatIds || ''
  telegramNotifyTimeoutMs.value = String(response.telegram.notifyTimeoutMs || 8000)
  telegramTokenSet.value = Boolean(response.telegram.tokenSet)
  telegramBotToken.value = ''
}

const saveTelegram = async () => {
  telegramLoading.value = true
  try {
    const response = await adminService.updateTelegramSettings({
      telegram: {
        allowedUserIds: telegramAllowedUserIds.value.trim(),
        ...(telegramBotToken.value.trim() ? { botToken: telegramBotToken.value.trim() } : {}),
        notifyEnabled: telegramNotifyEnabled.value,
        notifyChatIds: telegramNotifyChatIds.value.trim(),
        notifyTimeoutMs: Number(telegramNotifyTimeoutMs.value || 8000),
      },
    })
    telegramAllowedUserIds.value = response.telegram.allowedUserIds || ''
    telegramNotifyEnabled.value = Boolean(response.telegram.notifyEnabled)
    telegramNotifyChatIds.value = response.telegram.notifyChatIds || ''
    telegramNotifyTimeoutMs.value = String(response.telegram.notifyTimeoutMs || 8000)
    telegramTokenSet.value = Boolean(response.telegram.tokenSet)
    telegramBotToken.value = ''
    showSuccessToast('Telegram 配置已更新')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '更新 Telegram 配置失败')
  } finally {
    telegramLoading.value = false
  }
}

const loadProxy = async () => {
  const response = await adminService.getProxySettings()
  proxyUrls.value = response.proxy.proxyUrls || ''
  proxyEffectiveCount.value = Number(response.proxy.effectiveCount || 0)
}

const saveProxy = async () => {
  proxyLoading.value = true
  try {
    const response = await adminService.updateProxySettings({
      proxy: { proxyUrls: proxyUrls.value.trim() },
    })
    proxyUrls.value = response.proxy.proxyUrls || ''
    proxyEffectiveCount.value = Number(response.proxy.effectiveCount || 0)
    showSuccessToast('代理配置已更新')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '更新代理配置失败')
  } finally {
    proxyLoading.value = false
  }
}

const testProxy = async () => {
  proxyTesting.value = true
  try {
    const response = await adminService.testProxySettings({ proxy: { proxyUrls: proxyUrls.value.trim() } })
    proxyTestResults.value = response.results || []
    showInfoToast(`代理测试完成：${response.passed}/${response.total} 通过`)
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '测试代理失败')
  } finally {
    proxyTesting.value = false
  }
}

const loadChannels = async () => {
  channelsLoading.value = true
  try {
    const response = await adminService.getChannels()
    channels.value = response.channels || []
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '加载渠道失败')
  } finally {
    channelsLoading.value = false
  }
}

const openCreateChannelDialog = () => {
  channelDialogMode.value = 'create'
  channelFormKey.value = ''
  channelFormName.value = ''
  channelFormRedeemMode.value = 'code'
  channelFormProviderType.value = 'local'
  channelFormAllowFallback.value = false
  channelFormIsActive.value = true
  channelFormSortOrder.value = '0'
  channelDialogOpen.value = true
}

const openEditChannelDialog = (channel: Channel) => {
  channelDialogMode.value = 'edit'
  channelFormKey.value = channel.key
  channelFormName.value = channel.name
  channelFormRedeemMode.value = channel.redeemMode
  channelFormProviderType.value = channel.providerType
  channelFormAllowFallback.value = Boolean(channel.allowCommonFallback)
  channelFormIsActive.value = Boolean(channel.isActive)
  channelFormSortOrder.value = String(channel.sortOrder || 0)
  channelDialogOpen.value = true
}

const saveChannel = async () => {
  try {
    const payload = {
      key: channelFormKey.value.trim(),
      name: channelFormName.value.trim(),
      redeemMode: channelFormRedeemMode.value,
      providerType: channelFormProviderType.value,
      allowCommonFallback: channelFormAllowFallback.value,
      isActive: channelFormIsActive.value,
      sortOrder: Number(channelFormSortOrder.value || 0),
    }

    if (channelDialogMode.value === 'create') {
      await adminService.createChannel(payload)
      showSuccessToast('渠道已创建')
    } else {
      await adminService.updateChannel(channelFormKey.value, {
        name: payload.name,
        redeemMode: payload.redeemMode,
        providerType: payload.providerType,
        allowCommonFallback: payload.allowCommonFallback,
        isActive: payload.isActive,
        sortOrder: payload.sortOrder,
      })
      showSuccessToast('渠道已更新')
    }

    channelDialogOpen.value = false
    await loadChannels()
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '保存渠道失败')
  }
}

const toggleChannel = async (channel: Channel) => {
  try {
    await adminService.updateChannel(channel.key, { isActive: !channel.isActive })
    await loadChannels()
    showSuccessToast('渠道状态已更新')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '更新渠道状态失败')
  }
}

const deleteChannel = async (channel: Channel) => {
  if (!confirm(`确定删除渠道 ${channel.name} 吗？`)) return
  try {
    await adminService.deleteChannel(channel.key)
    await loadChannels()
    showSuccessToast('渠道已删除')
  } catch (err: any) {
    showErrorToast(err.response?.data?.error || '删除渠道失败')
  }
}

onMounted(async () => {
  await Promise.all([
    loadApiKey(),
    loadEmailWhitelist(),
    loadTurnstile(),
    loadTelegram(),
    loadProxy(),
    loadChannels(),
  ])
})
</script>

<template>
  <div class="space-y-8">
    <div>
      <h1 class="text-2xl font-semibold text-gray-900">系统设置</h1>
      <p class="text-sm text-gray-500">只保留当前系统仍在使用的核心配置。</p>
    </div>

    <div class="grid gap-8 lg:grid-cols-2">
      <Card class="rounded-[32px] border border-gray-100 shadow-sm">
        <CardHeader>
          <CardTitle>开放 API Key</CardTitle>
          <CardDescription>用于外部封号、OpenAI OAuth 和自动化调用。</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-2">
            <Label for="api-key">API Key</Label>
            <Input id="api-key" v-model="apiKey" class="h-11 rounded-xl" />
            <p class="text-xs text-gray-500">当前状态：{{ apiKeyConfigured ? '已配置' : '未配置' }}</p>
          </div>
          <Button class="rounded-xl bg-black hover:bg-gray-800 text-white" :disabled="apiKeyLoading" @click="saveApiKey">
            {{ apiKeyLoading ? '保存中...' : '保存 API Key' }}
          </Button>
        </CardContent>
      </Card>

      <Card class="rounded-[32px] border border-gray-100 shadow-sm">
        <CardHeader>
          <CardTitle>邮箱白名单</CardTitle>
          <CardDescription>限制可用邮箱后缀，一行一个或逗号分隔。</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <textarea v-model="emailDomainWhitelist" class="min-h-[180px] w-full rounded-2xl border border-gray-200 p-4 text-sm outline-none focus:ring-2 focus:ring-blue-100" />
          <Button variant="outline" class="rounded-xl" :disabled="emailWhitelistLoading" @click="saveEmailWhitelist">
            {{ emailWhitelistLoading ? '保存中...' : '保存白名单' }}
          </Button>
        </CardContent>
      </Card>

      <Card class="rounded-[32px] border border-gray-100 shadow-sm">
        <CardHeader>
          <CardTitle>Turnstile</CardTitle>
          <CardDescription>仅保留验证码配置。</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-2">
            <Label for="turnstile-site-key">Site Key</Label>
            <Input id="turnstile-site-key" v-model="turnstileSiteKey" class="h-11 rounded-xl" />
          </div>
          <div class="space-y-2">
            <Label for="turnstile-secret-key">Secret Key</Label>
            <Input id="turnstile-secret-key" v-model="turnstileSecretKey" class="h-11 rounded-xl" type="password" />
            <p class="text-xs text-gray-500">当前 Secret：{{ turnstileSecretSet ? '已配置' : '未配置' }}；状态：{{ turnstileEnabled ? '已启用' : '未启用' }}</p>
          </div>
          <Button variant="outline" class="rounded-xl" :disabled="turnstileLoading" @click="saveTurnstile">
            {{ turnstileLoading ? '保存中...' : '保存 Turnstile' }}
          </Button>
        </CardContent>
      </Card>

      <Card class="rounded-[32px] border border-gray-100 shadow-sm">
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
          <CardDescription>保留 Bot、白名单和通知配置。</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-2">
            <Label for="telegram-user-ids">允许的用户 ID</Label>
            <Input id="telegram-user-ids" v-model="telegramAllowedUserIds" class="h-11 rounded-xl" />
          </div>
          <div class="space-y-2">
            <Label for="telegram-token">Bot Token</Label>
            <Input id="telegram-token" v-model="telegramBotToken" class="h-11 rounded-xl" type="password" />
            <p class="text-xs text-gray-500">当前 Token：{{ telegramTokenSet ? '已配置' : '未配置' }}</p>
          </div>
          <div class="space-y-2">
            <Label for="telegram-chat-ids">通知 Chat IDs</Label>
            <Input id="telegram-chat-ids" v-model="telegramNotifyChatIds" class="h-11 rounded-xl" />
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label for="telegram-timeout">通知超时(ms)</Label>
              <Input id="telegram-timeout" v-model="telegramNotifyTimeoutMs" class="h-11 rounded-xl" />
            </div>
            <div class="space-y-2">
              <Label for="telegram-enabled">通知开关</Label>
              <select id="telegram-enabled" v-model="telegramNotifyEnabled" class="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm">
                <option :value="true">开启</option>
                <option :value="false">关闭</option>
              </select>
            </div>
          </div>
          <Button variant="outline" class="rounded-xl" :disabled="telegramLoading" @click="saveTelegram">
            {{ telegramLoading ? '保存中...' : '保存 Telegram 配置' }}
          </Button>
        </CardContent>
      </Card>

      <Card class="rounded-[32px] border border-gray-100 shadow-sm lg:col-span-2">
        <CardHeader>
          <CardTitle>代理池</CardTitle>
          <CardDescription>用于 OpenAI 同步、邀请和超员扫描。</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <textarea v-model="proxyUrls" class="min-h-[180px] w-full rounded-2xl border border-gray-200 p-4 text-sm outline-none focus:ring-2 focus:ring-blue-100" placeholder="一行一个代理地址" />
          <div class="flex flex-wrap items-center gap-3">
            <Button variant="outline" class="rounded-xl" :disabled="proxyLoading" @click="saveProxy">
              {{ proxyLoading ? '保存中...' : '保存代理配置' }}
            </Button>
            <Button variant="outline" class="rounded-xl" :disabled="proxyTesting" @click="testProxy">
              {{ proxyTesting ? '测试中...' : '测试代理' }}
            </Button>
            <span class="text-sm text-gray-500">有效代理数：{{ proxyEffectiveCount }}</span>
          </div>
          <div v-if="proxyTestResults.length" class="space-y-3">
            <div v-for="result in proxyTestResults" :key="result.proxy" class="rounded-2xl border border-gray-100 px-4 py-3 text-sm">
              <div class="font-medium text-gray-900">{{ result.proxy }}</div>
              <div class="text-gray-500">{{ result.message }}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card class="rounded-[32px] border border-gray-100 shadow-sm lg:col-span-2">
        <CardHeader class="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>兑换渠道</CardTitle>
            <CardDescription>保留通用兑换与可选扩展渠道。</CardDescription>
          </div>
          <Button class="rounded-xl bg-black hover:bg-gray-800 text-white" @click="openCreateChannelDialog">新增渠道</Button>
        </CardHeader>
        <CardContent class="space-y-4">
          <div v-if="channelsLoading" class="text-sm text-gray-500">加载中...</div>
          <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div v-for="channel in channels" :key="channel.key" class="rounded-2xl border border-gray-100 p-5 space-y-3">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="font-semibold text-gray-900">{{ channel.name }}</div>
                  <div class="text-xs text-gray-500">{{ channel.key }}</div>
                </div>
                <span class="text-xs rounded-full px-2 py-1" :class="channel.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'">
                  {{ channel.isActive ? '启用' : '停用' }}
                </span>
              </div>
              <div class="text-sm text-gray-600">模式：{{ channel.redeemMode }} / Provider：{{ channel.providerType }}</div>
              <div class="flex items-center gap-2">
                <Button variant="outline" class="rounded-xl" @click="openEditChannelDialog(channel)">编辑</Button>
                <Button variant="outline" class="rounded-xl" @click="toggleChannel(channel)">{{ channel.isActive ? '停用' : '启用' }}</Button>
                <Button v-if="!channel.isBuiltin" variant="outline" class="rounded-xl text-red-600 border-red-200" @click="deleteChannel(channel)">删除</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <Dialog v-model:open="channelDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ channelDialogMode === 'create' ? '新增渠道' : '编辑渠道' }}</DialogTitle>
          <DialogDescription>配置兑换渠道的基础属性。</DialogDescription>
        </DialogHeader>
        <div class="space-y-4">
          <div class="space-y-2">
            <Label for="channel-key">渠道 Key</Label>
            <Input id="channel-key" v-model="channelFormKey" :disabled="channelDialogMode === 'edit'" class="h-11 rounded-xl" />
          </div>
          <div class="space-y-2">
            <Label for="channel-name">渠道名称</Label>
            <Input id="channel-name" v-model="channelFormName" class="h-11 rounded-xl" />
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label for="channel-redeem-mode">兑换模式</Label>
              <select id="channel-redeem-mode" v-model="channelFormRedeemMode" class="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm">
                <option value="code">code</option>
                <option value="external-card">external-card</option>
              </select>
            </div>
            <div class="space-y-2">
              <Label for="channel-provider-type">Provider</Label>
              <select id="channel-provider-type" v-model="channelFormProviderType" class="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm">
                <option value="local">local</option>
                <option value="custom-http">custom-http</option>
                <option value="platform-upstream">platform-upstream</option>
              </select>
            </div>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label for="channel-sort-order">排序</Label>
              <Input id="channel-sort-order" v-model="channelFormSortOrder" class="h-11 rounded-xl" />
            </div>
            <div class="space-y-2">
              <Label for="channel-active">状态</Label>
              <select id="channel-active" v-model="channelFormIsActive" class="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm">
                <option :value="true">启用</option>
                <option :value="false">停用</option>
              </select>
            </div>
          </div>
          <label class="flex items-center gap-3 text-sm text-gray-700">
            <input v-model="channelFormAllowFallback" type="checkbox" class="rounded border-gray-300" />
            允许回退到 common 渠道
          </label>
        </div>
        <div class="flex justify-end gap-3 pt-4">
          <Button variant="outline" class="rounded-xl" @click="channelDialogOpen = false">取消</Button>
          <Button class="rounded-xl bg-black hover:bg-gray-800 text-white" @click="saveChannel">保存</Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
