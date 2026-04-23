import {
  BarChart3,
  Settings,
  Ticket,
  User,
  Users,
} from 'lucide-vue-next'

export interface AdminMenuNode {
  key: string
  label: string
  path: string
  icon: any
  children?: AdminMenuNode[]
}

const ICONS_BY_MENU_KEY: Record<string, any> = {
  stats: BarChart3,
  user_info: User,
  accounts: Users,
  user_management: Users,
  redemption_codes: Ticket,
  settings: Settings,
}

const STATIC_ADMIN_MENU_TREE: AdminMenuNode[] = [
  { key: 'stats', label: '数据统计', path: '/admin/stats', icon: BarChart3 },
  { key: 'accounts', label: '账号管理', path: '/admin/accounts', icon: Users },
  { key: 'redemption_codes', label: '兑换码管理', path: '/admin/redemption-codes', icon: Ticket },
  { key: 'user_management', label: '用户管理', path: '/admin/users', icon: Users },
  { key: 'settings', label: '系统设置', path: '/admin/settings', icon: Settings },
  { key: 'user_info', label: '个人信息', path: '/admin/user-info', icon: User },
]

export const getFallbackAdminMenuTree = (menuKeys?: string[] | null, roleKeys?: string[] | null) => {
  const roles = new Set((roleKeys || []).map(String))
  const isSuperAdmin = roles.has('super_admin')
  const allowed = new Set((menuKeys || []).map(String))
  allowed.add('user_info')

  return STATIC_ADMIN_MENU_TREE.filter(node => isSuperAdmin || allowed.has(node.key))
}

export const normalizeAdminMenuTree = (tree: any[] | null | undefined): AdminMenuNode[] => {
  if (!Array.isArray(tree) || tree.length === 0) return []
  return tree
    .map((node) => {
      const key = String(node?.menuKey ?? node?.key ?? '').trim()
      if (!key) return null
      return {
        key,
        label: String(node?.label ?? '').trim(),
        path: String(node?.path ?? ''),
        icon: ICONS_BY_MENU_KEY[key] || Settings,
      }
    })
    .filter(Boolean) as AdminMenuNode[]
}

export const filterAdminMenuTreeByFeatureFlags = (tree: AdminMenuNode[]) => tree || []

export const getDefaultAdminPath = (_menuKeys?: string[] | null, roleKeys?: string[] | null) => {
  const roles = new Set((roleKeys || []).map(String))
  return roles.has('super_admin') ? '/admin/accounts' : '/admin/user-info'
}
