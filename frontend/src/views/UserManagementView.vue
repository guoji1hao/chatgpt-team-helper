<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { adminService, authService, userService, type RbacRole, type RbacUser } from '@/services/api'
import { formatShanghaiDate } from '@/lib/datetime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { ChevronLeft, ChevronRight, Eye, PencilLine, RefreshCw, Trash2 } from 'lucide-vue-next'

const roles = ref<RbacRole[]>([])
const users = ref<RbacUser[]>([])
const userRoleDrafts = ref<Record<number, string>>({})
const userInviteDrafts = ref<Record<number, boolean>>({})
const roleUpdating = ref<Record<number, boolean>>({})
const inviteUpdating = ref<Record<number, boolean>>({})
const listLoading = ref(false)
const error = ref('')
const search = ref('')
const paginationMeta = ref({ page: 1, pageSize: 10, total: 0 })
const totalPages = computed(() => Math.max(1, Math.ceil(paginationMeta.value.total / paginationMeta.value.pageSize)))

const { success: showSuccessToast, error: showErrorToast } = useToast()
const currentUserId = computed(() => Number(authService.getCurrentUser()?.id) || 0)
const isCurrentUser = (userId: number) => currentUserId.value !== 0 && currentUserId.value === userId

const loadRoles = async () => {
  const rolesRes = await adminService.getRoles()
  roles.value = rolesRes.roles || []
}

const loadUsers = async () => {
  error.value = ''
  listLoading.value = true
  try {
    const response = await adminService.getUsers({
      page: paginationMeta.value.page,
      pageSize: paginationMeta.value.pageSize,
      search: search.value.trim() || undefined,
    })
    users.value = response.users || []
    paginationMeta.value = response.pagination || paginationMeta.value
    userRoleDrafts.value = Object.fromEntries((users.value || []).map(user => [user.id, user.roles?.[0]?.roleKey || '']))
    userInviteDrafts.value = Object.fromEntries((users.value || []).map(user => [user.id, Boolean(user.inviteEnabled)]))
  } catch (err: any) {
    error.value = err.response?.data?.error || '加载用户数据失败'
  } finally {
    listLoading.value = false
  }
}

const loadData = async () => {
  await loadRoles()
  await loadUsers()
}

const goToPage = (page: number) => {
  if (page < 1 || page > totalPages.value || page === paginationMeta.value.page) return
  paginationMeta.value.page = page
  loadUsers()
}

const handleSearch = () => {
  paginationMeta.value.page = 1
  loadUsers()
}

const setRoleUpdating = (userId: number, value: boolean) => {
  roleUpdating.value = { ...roleUpdating.value, [userId]: value }
}

const setInviteUpdating = (userId: number, value: boolean) => {
  inviteUpdating.value = { ...inviteUpdating.value, [userId]: value }
}

const handleRoleChange = async (user: RbacUser) => {
  if (!user?.id) return
  error.value = ''

  if (isCurrentUser(user.id)) {
    userRoleDrafts.value[user.id] = String(user.roles?.[0]?.roleKey || '')
    showErrorToast('超级管理员不能修改自己的角色')
    return
  }

  const nextRoleKey = String(userRoleDrafts.value[user.id] || '').trim()
  const previousRoleKey = String(user.roles?.[0]?.roleKey || '')
  if (!nextRoleKey || nextRoleKey === previousRoleKey) return

  setRoleUpdating(user.id, true)
  try {
    await adminService.setUserRoles(user.id, [nextRoleKey])
    const role = roles.value.find(r => r.roleKey === nextRoleKey)
    user.roles = role ? [{ roleKey: role.roleKey, roleName: role.roleName }] : [{ roleKey: nextRoleKey, roleName: nextRoleKey }]

    const currentUser = authService.getCurrentUser()
    if (Number(currentUser?.id) === user.id) {
      const me = await userService.getMe()
      authService.setCurrentUser(me)
    }

    showSuccessToast('角色已更新')
  } catch (err: any) {
    userRoleDrafts.value[user.id] = previousRoleKey
    const message = err.response?.data?.error || '更新用户角色失败'
    error.value = message
    showErrorToast(message)
  } finally {
    setRoleUpdating(user.id, false)
  }
}

