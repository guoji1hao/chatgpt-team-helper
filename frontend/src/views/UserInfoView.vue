<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { authService, userService } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { Lock, UserRound } from 'lucide-vue-next'

const router = useRouter()
const currentUser = ref(authService.getCurrentUser())
const usernameDraft = ref('')
const usernameLoading = ref(false)
const usernameError = ref('')
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordLoading = ref(false)
const passwordError = ref('')

const { success: showSuccessToast, error: showErrorToast } = useToast()

const syncCurrentUser = () => {
  currentUser.value = authService.getCurrentUser()
}

const updateUsername = async () => {
  usernameError.value = ''
  const next = usernameDraft.value.trim()
  if (!next) {
    usernameError.value = '请输入用户名'
    showErrorToast(usernameError.value)
    return
  }
  if (next.length > 64) {
    usernameError.value = '用户名过长'
    showErrorToast(usernameError.value)
    return
  }
  if (String(currentUser.value?.username || '').trim() === next) {
    showSuccessToast('用户名未变化')
    return
  }

  usernameLoading.value = true
  try {
    const result = await userService.updateUsername(next)
    if (result?.user) {
      authService.setCurrentUser(result.user)
      currentUser.value = result.user
    }
    showSuccessToast(result?.message || '用户名已更新')
  } catch (err: any) {
    usernameError.value = err.response?.data?.error || '修改用户名失败'
    showErrorToast(usernameError.value)
  } finally {
    usernameLoading.value = false
  }
}

const updatePassword = async () => {
  passwordError.value = ''
  if (!currentPassword.value || !newPassword.value || !confirmPassword.value) {
    passwordError.value = '请填写所有字段'
    showErrorToast(passwordError.value)
    return
  }
  if (newPassword.value.length < 6) {
    passwordError.value = '新密码至少需要 6 个字符'
    showErrorToast(passwordError.value)
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = '两次输入的密码不一致'
    showErrorToast(passwordError.value)
    return
  }

  passwordLoading.value = true
  try {
    await userService.changePassword(currentPassword.value, newPassword.value)
    showSuccessToast('密码已更新')
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (err: any) {
    passwordError.value = err.response?.data?.error || '修改密码失败'
    showErrorToast(passwordError.value)
  } finally {
    passwordLoading.value = false
  }
}

onMounted(async () => {
  window.addEventListener('auth-updated', syncCurrentUser)
  usernameDraft.value = String(currentUser.value?.username || '').trim()

  try {
    const me = await userService.getMe()
    authService.setCurrentUser(me)
    currentUser.value = me
    usernameDraft.value = String(me?.username || '').trim()
  } catch (error: any) {
    if (error?.response?.status === 401 || error?.response?.status === 403) {
      authService.logout()
      router.push('/login')
    }
  }
})

onUnmounted(() => {
  window.removeEventListener('auth-updated', syncCurrentUser)
})
</script>

<template>
  <div class="grid gap-8 lg:grid-cols-2">
    <Card class="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden">
      <CardHeader class="border-b border-gray-50 bg-gray-50/30 px-8 py-6">
        <CardTitle class="text-xl font-bold text-gray-900">个人资料</CardTitle>
        <CardDescription class="text-gray-500">查看当前账号信息并修改显示名称。</CardDescription>
      </CardHeader>
      <CardContent class="p-8 space-y-6">
        <div class="rounded-2xl border border-gray-100 bg-gray-50/40 px-5 py-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <UserRound class="w-5 h-5" />
            </div>
            <div>
              <div class="text-sm font-semibold text-gray-900">当前账号</div>
              <div class="text-xs text-gray-500">{{ currentUser?.email || '-' }}</div>
            </div>
          </div>
        </div>

        <div class="space-y-2">
          <Label for="username">用户名</Label>
          <Input id="username" v-model="usernameDraft" class="h-11 rounded-xl" />
          <p v-if="usernameError" class="text-sm text-red-600">{{ usernameError }}</p>
        </div>

        <Button class="h-11 rounded-xl bg-black hover:bg-gray-800 text-white" :disabled="usernameLoading" @click="updateUsername">
          {{ usernameLoading ? '保存中...' : '保存用户名' }}
        </Button>
      </CardContent>
    </Card>

    <Card class="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden">
      <CardHeader class="border-b border-gray-50 bg-gray-50/30 px-8 py-6">
        <CardTitle class="text-xl font-bold text-gray-900">修改密码</CardTitle>
        <CardDescription class="text-gray-500">更新后台登录密码。</CardDescription>
      </CardHeader>
      <CardContent class="p-8 space-y-4">
        <div class="rounded-2xl border border-gray-100 bg-gray-50/40 px-5 py-4 flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <Lock class="w-5 h-5" />
          </div>
          <div>
            <div class="text-sm font-semibold text-gray-900">安全设置</div>
            <div class="text-xs text-gray-500">密码至少 6 位，建议使用强密码。</div>
          </div>
        </div>

        <div class="space-y-2">
          <Label for="current-password">当前密码</Label>
          <Input id="current-password" v-model="currentPassword" type="password" class="h-11 rounded-xl" />
        </div>

        <div class="space-y-2">
          <Label for="new-password">新密码</Label>
          <Input id="new-password" v-model="newPassword" type="password" class="h-11 rounded-xl" />
        </div>

        <div class="space-y-2">
          <Label for="confirm-password">确认新密码</Label>
          <Input id="confirm-password" v-model="confirmPassword" type="password" class="h-11 rounded-xl" />
          <p v-if="passwordError" class="text-sm text-red-600">{{ passwordError }}</p>
        </div>

        <Button class="h-11 rounded-xl bg-black hover:bg-gray-800 text-white" :disabled="passwordLoading" @click="updatePassword">
          {{ passwordLoading ? '更新中...' : '更新密码' }}
        </Button>
      </CardContent>
    </Card>
  </div>
</template>
