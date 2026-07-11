# danmu_API Docker 部署文档

本文说明如何在 **macOS + Docker Desktop** 上以生产风格部署本项目（智能弹幕聚合与清洗服务）。

当前推荐方式：**Docker Compose 本地部署**（非云函数）。

---

## 1. 环境要求

| 项目 | 要求 |
|------|------|
| 操作系统 | macOS（Windows / Linux 同样适用 Compose） |
| Docker Desktop | 已安装并处于运行状态 |
| Docker Compose | v2+（Docker Desktop 自带） |
| 端口 | 默认宿主机 **9321**（可改） |
| 数据库 | **不需要**（无关系型数据库） |
| 前端构建 | **不需要**（Web 管理面板内嵌于服务） |

检查 Docker：

```bash
docker version
docker compose version
docker info
```

---

## 2. 项目结构中与部署相关的文件

```text
.
├── Dockerfile                 # 镜像构建
├── docker-compose.yml         # 编排与持久化
├── .env                       # Compose 用环境变量（TOKEN/端口等）
├── config/
│   ├── .env                   # 业务配置（容器内热加载）
│   ├── .env.example           # 配置模板
│   └── danmaku-filter-rules.json  # Web 保存的规则（运行后生成）
├── .cache/                    # 缓存持久化目录
└── logs/                      # 预留日志目录（应用主日志走 docker logs）
```

### 持久化说明

| 宿主机路径 | 容器路径 | 用途 |
|------------|----------|------|
| `./config` | `/app/config` | `.env`、弹幕规则 JSON |
| `./.cache` | `/app/.cache` | 搜索/弹幕/元数据缓存 |

**重启 Docker Desktop 或重建容器后，挂载目录中的数据会保留。**

---

## 3. 环境变量说明

### 3.1 根目录 `.env`（Compose 读取）

| 变量 | 默认 | 说明 |
|------|------|------|
| `TOKEN` | `87654321` | API / Web 访问令牌 |
| `DANMU_API_PORT` | `9321` | 容器内监听端口 |
| `HOST_PORT` | `9321` | 映射到本机的端口 |
| `LOG_LEVEL` | `info` | 日志级别：`error` / `warn` / `info` / `debug` |
| `TZ` | `Asia/Shanghai` | 容器时区 |

### 3.2 `config/.env`（业务配置）

完整项见 `config/.env.example`。常用项：

| 变量 | 说明 |
|------|------|
| `TOKEN` | API 令牌 |
| `ADMIN_TOKEN` | 系统管理令牌（可选；未配置时用当前 TOKEN 写规则） |
| `SOURCE_ORDER` | 采集源顺序 |
| `DANMAKU_FILTER_RULES` | 规则 JSON 默认覆盖（可选） |
| `DANMAKU_RULES_PATH` | 规则文件路径，默认 `config/danmaku-filter-rules.json` |
| `UPSTASH_REDIS_*` / `LOCAL_REDIS_URL` | 可选 Redis 缓存 |

优先级：**容器环境变量 > `config/.env` 文件**。

### 3.3 无需配置数据库

本项目无 MySQL/PostgreSQL。运行期状态：

- 规则：文件持久化（`config/danmaku-filter-rules.json`）
- 缓存：内存 + 可选 Redis + `.cache` 目录
- 统计：进程内存（重启清空）

---

## 4. 启动命令

在项目根目录执行：

```bash
# 1）确保目录存在
mkdir -p config .cache logs

# 2）如无 config/.env，从示例复制
cp -n config/.env.example config/.env

# 3）构建镜像
docker compose build

# 4）后台启动
docker compose up -d

# 5）查看状态
docker ps
docker compose ps
docker compose logs -f
```

### 访问地址

| 用途 | URL |
|------|-----|
| Web 管理面板 | http://127.0.0.1:9321/87654321 |
| 或（默认 TOKEN 时） | http://127.0.0.1:9321/ |
| 弹幕处理页 | 打开面板后点「弹幕处理」 |
| API 示例 | http://127.0.0.1:9321/87654321/api/rules |

将 `87654321` 换成你的 `TOKEN`。

Docker Desktop 中应能看到容器 **`danmu-api`**，状态 **Up (healthy)**。

---

## 5. 停止命令

```bash
# 停止并移除容器（保留镜像与挂载数据）
docker compose down

# 仅停止
docker compose stop

# 再次启动
docker compose start
# 或
docker compose up -d
```

---

## 6. 更新方法

代码或依赖变更后：