const handleInviteEnabledChange = async (user: RbacUser) => {
  if (!user?.id) return
  error.value = ''
  const next = Boolean(userInviteDrafts.value[user.id])
  const previous = Boolean(user.inviteEnabled)
  if (next === previous) return

  setInviteUpdating(user.id, true)
  try {
    const response = await adminService.updateUser(user.id, { inviteEnabled: next })
    const updated = response.user
    const idx = users.value.findIndex(u => u.id === updated.id)
    if (idx !== -1) {
      users.value[idx] = { ...users.value[idx], ...updated }
      userRoleDrafts.value[updated.id] = updated.roles?.[0]?.roleKey || ''
      userInviteDrafts.value[updated.id] = Boolean(updated.inviteEnabled)
    }

    if (Number(authService.getCurrentUser()?.id) === user.id) {
      const me = await userService.getMe()
      authService.setCurrentUser(me)
    }

    showSuccessToast('邀请权限已更新')
  } catch (err: any) {
    userInviteDrafts.value[user.id] = previous
    const message = err.response?.data?.error || '更新邀请权限失败'
    error.value = message
    showErrorToast(message)
  } finally {
    setInviteUpdating(user.id, false)
  }
}

const editDialogOpen = ref(false)
const editingUser = ref<RbacUser | null>(null)
const editUsername = ref('')
const editEmail = ref('')
const editInviteEnabled = ref(true)
const editLoading = ref(false)

const openEditDialog = (user: RbacUser) => {
  editingUser.value = user
  editUsername.value = user.username
  editEmail.value = user.email
  editInviteEnabled.value = Boolean(user.inviteEnabled)
  editDialogOpen.value = true
}

const closeEditDialog = () => {
  editDialogOpen.value = false
  editingUser.value = null
  editUsername.value = ''
  editEmail.value = ''
  editInviteEnabled.value = true
}

const saveUserEdits = async () => {
  if (!editingUser.value) return
  error.value = ''
  editLoading.value = true

  try {
    const response = await adminService.updateUser(editingUser.value.id, {
      username: editUsername.value.trim(),
      email: editEmail.value.trim(),
      inviteEnabled: editInviteEnabled.value,
    })
    const updated = response.user
    const idx = users.value.findIndex(u => u.id === updated.id)
    if (idx !== -1) {
      users.value[idx] = { ...users.value[idx], ...updated }
      userRoleDrafts.value[updated.id] = updated.roles?.[0]?.roleKey || ''
      userInviteDrafts.value[updated.id] = Boolean(updated.inviteEnabled)
    }

    if (Number(authService.getCurrentUser()?.id) === updated.id) {
      const me = await userService.getMe()
      authService.setCurrentUser(me)
    }

    showSuccessToast('用户信息已更新')
    closeEditDialog()
  } catch (err: any) {
    const message = err.response?.data?.error || '更新用户失败'
    error.value = message
    showErrorToast(message)
  } finally {
    editLoading.value = false
  }
}

const deleteDialogOpen = ref(false)
const deletingUser = ref<RbacUser | null>(null)
const deleteLoading = ref(false)

const openDeleteDialog = (user: RbacUser) => {
  deletingUser.value = user
  deleteDialogOpen.value = true
}

const closeDeleteDialog = () => {
  deleteDialogOpen.value = false
  deletingUser.value = null
}

const confirmDeleteUser = async () => {
  if (!deletingUser.value) return
  error.value = ''
  deleteLoading.value = true
  try {
    await adminService.deleteUser(deletingUser.value.id)
    showSuccessToast('用户已删除')
    closeDeleteDialog()
    await loadUsers()
  } catch (err: any) {
    const message = err.response?.data?.error || '删除用户失败'
    error.value = message
    showErrorToast(message)
  } finally {
    deleteLoading.value = false
  }
}

