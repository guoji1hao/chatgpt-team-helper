# 本地 Docker Desktop 使用说明

这份文档面向**只在本机使用**的场景。

目标效果：
- 一条命令启动
- 只访问 `http://localhost:5173`
- 前端和后端都跑在 Docker 容器里
- SQLite 数据持久化在宿主机 `./data` 目录

## 一、前置条件

请先确认：
- 已安装并启动 Docker Desktop
- 当前项目根目录为仓库根目录
- 本机没有其他程序长期占用 `5173` 端口

## 二、首次准备

### 1. 创建后端环境文件

在项目根目录执行：

```bash
cp backend/.env.example backend/.env
```

Windows PowerShell 也可以直接手动复制文件。

### 2. 至少修改两个值

编辑 `backend/.env`，至少设置：

```env
JWT_SECRET=替换成你自己的强随机字符串
AUTO_BOARDING_API_KEY=替换成你自己的长随机字符串
```

其余配置都可以先保留默认值。

### 3. 可选配置

如果你需要以下能力，再继续补充：
- Telegram 机器人
- SMTP 邮件
- 代理池
- 超员扫描参数
- Turnstile

如果只是本地先跑后台和兑换功能，可以先不配这些可选项。

## 三、启动

在项目根目录执行：

```bash
docker compose up --build
```

如果你希望后台运行：

```bash
docker compose up --build -d
```

## 四、访问地址

启动成功后，浏览器访问：

```text
http://localhost:5173
```

常用入口：
- 登录页：`http://localhost:5173/login`
- 通用兑换页：`http://localhost:5173/redeem/common`
- 健康检查：`http://localhost:5173/api/health`
- 运行时配置：`http://localhost:5173/api/config/runtime`

## 五、默认管理员账号

容器首次启动时，如果数据库是新建的，系统会自动创建管理员：

- 用户名：`admin`
- 密码：容器日志里会打印一份随机密码

查看日志：

```bash
docker compose logs app
```

你会看到类似：

```text
默认管理员用户已创建: username=admin
初始密码(随机生成): xxxxxxxxxxxxxxxx
```

登录后请尽快修改密码。

## 六、数据持久化

本地 Docker 方案默认把 SQLite 数据库存到宿主机：

```text
./data/database.sqlite
```

这意味着：
- `docker compose down` 后数据不会丢
- 重启容器后数据还在
- 如果你想彻底重置本地数据，需要手动删除 `data` 目录中的数据库文件

## 七、停止与重启

### 停止容器

```bash
docker compose down
```

### 重新启动

```bash
docker compose up -d
```

### 代码更新后重建

```bash
docker compose up --build -d
```

## 八、常用排查命令

### 查看容器状态

```bash
docker compose ps
```

### 查看日志

```bash
docker compose logs -f app
```

### 查看健康状态

```bash
docker compose ps
```

如果 `STATUS` 里出现 `healthy`，说明容器内的前端入口和 `/api/health` 已通过检查。

## 九、常见问题

### 1. 打开 `http://localhost:5173` 看到的不是容器页面

通常是你本机还有别的程序占用了 `5173`，比如本地 Vite dev server。

排查方式：
- 先停掉本机的前端开发服务器
- 再执行：
  ```bash
  docker compose up -d
  ```

### 2. 容器启动了，但 API 不通

先检查：

```bash
docker compose logs app
```

重点看：
- backend 是否成功启动
- `JWT_SECRET` 是否配置
- 是否有数据库路径或权限错误

### 3. 登录失败

如果是新数据库，先去日志里找自动生成的 admin 密码。

如果你以前已经使用过本地数据库，那么登录失败很可能是因为旧密码已变更，而不是系统坏了。

### 4. Telegram 没反应

这是正常的，如果你没有配置：

```env
TELEGRAM_BOT_TOKEN=
```

机器人会跳过启动，不影响本地后台和前端使用。

## 十、推荐本地使用流程

第一次：
1. 复制 `backend/.env.example` 为 `backend/.env`
2. 配 `JWT_SECRET` 和 `AUTO_BOARDING_API_KEY`
3. 执行 `docker compose up --build`
4. 打开 `http://localhost:5173`
5. 用日志里的 admin 密码登录
6. 登录后立刻修改 admin 密码

之后日常使用：
1. `docker compose up -d`
2. 打开 `http://localhost:5173`
3. 用完后 `docker compose down`

这就是当前项目最简单的本地使用方式。