```bash
cd /path/to/danmu_api-main

# 拉取/更新代码后
docker compose build --no-cache   # 可选：完全重建
docker compose up -d

# 查看是否 healthy
docker ps --filter name=danmu-api
docker compose logs --tail=100
```

仅改 `config/.env`：容器会热加载（日志出现 reloading），一般**无需重建镜像**。

仅改 Web 规则：通过面板「保存规则」，写入 `config/danmaku-filter-rules.json`，自动持久化。

---

## 7. 数据备份方法

建议定期备份以下路径：

```bash
# 备份配置与规则
tar -czf danmu-backup-$(date +%Y%m%d).tar.gz config .env

# 如需一并备份缓存
tar -czf danmu-full-backup-$(date +%Y%m%d).tar.gz config .env .cache
```

恢复：

```bash
# 停止服务
docker compose down

# 解压覆盖 config / .env / .cache
tar -xzf danmu-backup-YYYYMMDD.tar.gz

# 启动
docker compose up -d
```

规则文件单独备份：

```bash
cp config/danmaku-filter-rules.json ~/Desktop/danmaku-filter-rules.json.bak
```

---

## 8. 核心 API 自检

```bash
TOKEN=87654321
BASE="http://127.0.0.1:9321/${TOKEN}"

# 规则
curl -sS "$BASE/api/rules" | head

# 合并清洗
curl -sS -X POST "$BASE/api/danmaku/merge" \
  -H 'content-type: application/json' \
  -d '{"sources":[{"source":"t","data":[{"time":1,"content":"测试弹幕"}]}]}'

# 过滤
curl -sS -X POST "$BASE/api/danmaku/filter" \
  -H 'content-type: application/json' \
  -d '{"comments":[{"time":1,"content":"测试"}]}'

# 统计
curl -sS "$BASE/api/statistics"
```

---

## 9. 常见错误处理

### 9.1 端口被占用

错误示例：`Bind for 0.0.0.0:9321 failed: port is already allocated`

处理：修改根目录 `.env`：

```env
HOST_PORT=9322
```

然后：

```bash
docker compose up -d
```

访问 http://127.0.0.1:9322/...

### 9.2 容器反复重启 / unhealthy

```bash
docker compose logs --tail=200
docker inspect danmu-api --format='{{json .State.Health}}'
```

常见原因：

- `config/.env` 语法错误
- 镜像未构建成功
- 健康检查前服务尚未监听（等 `start_period` 后应变 healthy）

### 9.3 规则保存后重启丢失

确认卷挂载：

```bash
docker inspect danmu-api --format='{{json .Mounts}}'
ls -la config/
```

应存在：

- `./config` → `/app/config`
- 保存后生成 `config/danmaku-filter-rules.json`

### 9.4 页面 403 / 无法保存规则

- 检查 URL 是否带正确 `TOKEN`
- 若配置了 `ADMIN_TOKEN`，写规则需使用该令牌对应权限

### 9.5 Docker Desktop 未启动

```text
failed to connect to the docker API ... docker.sock
```

先打开 Docker Desktop，菜单显示 **Engine running** 后再执行 compose。

### 9.6 构建失败：依赖 / 网络

```bash
docker compose build --no-cache
# 或配置 Docker 镜像加速后重试
```

### 9.7 查看实时日志

```bash
docker compose logs -f danmu-api
```

日志已做滚动限制（约 20MB × 5 个文件），避免撑满磁盘。

---

## 10. 日常运维速查

```bash
# 状态
docker ps --filter name=danmu-api

# 重启
docker compose restart

# 进入容器排查
docker exec -it danmu-api sh

# 资源占用
docker stats danmu-api --no-stream
```

---

## 11. 本次本地部署验证摘要

| 检查项 | 结果 |
|--------|------|
| `docker compose build` | 成功 |
| `docker compose up -d` | 成功 |
| 容器健康检查 | `healthy` |
| Web 面板 | HTTP 200，含「弹幕处理 / 在线测试」 |
| `GET /api/rules` | 正常 |
| `POST /api/danmaku/merge` | 正常（示例 5→2） |
| `POST /api/danmaku/filter` | 正常 |
| `PUT /api/rules` 持久化 | 写入 `config/danmaku-filter-rules.json` |
| `GET /api/statistics` | 正常 |
| 数据库 | 不需要 |

---

## 12. 快速一键命令（复制即用）

```bash
cd /path/to/danmu_api
mkdir -p config .cache logs
test -f config/.env || cp config/.env.example config/.env
docker compose up -d --build
# 浏览器打开 http://127.0.0.1:9321/YOUR_TOKEN
```
