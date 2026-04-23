<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { authService, userService } from '@/services/api'
import { filterAdminMenuTreeByFeatureFlags, getFallbackAdminMenuTree, type AdminMenuNode } from '@/lib/adminMenus'
import { Menu, X, LogOut, ChevronRight, Github } from 'lucide-vue-next'
import { useBreakpoints } from '@vueuse/core'
import { useAppConfigStore } from '@/stores/appConfig'

const router = useRouter()
const route = useRoute()
const appConfigStore = useAppConfigStore()
const currentUser = ref(authService.getCurrentUser())
const githubRepoUrl = 'https://github.com/guoji1hao/chatgpt-team-helper'

const syncCurrentUser = () => {
  currentUser.value = authService.getCurrentUser()
}

onMounted(() => {
  window.addEventListener('auth-updated', syncCurrentUser)
  ;(async () => {
    try {
      const me = await userService.getMe()
      authService.setCurrentUser(me)
    } catch (error: any) {
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        authService.logout()
        router.push('/login')
      }
    }
  })()
})

const menuTree = computed<AdminMenuNode[]>(() => {
  const user: any = currentUser.value
  const resolved = getFallbackAdminMenuTree(user?.menus, user?.roles)
  return filterAdminMenuTreeByFeatureFlags(resolved)
})

const findLabelByPath = (nodes: AdminMenuNode[], path: string): string | null => {
  for (const node of nodes) {
    if (node.path && node.path === path) return node.label
    if (node.children?.length) {
      const child = findLabelByPath(node.children, path)
      if (child) return child
    }
  }
  return null
}

const currentPageLabel = computed(() => findLabelByPath(menuTree.value, route.path) || 'Console')
const roleLabel = computed(() => {
  const user = currentUser.value
  const roles = Array.isArray(user?.roles) ? user.roles.map(String) : []
  if (roles.includes('super_admin')) return '超级管理员'
  return roles.length ? roles.join(', ') : '普通用户'
})

const breakpoints = useBreakpoints({ laptop: 1024 })
const isLaptop = breakpoints.greater('laptop')
const isSidebarOpen = ref(isLaptop.value)

const handleMenuClick = () => {
  if (!isLaptop.value) isSidebarOpen.value = false
}

const handleLogout = () => {
  authService.logout()
  router.push('/login')
}

const toggleSidebar = () => {
  isSidebarOpen.value = !isSidebarOpen.value
}

watch(() => route.path, () => {
  if (!isLaptop.value) isSidebarOpen.value = false
})

const isActive = (path: string) => route.path === path
const isNodeActive = (node: AdminMenuNode): boolean => {
  if (node.path && isActive(node.path)) return true
  return Boolean(node.children?.some(isNodeActive))
}

const expandedGroups = ref<Record<string, boolean>>({})

const ensureGroupKeys = (nodes: AdminMenuNode[]) => {
  const next = { ...expandedGroups.value }
  const walk = (list: AdminMenuNode[]) => {
    for (const node of list) {
      if (node.children?.length) {
        if (next[node.key] === undefined) next[node.key] = true
        walk(node.children)
      }
    }
  }
  walk(nodes)
  expandedGroups.value = next
}

const expandActiveGroups = (nodes: AdminMenuNode[]) => {
  const next = { ...expandedGroups.value }
  const walk = (node: AdminMenuNode): boolean => {
    const active = isNodeActive(node)
    if (node.children?.length) {
      const childActive = node.children.some(walk)
      if (active || childActive) next[node.key] = true
      return active || childActive
    }
    return active
  }
  for (const node of nodes) walk(node)
  expandedGroups.value = next
}

watch(menuTree, (nodes) => {
  ensureGroupKeys(nodes)
  expandActiveGroups(nodes)
}, { immediate: true })

watch(() => route.path, () => {
  expandActiveGroups(menuTree.value)
})

const toggleGroup = (key: string) => {
  expandedGroups.value = {
    ...expandedGroups.value,
    [key]: !expandedGroups.value[key],
  }
}

const isGroupExpanded = (key: string) => {
  const value = expandedGroups.value[key]
  return value === undefined ? true : value
}
</script>