const detailDialogOpen = ref(false)
const detailUser = ref<RbacUser | null>(null)
const openDetailDialog = (user: RbacUser) => {
  detailUser.value = user
  detailDialogOpen.value = true
}
const closeDetailDialog = () => {
  detailDialogOpen.value = false
  detailUser.value = null
}

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">用户管理</h1>
        <p class="text-sm text-gray-500">管理后台用户、角色和邀请开关。</p>
      </div>
      <div class="flex gap-3">
        <Input v-model="search" placeholder="搜索用户名 / 邮箱 / 邀请码" class="h-11 w-[280px] rounded-xl" @keyup.enter="handleSearch" />
        <Button variant="outline" class="h-11 rounded-xl" @click="handleSearch">搜索</Button>
        <Button variant="outline" class="h-11 rounded-xl" :disabled="listLoading" @click="loadData">
          <RefreshCw class="mr-2 h-4 w-4" :class="listLoading ? 'animate-spin' : ''" />
          刷新
        </Button>
      </div>
    </div>

    <div v-if="error" class="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">
      {{ error }}
    </div>

    <div class="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-100">
          <thead class="bg-gray-50/70">
            <tr>
              <th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">用户</th>
              <th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">邀请码</th>
              <th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">邀请功能</th>
              <th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">角色</th>
              <th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">创建时间</th>
              <th class="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-if="listLoading">
              <td colspan="6" class="px-6 py-10 text-center text-sm text-gray-500">加载中...</td>
            </tr>
            <tr v-else-if="users.length === 0">
              <td colspan="6" class="px-6 py-10 text-center text-sm text-gray-500">暂无用户</td>
            </tr>
            <tr v-for="user in users" :key="user.id" class="hover:bg-gray-50/60 transition-colors">
              <td class="px-6 py-5">
                <div class="cursor-pointer" @click="openDetailDialog(user)">
                  <div class="text-sm font-medium text-gray-900">{{ user.username }}</div>
                  <div class="text-xs text-gray-500">{{ user.email }}</div>
                </div>
              </td>
              <td class="px-6 py-5 text-sm font-mono text-gray-600">{{ user.inviteCode || '-' }}</td>
              <td class="px-6 py-5">
                <select
                  v-model="userInviteDrafts[user.id]"
                  :disabled="inviteUpdating[user.id]"
                  class="h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  @change="handleInviteEnabledChange(user)"
                >
                  <option :value="true">开启</option>
                  <option :value="false">关闭</option>
                </select>
              </td>
              <td class="px-6 py-5">
                <select
                  v-model="userRoleDrafts[user.id]"
                  :disabled="roleUpdating[user.id] || isCurrentUser(user.id)"
                  class="h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  :title="isCurrentUser(user.id) ? '超级管理员不能修改自己的角色' : undefined"
                  @change="handleRoleChange(user)"
                >
                  <option value="" disabled>选择角色</option>
                  <option v-for="role in roles" :key="role.id" :value="role.roleKey">
                    {{ role.roleName }} ({{ role.roleKey }})
                  </option>
                </select>
              </td>
              <td class="px-6 py-5 text-sm text-gray-500">{{ formatShanghaiDate(user.createdAt) }}</td>
              <td class="px-6 py-5 text-right">
                <div class="flex items-center justify-end gap-2">
                  <Button type="button" variant="outline" size="icon-sm" class="rounded-xl border-gray-200 bg-white text-gray-600" @click="openDetailDialog(user)">
                    <Eye class="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon-sm" class="rounded-xl border-gray-200 bg-white text-gray-600" @click="openEditDialog(user)">
                    <PencilLine class="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon-sm" class="rounded-xl border-red-200 bg-white text-red-600 hover:bg-red-50" @click="openDeleteDialog(user)">
                    <Trash2 class="h-4 w-4" />
                  </Button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!listLoading" class="flex items-center justify-between border-t border-gray-100 px-6 py-4 text-sm text-gray-500 bg-gray-50/30">
        <p>第 {{ paginationMeta.page }} / {{ totalPages }} 页，共 {{ paginationMeta.total }} 个用户</p>
        <div class="flex items-center gap-2">
          <Button size="icon-sm" variant="outline" class="rounded-lg border-gray-200" :disabled="paginationMeta.page === 1" @click="goToPage(paginationMeta.page - 1)">
            <ChevronLeft class="h-4 w-4" />
          </Button>
          <Button size="icon-sm" variant="outline" class="rounded-lg border-gray-200" :disabled="paginationMeta.page >= totalPages" @click="goToPage(paginationMeta.page + 1)">
            <ChevronRight class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>

    <Dialog v-model:open="detailDialogOpen" @update:open="(open) => { if (!open) closeDetailDialog() }">
      <DialogContent class="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>用户信息</DialogTitle>
          <DialogDescription>查看用户基础资料与角色。</DialogDescription>
        </DialogHeader>
        <div v-if="detailUser" class="space-y-4 text-sm">
          <div class="flex items-center justify-between"><span class="text-gray-500">ID</span><span class="font-medium">#{{ detailUser.id }}</span></div>
          <div class="flex items-center justify-between"><span class="text-gray-500">用户名</span><span class="font-medium">{{ detailUser.username }}</span></div>
          <div class="flex items-center justify-between"><span class="text-gray-500">邮箱</span><span class="font-medium">{{ detailUser.email }}</span></div>
          <div class="flex items-center justify-between"><span class="text-gray-500">邀请码</span><span class="font-mono">{{ detailUser.inviteCode || '-' }}</span></div>
          <div class="flex items-center justify-between"><span class="text-gray-500">邀请功能</span><span class="font-medium">{{ detailUser.inviteEnabled ? '已开启' : '已关闭' }}</span></div>
          <div class="flex items-center justify-between"><span class="text-gray-500">角色</span><span class="font-medium">{{ detailUser.roles.map(role => role.roleName).join(' / ') || '-' }}</span></div>
          <div class="flex items-center justify-between"><span class="text-gray-500">创建时间</span><span class="font-medium">{{ formatShanghaiDate(detailUser.createdAt) }}</span></div>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="editDialogOpen" @update:open="(open) => { if (!open) closeEditDialog() }">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑用户</DialogTitle>
          <DialogDescription>修改用户名、邮箱和邀请开关。</DialogDescription>
        </DialogHeader>
        <div class="space-y-4">
          <div class="space-y-2">
            <Label for="edit-username">用户名</Label>
            <Input id="edit-username" v-model="editUsername" class="h-11 rounded-xl" />
          </div>
          <div class="space-y-2">
            <Label for="edit-email">邮箱</Label>
            <Input id="edit-email" v-model="editEmail" class="h-11 rounded-xl" />
          </div>
          <div class="space-y-2">
            <Label for="edit-invite">邀请功能</Label>
            <select id="edit-invite" v-model="editInviteEnabled" class="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-100">
              <option :value="true">开启</option>
              <option :value="false">关闭</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" class="rounded-xl" @click="closeEditDialog">取消</Button>
          <Button class="rounded-xl bg-black hover:bg-gray-800 text-white" :disabled="editLoading" @click="saveUserEdits">
            {{ editLoading ? '保存中...' : '保存' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="deleteDialogOpen" @update:open="(open) => { if (!open) closeDeleteDialog() }">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除用户</DialogTitle>
          <DialogDescription>此操作不可撤销，请确认是否继续。</DialogDescription>
        </DialogHeader>
        <p class="text-sm text-gray-600">即将删除用户：{{ deletingUser?.username }}（{{ deletingUser?.email }}）</p>
        <DialogFooter>
          <Button variant="outline" class="rounded-xl" @click="closeDeleteDialog">取消</Button>
          <Button class="rounded-xl bg-red-600 hover:bg-red-700 text-white" :disabled="deleteLoading" @click="confirmDeleteUser">
            {{ deleteLoading ? '删除中...' : '确认删除' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
