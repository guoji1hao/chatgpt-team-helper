# Project Workflow Lessons

## 2026-04-23 — 初始化项目协作流程
- 任务：创建项目本地 workflow skill，并初始化 Git 版本管理。
- 有效做法：
  - 项目本地 skill 的标准位置是 `.claude/skills/<skill-name>/SKILL.md`。
  - 可以用 `git init -b main` 直接建立主分支。
  - 将经验沉淀放在 skill 同目录下，后续维护最直接。
- 踩坑：
  - 当前项目最初不是 Git 仓库，Git 查询命令会先失败，需要先初始化。
  - 如果 `.claude/skills/` 是在当前 Claude 会话中第一次创建，Claude Code 可能需要重启后才能立即发现新 skill。
  - 项目的持久记忆索引 `MEMORY.md` 可能不存在，需要首次创建。
- 复用规则：
  - 新项目开始前，优先补齐 Git 和 `.claude/skills/` 基础设施，再进入迭代开发。

## 2026-04-24 — 裁剪 chatgpt-team-helper 到保留功能集
- 任务：将上游项目 fork 到用户仓库并在当前目录接管工作区，只保留账号管理、Telegram 兑换/激活、通用兑换、超员扫描和仪表盘。
- 有效做法：
  - 先收缩 `backend/src/server.js` 和前端 `router/index.ts`，快速切断旧模块入口，再逐步重写保留页和 API 面，能显著降低联动复杂度。
  - 对于大范围删功能，直接删除不再被保留入口引用的页面、组件和 store，比长期维护“空壳兼容层”更稳。
  - 前端先通过 `npm run build --workspace=frontend` 把残留引用逐个清掉，再处理后端和业务逻辑，能更快形成可验证的最小系统。
  - 后端用备用端口做启动检查（如 `PORT=3001 npm run start --workspace=backend`），可以避开本机已有进程占用，确认错误是否真来自代码。
- 踩坑：
  - 目标仓库接管当前目录前，需要先确认提交/推送目标；这次需要先 fork 到用户自己的仓库，不能直接对上游仓库提交。
  - 仅重写 `api.ts` 不够，未被路由引用但仍留在源码树中的旧页面/组件仍会被 TypeScript/Vite 扫到，导致构建失败；需要把这些文件直接删掉或排除。
  - Telegram `/stock` 旧实现依赖购买模块，删掉支付链路后必须改成直接读取保留域库存，而不是继续走 `/purchase/meta`。
  - 超员扫描旧代码依赖 `openAccounts` feature flag，裁掉旧开关后要同步去掉，否则保留任务会被静默跳过。
- 复用规则：
  - 以后做“只保留少数功能”的大裁剪时，优先顺序应是：fork/切库目标确认 → 收缩入口 → 删除未引用旧文件 → 重写最小 API 面 → 构建验证 → 最后再做业务细化和提交。