<template>
  <div class="relative min-h-screen bg-[#F5F5F7]">
    <div
      v-if="isSidebarOpen"
      class="fixed inset-0 z-30 bg-black/20 backdrop-blur-[2px] lg:hidden"
      @click="isSidebarOpen = false"
    />

    <aside
      class="fixed inset-y-0 left-0 z-40 w-[260px] bg-[#F5F5F7]/95 backdrop-blur-xl border-r border-gray-200/50 flex flex-col transition-transform duration-500 cubic-bezier(0.32, 0.72, 0, 1)"
      :class="isSidebarOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <div class="px-6 pt-10 pb-6">
        <div class="flex min-w-0 items-center gap-3 mb-2">
          <a
            :href="githubRepoUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="w-8 h-8 shrink-0 rounded-lg bg-gradient-to-br from-gray-900 to-gray-700 flex items-center justify-center shadow-lg shadow-black/10 hover:from-gray-800 hover:to-gray-600 transition-colors"
            aria-label="Open GitHub repository"
            title="GitHub"
            @click="handleMenuClick"
          >
            <Github class="w-5 h-5 text-white" />
          </a>
          <router-link
            to="/admin"
            class="block min-w-0 flex-1 truncate whitespace-nowrap text-lg font-semibold tracking-tight leading-none text-gray-900"
            @click="handleMenuClick"
          >
            ChatGPT Team Helper
          </router-link>
        </div>
        <p class="text-xs font-medium text-gray-400 pl-11">Management Console</p>
      </div>

      <nav class="flex-1 px-4 space-y-1 overflow-y-auto py-4">
        <template v-for="item in menuTree" :key="item.key">
          <div v-if="item.children?.length" class="space-y-1">
            <div
              class="relative group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300"
              :class="isNodeActive(item) ? 'bg-white shadow-[0_2px_12px_rgba(0,0,0,0.08)] text-blue-600' : 'text-gray-500 hover:bg-white/60 hover:text-gray-900'"
            >
              <component :is="item.icon" class="w-5 h-5" :class="isNodeActive(item) ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'" :strokeWidth="3" />
              <router-link v-if="item.path" :to="item.path" class="flex-1 font-medium text-[15px]" @click="handleMenuClick">{{ item.label }}</router-link>
              <button v-else type="button" class="flex-1 text-left font-medium text-[15px]" @click="toggleGroup(item.key)">{{ item.label }}</button>
              <button type="button" class="ml-auto p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-200/40 transition" @click.stop="toggleGroup(item.key)">
                <ChevronRight class="w-4 h-4 transition-transform duration-300" :class="isGroupExpanded(item.key) ? 'rotate-90' : ''" />
              </button>
            </div>
            <div v-show="isGroupExpanded(item.key)" class="pl-6 space-y-1">
              <template v-for="child in item.children" :key="child.key">
                <router-link
                  v-if="child.path"
                  :to="child.path"
                  class="relative group flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300"
                  :class="isActive(child.path) ? 'bg-white shadow-[0_2px_12px_rgba(0,0,0,0.08)] text-blue-600' : 'text-gray-500 hover:bg-white/60 hover:text-gray-900'"
                  @click="handleMenuClick"
                >
                  <component :is="child.icon" class="w-5 h-5" :class="isActive(child.path) ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'" :strokeWidth="3" />
                  <span class="font-medium text-[14px]">{{ child.label }}</span>
                </router-link>
              </template>
            </div>
          </div>

          <template v-else>
            <router-link
              :to="item.path"
              class="relative group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300"
              :class="isActive(item.path) ? 'bg-white shadow-[0_2px_12px_rgba(0,0,0,0.08)] text-blue-600' : 'text-gray-500 hover:bg-white/60 hover:text-gray-900'"
              @click="handleMenuClick"
            >
              <component :is="item.icon" class="w-5 h-5" :class="isActive(item.path) ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'" :strokeWidth="3" />
              <span class="font-medium text-[15px]">{{ item.label }}</span>
            </router-link>
          </template>
        </template>
      </nav>

      <div class="px-4 py-5 border-t border-gray-200/60">
        <div class="rounded-2xl bg-white/80 border border-white px-4 py-3 shadow-sm space-y-3">
          <div>
            <p class="text-sm font-semibold text-gray-900 truncate">{{ currentUser?.username || currentUser?.email || 'User' }}</p>
            <p class="text-xs text-gray-500 truncate">{{ roleLabel }}</p>
          </div>
          <Button variant="outline" class="w-full rounded-xl justify-start" @click="handleLogout">
            <LogOut class="w-4 h-4 mr-2" />退出登录
          </Button>
        </div>
      </div>
    </aside>

    <div class="lg:pl-[260px] min-h-screen">
      <header class="sticky top-0 z-20 bg-[#F5F5F7]/90 backdrop-blur-xl border-b border-gray-200/50 px-4 lg:px-8 py-4">
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3 min-w-0">
            <Button variant="outline" size="icon-sm" class="rounded-xl lg:hidden" @click="toggleSidebar">
              <component :is="isSidebarOpen ? X : Menu" class="w-4 h-4" />
            </Button>
            <div class="min-w-0">
              <h1 class="text-lg font-semibold text-gray-900 truncate">{{ currentPageLabel }}</h1>
              <p class="text-xs text-gray-500 truncate">{{ currentUser?.email || '' }}</p>
            </div>
          </div>
          <div id="header-actions" class="flex items-center gap-3"></div>
        </div>
      </header>

      <main class="p-4 lg:p-8">
        <router-view />
      </main>
    </div>
  </div>
</template>
