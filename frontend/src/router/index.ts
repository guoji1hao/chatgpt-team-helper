import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import RedeemView from '../views/RedeemView.vue'
import GenericRedeemView from '../views/GenericRedeemView.vue'
import MainLayout from '../views/MainLayout.vue'
import AccountsView from '../views/AccountsView.vue'
import UserManagementView from '../views/UserManagementView.vue'
import SettingsView from '../views/SettingsView.vue'
import RedemptionCodesView from '../views/RedemptionCodesView.vue'
import StatsView from '../views/StatsView.vue'
import UserInfoView from '../views/UserInfoView.vue'
import { authService } from '@/services/api'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/login',
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
    },
    {
      path: '/redeem/common',
      name: 'redeem',
      component: RedeemView,
    },
    {
      path: '/redeem/:channelKey',
      name: 'generic-redeem',
      component: GenericRedeemView,
    },
    {
      path: '/admin',
      component: MainLayout,
      meta: { requiresAuth: true },
      redirect: () => {
        const currentUser = authService.getCurrentUser()
        const roles = Array.isArray(currentUser?.roles) ? currentUser.roles.map(String) : []
        return roles.includes('super_admin') ? '/admin/accounts' : '/admin/user-info'
      },
      children: [
        {
          path: 'user-info',
          name: 'user-info',
          component: UserInfoView,
          meta: { requiredMenuKey: 'user_info' },
        },
        {
          path: 'accounts',
          name: 'accounts',
          component: AccountsView,
          meta: { requiredMenuKey: 'accounts' },
        },
        {
          path: 'stats',
          name: 'stats',
          component: StatsView,
          meta: { requiredMenuKey: 'stats', superAdminOnly: true },
        },
        {
          path: 'users',
          name: 'user-management',
          component: UserManagementView,
          meta: { requiredMenuKey: 'user_management' },
        },
        {
          path: 'redemption-codes',
          name: 'redemption-codes',
          component: RedemptionCodesView,
          meta: { requiredMenuKey: 'redemption_codes' },
        },
        {
          path: 'settings',
          name: 'settings',
          component: SettingsView,
          meta: { requiredMenuKey: 'settings' },
        },
      ],
    },
  ],
})

router.beforeEach((to, from, next) => {
  const isAuthenticated = authService.isAuthenticated()
  const currentUser = authService.getCurrentUser()
  const roles = Array.isArray(currentUser?.roles) ? currentUser.roles.map(String) : []
  const menus = Array.isArray(currentUser?.menus) ? currentUser.menus.map(String) : []
  const isSuperAdmin = roles.includes('super_admin')
  const defaultAdminPath = isSuperAdmin ? '/admin/accounts' : '/admin/user-info'

  if (to.meta.requiresAuth && !isAuthenticated) {
    next('/login')
    return
  }

  if (to.path === '/login' && isAuthenticated) {
    next(defaultAdminPath)
    return
  }

  const superAdminOnly = Boolean((to.meta as any)?.superAdminOnly)
  if (to.meta.requiresAuth && superAdminOnly && !isSuperAdmin) {
    next(defaultAdminPath)
    return
  }

  const requiredMenuKey = String((to.meta as any)?.requiredMenuKey || '').trim()
  if (to.meta.requiresAuth && requiredMenuKey) {
    const alwaysAllowed = requiredMenuKey === 'user_info'
    if (!isSuperAdmin && !alwaysAllowed && !menus.includes(requiredMenuKey)) {
      next(defaultAdminPath)
      return
    }
  }

  next()
})

export default router
