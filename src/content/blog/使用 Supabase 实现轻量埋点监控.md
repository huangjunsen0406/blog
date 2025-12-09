---
title: 使用 Supabase 实现轻量埋点监控
description: '使用 Supabase 实现轻量埋点监控'
pubDate: '2025-12-9'
tags: ["前端","埋点"]
categories: ["前端"]
---

基于 Supabase 构建一个轻量级、隐私友好的埋点分析系统，适合个人项目或小型团队快速搭建用户行为追踪方案。

## 为什么选择 Supabase？

- **免费额度充足**：免费版足够支撑小型项目
- **开箱即用**：PostgreSQL + Auth + Edge Functions 一站式解决
- **无需运维**：托管服务，专注业务逻辑
- **实时能力**：支持实时订阅，可扩展为实时监控
- **轻量**：无需部署Sentry等大型埋点项目

## 架构设计

```txt
┌─────────────┐     POST /track      ┌──────────────────┐
│   客户端    │ ──────────────────▶  │  Edge Function   │
│  (App/Web)  │    x-track-token     │  (Deno Runtime)  │
└─────────────┘                      └────────┬─────────┘
                                              │ service_role
                                              ▼
┌─────────────┐     anon key         ┌──────────────────┐
│   仪表盘    │ ◀────────────────── │    PostgreSQL    │
│  (静态页面) │    authenticated     │  events + views  │
└─────────────┘                      └──────────────────┘
```

核心思路：

1. **写入隔离**：客户端通过 Edge Function 上报事件，使用 service_role 写入，避免暴露写权限
2. **读取受控**：仪表盘使用 anon key + 用户登录后读取，RLS 保护数据安全
3. **批量上报**：客户端本地队列 + 定时 flush，减少请求次数

## 第一步：创建数据库表

在 Supabase SQL Editor 中执行：

```sql
-- 启用扩展
create extension if not exists "uuid-ossp";

-- 事件表
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,          -- 匿名用户 ID
  session_id uuid not null,       -- 会话 ID
  event text not null,            -- 事件名称
  ts timestamptz not null,        -- 事件时间戳
  os_platform text,               -- 操作系统
  os_release text,                -- 系统版本
  os_arch text,                   -- CPU 架构
  app_version text,               -- 应用版本
  language text,                  -- 语言
  screen_resolution text,         -- 屏幕分辨率
  extra jsonb default '{}'::jsonb,-- 扩展字段
  inserted_at timestamptz not null default now()
);

-- 索引优化查询性能
create index idx_events_user_ts on public.events (user_id, ts desc);
create index idx_events_ts on public.events (ts desc);
create index idx_events_event on public.events (event);
```

## 第二步：配置行级安全策略 (RLS)

```sql
-- 启用 RLS
alter table public.events enable row level security;

-- 仅允许 authenticated 用户读取（用于仪表盘）
create policy "events_read" on public.events
  for select to authenticated
  using (true);

-- 仅允许 service_role 写入（用于 Edge Function）
create policy "events_insert" on public.events
  for insert to service_role
  with check (true);
```

这样配置后：

- 前端 anon key 无法直接写入数据
- 必须通过 Edge Function（使用 service_role）才能写入
- 登录用户可以查询数据用于仪表盘展示

## 第三步：创建 Edge Function

创建 `supabase/functions/track/index.ts`：

```typescript
import { serve } from 'https://deno.land/std@0.223.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TRACK_TOKEN = Deno.env.get('TRACK_TOKEN')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const MAX_BATCH = 200

serve(async (req) => {
  // 仅允许 POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Token 鉴权
  const token = req.headers.get('x-track-token')
  if (token !== TRACK_TOKEN) {
    return new Response('Unauthorized', { status: 401 })
  }

  // 解析请求体
  let events
  try {
    events = await req.json()
    if (!Array.isArray(events))
      throw new Error('Body must be an array')
  }
  catch (err) {
    return new Response(`Invalid JSON: ${err}`, { status: 400 })
  }

  // 批量限制
  if (events.length > MAX_BATCH) {
    return new Response(`Too many events (max ${MAX_BATCH})`, { status: 413 })
  }

  // 数据清洗
  const sanitized = events.filter(ev =>
    ev.user_id && ev.session_id && ev.event && ev.ts
  ).map((ev) => {
    // 限制 extra 字段大小
    if (ev.extra && JSON.stringify(ev.extra).length > 4000) {
      ev.extra = { warning: 'truncated' }
    }
    return ev
  })

  if (sanitized.length === 0) {
    return new Response('No valid events', { status: 400 })
  }

  // 写入数据库
  const { error } = await supabase.from('events').insert(sanitized)
  if (error) {
    return new Response(`Insert failed: ${error.message}`, { status: 500 })
  }

  return new Response(JSON.stringify({ inserted: sanitized.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
```

## 第四步：部署 Edge Function

```bash
# 登录 Supabase CLI
supabase login

# 设置环境变量
supabase secrets set \
  SUPABASE_URL=https://your-project.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
  TRACK_TOKEN=your_custom_token \
  --project-ref your_project_ref

# 部署函数（跳过 JWT 验证，使用自定义 Token）
supabase functions deploy track --project-ref your_project_ref --no-verify-jwt
```

## 第五步：创建分析视图

```sql
-- 用户画像视图
create or replace view public.user_profile as
select
  user_id,
  min(ts) as first_seen_at,
  max(ts) as last_seen_at,
  count(*) filter (where event = 'app_start') as total_sessions,
  count(*) as total_events,
  count(distinct date(ts)) as active_days
from public.events
group by user_id;

-- 用户分层视图
create or replace view public.user_tags as
with activity as (
  select
    user_id,
    max(ts) as last_seen_at,
    min(ts) as first_seen_at,
    count(distinct date(ts)) filter (where ts >= now() - interval '7 days') as active_days_7d
  from public.events
  group by user_id
)
select
  user_id,
  case
    when active_days_7d >= 5 then 'heavy'
    when active_days_7d between 2 and 4 then 'medium'
    else 'light'
  end as active_level,
  case
    when first_seen_at >= now() - interval '7 days' then 'new_user'
    when last_seen_at >= now() - interval '7 days' then 'retained'
    when last_seen_at >= now() - interval '30 days' then 'churn_risk'
    else 'churned'
  end as lifecycle_stage
from activity;
```

## 项目实践：xiaozhi-desktop 埋点实现分析

```txt
┌─────────────────────┐
│  渲染进程           │
│  useAnalytics()     │
│  trackEvent()       │
└─────────┬───────────┘
          │ IPC (analytics:track)
┌─────────▼───────────┐
│  主进程             │
│  AnalyticsService   │
│  - 收集系统信息     │
│  - 缓存事件队列     │
│  - 批量上报         │
└─────────┬───────────┘
          │ POST /bright-task
┌─────────▼───────────┐
│  Supabase           │
│  Edge Function      │
│  Token 鉴权         │
└─────────┬───────────┘
          │ service_role
┌─────────▼───────────┐
│  PostgreSQL         │
│  events 表          │
└─────────────────────┘
```

### 核心代码结构

#### 1. 主服务：`AnalyticsService.ts`

- 生成稳定的用户 ID (基于设备指纹 + UUID v5)
- 收集系统信息 (OS、屏幕分辨率、应用版本等)
- 事件队列管理与批量上报
- 定时发送 (30秒) + 达到批量阈值立即发送 (50条)

```typescript
// src/main/services/AnalyticsService.ts
export class AnalyticsService {
  private config: AnalyticsConfig = {
    enabled: true,
    endpoint: 'https://your-project.supabase.co/functions/v1/bright-task',
    token: 'junsen-track-2025-LightDot',
    flushInterval: 30000, // 30秒
    flushBatchSize: 50, // 50条事件
  }

  // 上报事件
  track(event: string, extra?: Record<string, unknown>): void {
    const payload: EventPayload = {
      user_id: this.userId, // 基于设备指纹生成的稳定 UUID
      session_id: this.sessionId, // 每次启动生成新的会话 ID
      event,
      ts: new Date().toISOString(),
      ...this.systemInfo, // 系统信息
      extra, // 自定义数据
    }

    this.eventQueue.push(payload)

    // 队列达到批量大小时立即发送
    if (this.eventQueue.length >= this.config.flushBatchSize) {
      this.flush()
    }
  }
}
```

#### 2. IPC 通信：`analyticsIpc.ts`

**暴露埋点能力给渲染进程**，提供 4 个 IPC 通道：

- `analytics:track` - 上报事件
- `analytics:get-config` - 获取配置
- `analytics:update-config` - 更新配置
- `analytics:flush` - 手动触发发送

```typescript
// src/main/ipc/analyticsIpc.ts
ipcMain.handle('analytics:track', async (_event, eventName: string, extra?: Record<string, unknown>) => {
  const analytics = getAnalyticsService()
  analytics.track(eventName, extra)
  return { success: true }
})
```

#### 3. 前端封装：`useAnalytics.ts`

**Vue Composable** 封装，简化前端调用：

```typescript
// src/renderer/src/composables/useAnalytics.ts
export function trackEvent(event: string, extra?: Record<string, unknown>): void {
  window.api
    .analyticsTrack(event, extra)
    .catch(error => console.error('埋点上报失败:', error))
}

export function useAnalytics() {
  return {
    track: trackEvent,
  }
}
```

#### 4. Preload 桥接：`analytics.ts`

**安全地暴露 API 给渲染进程**：

```typescript
// src/preload/modules/analytics.ts
export const analyticsApi = {
  track: async (event: string, extra?: Record<string, unknown>) => {
    return await ipcRenderer.invoke('analytics:track', event, extra)
  },

  getConfig: async () => {
    return await ipcRenderer.invoke('analytics:get-config')
  },

  updateConfig: async (config: any) => {
    return await ipcRenderer.invoke('analytics:update-config', config)
  },

  flush: async () => {
    return await ipcRenderer.invoke('analytics:flush')
  },
}
```

### 已埋事件清单

| 事件名称              | 触发位置                                     | 携带数据                       | 说明                            |
| --------------------- | -------------------------------------------- | ------------------------------ | ------------------------------- |
| `app_start`           | `src/main/index.ts:147`                      | `version`, `platform`, `isDev` | 应用启动时上报                  |
| `app_quit`            | `src/main/index.ts:275`                      | -                              | 应用退出时上报 (会等待发送完成) |
| `activation_verified` | `src/main/services/ActivationService.ts:265` | -                              | 设备激活验证通过                |
| `activation_success`  | `src/main/services/ActivationService.ts:360` | `attempts`                     | 激活成功，记录尝试次数          |

### 数据字段说明

#### 固定字段

每个事件默认携带以下系统信息：

| 字段                | 类型     | 来源               | 示例                                   |
| ------------------- | -------- | ------------------ | -------------------------------------- |
| `user_id`           | UUID     | 设备指纹 + UUID v5 | `550e8400-e29b-41d4-a716-446655440000` |
| `session_id`        | UUID     | 每次启动生成       | `123e4567-e89b-12d3-a456-426614174000` |
| `event`             | string   | 事件名称           | `app_start`                            |
| `ts`                | ISO 8601 | 事件时间戳         | `2025-12-09T10:30:00.000Z`             |
| `os_platform`       | string   | `process.platform` | `darwin` / `win32` / `linux`           |
| `os_release`        | string   | `os.release()`     | `24.6.0`                               |
| `os_arch`           | string   | `process.arch`     | `arm64` / `x64`                        |
| `app_version`       | string   | `app.getVersion()` | `1.0.5-beta.7`                         |
| `language`          | string   | `app.getLocale()`  | `zh-CN`                                |
| `screen_resolution` | string   | 主显示器分辨率     | `1920x1080`                            |
| `extra`             | jsonb    | 自定义数据         | `{ "attempts": 3 }`                    |

#### 用户标识生成策略

```typescript
// 基于设备指纹生成稳定的 UUID
private async generateUserId(): Promise<void> {
  const fingerprintManager = await DeviceFingerprintManager.getInstanceAsync()
  const serialNumber = fingerprintManager.getSerialNumber()

  // 使用 UUID v5 生成稳定的 UUID (同一设备始终相同)
  const UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
  this.userId = uuidv5(serialNumber, UUID_NAMESPACE)
}
```

**优点**：

- 同一设备卸载重装后 `user_id` 保持不变，可追踪长期行为
- 无需账号体系，支持匿名分析
- 隐私友好，不收集任何个人信息

### 批量上报策略

项目采用 **队列缓存 + 双触发机制**：

1. **定时发送**：每 30 秒自动 flush 队列 (`flushInterval`)
2. **批量阈值**：队列达到 50 条事件立即发送 (`flushBatchSize`)
3. **应用退出**：调用 `shutdown()` 确保剩余事件发送完成

```typescript
// 批量发送逻辑
async flush(): Promise<void> {
  if (this.eventQueue.length === 0) return

  const events = [...this.eventQueue]
  this.eventQueue = []

  try {
    await this.sendToSupabase(events)
    this.logger.debug(`成功发送 ${events.length} 个事件`)
  } catch (error) {
    this.logger.error('发送事件失败,保存到离线缓存', error)
    await this.saveOffline(events)  // TODO: 未实现
  }
}
```

### Edge Function 配置

**端点信息**：

```typescript
endpoint: 'https://your-project.supabase.co/functions/v1/bright-task'
token: 'junsen-track-2025-LightDot'
```

**请求格式**：

```bash
curl -X POST https://your-project.supabase.co/functions/v1/bright-task \
  -H "Content-Type: application/json" \
  -H "X-Track-Token: junsen-track-2025-LightDot" \
  -d '[
    {
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "session_id": "123e4567-e89b-12d3-a456-426614174000",
      "event": "app_start",
      "ts": "2025-12-09T10:30:00.000Z",
      "os_platform": "darwin",
      "os_release": "24.6.0",
      "os_arch": "arm64",
      "app_version": "1.0.5-beta.7",
      "language": "zh-CN",
      "screen_resolution": "1920x1080",
      "extra": {
        "version": "1.0.5-beta.7",
        "platform": "darwin",
        "isDev": false
      }
    }
  ]'
```

## 最佳实践与建议

### 1. 埋点设计原则

#### 事件分类建议

| 分类         | 示例事件                                          | 说明               |
| ------------ | ------------------------------------------------- | ------------------ |
| **生命周期** | `app_start`, `app_quit`, `window_opened`          | 应用/窗口生命周期  |
| **功能使用** | `camera_capture`, `music_play`, `voice_wakeup`    | 用户主动触发的功能 |
| **用户行为** | `button_click`, `menu_opened`, `settings_changed` | 用户交互行为       |
| **激活授权** | `activation_verified`, `activation_success`       | 激活/授权流程      |
| **错误异常** | `error_occurred`, `api_failed`, `crash_report`    | 错误和异常         |
| **性能指标** | `startup_time`, `api_latency`, `memory_usage`     | 性能数据           |

### 2. 数据采集建议

#### 优先级划分

```typescript
// 高优先级：核心业务指标
track('app_start') // 启动次数
track('activation_success') // 激活成功
track('feature_used', { feature }) // 功能使用

// 中优先级：用户行为
track('button_click', { button_id }) // 按钮点击
track('page_view', { page }) // 页面访问

// 低优先级：调试信息
track('debug_log', { message }) // 调试日志
```

### 3. 错误监控实践

#### 统一错误上报

```typescript
// src/main/utils/errorTracking.ts
export function trackError(error: Error, context?: Record<string, unknown>) {
  const analytics = getAnalyticsService()

  analytics.track('error_occurred', {
    error_name: error.name,
    error_message: error.message,
    error_stack: error.stack?.substring(0, 500), // 限制长度
    ...context,
  })
}

// 使用示例
try {
  await someRiskyOperation()
}
catch (error) {
  trackError(error as Error, {
    operation: 'someRiskyOperation',
    retry_count: 3,
  })
}
```

#### 全局异常捕获

```typescript
// src/main/index.ts
process.on('uncaughtException', (error) => {
  trackError(error, { type: 'uncaughtException' })
  logger.error('Uncaught Exception:', error)
})

process.on('unhandledRejection', (reason) => {
  trackError(reason as Error, { type: 'unhandledRejection' })
  logger.error('Unhandled Rejection:', reason)
})
```

### 4. 性能监控实践

#### 启动耗时监控

```typescript
// src/main/index.ts
const startTime = Date.now()

app.whenReady().then(async () => {
  // ... 初始化逻辑 ...

  const startupDuration = Date.now() - startTime

  analytics.track('app_start', {
    version: app.getVersion(),
    platform: process.platform,
    isDev: !app.isPackaged,
    startup_duration_ms: startupDuration, // 启动耗时
  })
})
```

#### API 请求监控

```typescript
// src/main/utils/apiTracking.ts
export async function trackApiCall<T>(
  apiName: string,
  apiCall: () => Promise<T>
): Promise<T> {
  const startTime = Date.now()

  try {
    const result = await apiCall()
    const duration = Date.now() - startTime

    getAnalyticsService().track('api_call', {
      api_name: apiName,
      success: true,
      duration_ms: duration,
    })

    return result
  }
  catch (error) {
    const duration = Date.now() - startTime

    getAnalyticsService().track('api_call', {
      api_name: apiName,
      success: false,
      duration_ms: duration,
      error: (error as Error).message,
    })

    throw error
  }
}

// 使用示例
const data = await trackApiCall('fetchUserData', () => fetch('/api/user'))
```

### 5. 数据分析查询示例

#### 活跃用户统计

```sql
-- 日活用户 (DAU)
select count(distinct user_id) as dau
from public.events
where date(ts) = current_date;

-- 周活用户 (WAU)
select count(distinct user_id) as wau
from public.events
where ts >= current_date - interval '7 days';

-- 月活用户 (MAU)
select count(distinct user_id) as mau
from public.events
where ts >= current_date - interval '30 days';
```

#### 功能使用排行

```sql
-- 功能使用次数排行 (最近 7 天)
select
  extra->>'feature' as feature_name,
  count(*) as usage_count,
  count(distinct user_id) as unique_users
from public.events
where event = 'feature_used'
  and ts >= now() - interval '7 days'
group by extra->>'feature'
order by usage_count desc
limit 10;
```

#### 留存率分析

```sql
-- 次日留存率
with first_day_users as (
  select distinct user_id, date(ts) as first_day
  from public.events
  where event = 'app_start'
    and date(ts) = '2025-12-08'
)
select
  count(distinct e.user_id)::float / count(distinct f.user_id) * 100 as retention_rate
from first_day_users f
left join public.events e
  on f.user_id = e.user_id
  and date(e.ts) = f.first_day + interval '1 day';
```

#### 用户会话分析

```sql
-- 平均会话时长 (app_start 到 app_quit 的时间差)
with sessions as (
  select
    session_id,
    min(ts) as session_start,
    max(ts) as session_end,
    extract(epoch from (max(ts) - min(ts))) as session_duration_sec
  from public.events
  group by session_id
  having count(*) > 1  -- 至少有 2 个事件
)
select
  avg(session_duration_sec) / 60 as avg_session_minutes,
  percentile_cont(0.5) within group (order by session_duration_sec) / 60 as median_session_minutes
from sessions
where session_duration_sec > 0;
```

#### 激活漏斗分析

```sql
-- 激活流程转化率
select
  count(*) filter (where event = 'activation_start') as started,
  count(*) filter (where event = 'activation_verified') as verified,
  count(*) filter (where event = 'activation_success') as succeeded,
  round(
    count(*) filter (where event = 'activation_success')::float /
    nullif(count(*) filter (where event = 'activation_start'), 0) * 100,
    2
  ) as conversion_rate
from public.events
where ts >= now() - interval '7 days';
```

## 前端预览页

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LightDot 用户画像监控</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.2/dist/umd/supabase.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['"Inter"', '"Noto Sans SC"', 'sans-serif'],
          },
          colors: {
            primary: {
              50: '#f0f9ff',
              100: '#e0f2fe',
              500: '#0ea5e9',
              600: '#0284c7',
              700: '#0369a1',
            }
          }
        }
      }
    }
  </script>
  <style>
    body {
       background-color: #f8fafc;
       background-image: 
         radial-gradient(at 0% 0%, hsla(253,16%,7%,0) 0, transparent 50%), 
         radial-gradient(at 50% 0%, hsla(225,39%,30%,0) 0, transparent 50%), 
         radial-gradient(at 100% 0%, hsla(339,49%,30%,0) 0, transparent 50%);
       background-attachment: fixed;
    }
    .glass-panel {
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.8);
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
    }
    .glass-header {
        background: rgba(255, 255, 255, 0.8);
        backdrop-filter: blur(12px);
        border-bottom: 1px solid rgba(226, 232, 240, 0.8);
    }
  </style>
</head>
<body class="min-h-screen font-sans text-slate-800 bg-slate-50">
  
  <!-- Navbar -->
  <nav class="glass-header sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between h-16 items-center">
        <div class="flex items-center gap-3">
          <div class="bg-indigo-600 p-1.5 rounded-lg">
            <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
          </div>
          <span class="font-bold text-xl tracking-tight text-slate-900">LightDot <span class="text-indigo-600">Monitor</span></span>
        </div>
        <div class="flex items-center gap-4">
           <div id="auth-status" class="text-sm text-slate-500 hidden md:block">未登录</div>
           <button id="logout-btn" class="hidden px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">退出登录</button>
        </div>
      </div>
    </div>
  </nav>

  <main class="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-8">
    
    <!-- Config & Login Card -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <!-- Left: Login & Config -->
      <div class="lg:col-span-1 space-y-6">
        
        <!-- Login Panel -->
        <section class="glass-panel rounded-2xl p-6">
          <h2 class="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <svg class="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"></path></svg>
            管理员登录
          </h2>
          <div class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-slate-500 mb-1 uppercase tracking-wider">Email</label>
              <input id="email" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-sm" placeholder="admin@example.com" />
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 mb-1 uppercase tracking-wider">Password</label>
              <input id="password" type="password" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-sm" placeholder="••••••••" />
            </div>
            <button id="login" class="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-lg shadow-indigo-600/20 transition-all active:scale-95 flex justify-center items-center gap-2">
              <span>登录系统</span>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
            </button>
            <div id="login-msg" class="text-xs text-center min-h-[1.5em] text-rose-500 font-medium"></div>
          </div>
        </section>

        <!-- Connection Settings (Collapsible or Small) -->
        <section class="glass-panel rounded-2xl p-6">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-bold text-slate-900 flex items-center gap-2">
              <svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
              连接配置
            </h2>
            <button id="save-config" class="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg transition-colors">保存</button>
          </div>
          <div class="space-y-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Supabase URL</label>
              <input id="supabase-url" class="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50/50 text-xs focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="https://..." />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Supabase Anon Key</label>
              <input id="supabase-anon" type="password" class="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50/50 text-xs focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="ey..." />
            </div>
          </div>
        </section>
      </div>

      <!-- Right: Dashboard Content -->
      <div class="lg:col-span-2 space-y-8">
        
        <!-- Summary Cards - 用户规模 -->
        <div class="glass-panel rounded-2xl p-6 mb-6">
          <h3 class="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <svg class="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
            用户规模统计
          </h3>
          <div class="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div class="bg-white rounded-xl p-4 border border-slate-100">
              <span class="text-xs text-slate-500 font-medium uppercase tracking-wider">总用户数</span>
              <span id="stat-total-users" class="text-2xl font-bold text-slate-800 mt-1 block">-</span>
            </div>
            <div class="bg-white rounded-xl p-4 border border-slate-100">
              <span class="text-xs text-slate-500 font-medium uppercase tracking-wider">日活 (DAU)</span>
              <span id="stat-dau" class="text-2xl font-bold text-emerald-600 mt-1 block">-</span>
            </div>
            <div class="bg-white rounded-xl p-4 border border-slate-100">
              <span class="text-xs text-slate-500 font-medium uppercase tracking-wider">周活 (WAU)</span>
              <span id="stat-wau" class="text-2xl font-bold text-blue-600 mt-1 block">-</span>
            </div>
            <div class="bg-white rounded-xl p-4 border border-slate-100">
              <span class="text-xs text-slate-500 font-medium uppercase tracking-wider">月活 (MAU)</span>
              <span id="stat-mau" class="text-2xl font-bold text-indigo-600 mt-1 block">-</span>
            </div>
            <div class="bg-white rounded-xl p-4 border border-slate-100">
              <span class="text-xs text-slate-500 font-medium uppercase tracking-wider">新用户 (本周)</span>
              <span id="stat-new-users" class="text-2xl font-bold text-purple-600 mt-1 block">-</span>
            </div>
          </div>
        </div>

        <!-- 用户行为统计 -->
        <div class="glass-panel rounded-2xl p-6 mb-6">
          <h3 class="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            用户行为分析
          </h3>
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="bg-white rounded-xl p-4 border border-slate-100">
              <span class="text-xs text-slate-500 font-medium uppercase tracking-wider">平均使用时长</span>
              <span id="stat-avg-duration" class="text-2xl font-bold text-slate-800 mt-1 block">-</span>
              <span class="text-xs text-slate-400">分钟/会话</span>
            </div>
            <div class="bg-white rounded-xl p-4 border border-slate-100">
              <span class="text-xs text-slate-500 font-medium uppercase tracking-wider">日均启动次数</span>
              <span id="stat-avg-starts" class="text-2xl font-bold text-blue-600 mt-1 block">-</span>
              <span class="text-xs text-slate-400">次/天</span>
            </div>
            <div class="bg-white rounded-xl p-4 border border-slate-100">
              <span class="text-xs text-slate-500 font-medium uppercase tracking-wider">激活成功率</span>
              <span id="stat-activation-rate" class="text-2xl font-bold text-emerald-600 mt-1 block">-</span>
              <span class="text-xs text-slate-400">%</span>
            </div>
            <div class="bg-white rounded-xl p-4 border border-slate-100">
              <span class="text-xs text-slate-500 font-medium uppercase tracking-wider">崩溃率</span>
              <span id="stat-crash-rate" class="text-2xl font-bold text-rose-600 mt-1 block">-</span>
              <span class="text-xs text-slate-400">%</span>
            </div>
          </div>
        </div>

        <!-- Charts Section -->
        <section class="glass-panel rounded-2xl p-6 md:p-8">
          <div class="flex items-center justify-between mb-8">
            <div>
              <h2 class="text-2xl font-bold text-slate-900">数据概览</h2>
              <p class="text-slate-500 text-sm mt-1">实时聚合用户画像数据</p>
            </div>
            <button id="load-charts" class="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 hover:shadow-md transition-all flex items-center gap-2 text-sm font-medium">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
              刷新数据
            </button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- 操作系统分布 -->
            <div class="bg-white rounded-xl p-5 border border-slate-100 shadow-sm">
              <h3 class="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-blue-500"></span> 操作系统分布
              </h3>
              <div class="h-48 flex items-center justify-center">
                 <canvas id="chart-platform"></canvas>
              </div>
            </div>

            <!-- CPU 架构分布 -->
            <div class="bg-white rounded-xl p-5 border border-slate-100 shadow-sm">
              <h3 class="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                 <span class="w-2 h-2 rounded-full bg-indigo-500"></span> CPU 架构分布
              </h3>
              <div class="h-48">
                <canvas id="chart-arch"></canvas>
              </div>
            </div>

            <!-- 应用版本分布 -->
            <div class="bg-white rounded-xl p-5 border border-slate-100 shadow-sm">
              <h3 class="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                 <span class="w-2 h-2 rounded-full bg-orange-500"></span> 应用版本分布 (Top 6)
              </h3>
              <div class="h-48">
                <canvas id="chart-version"></canvas>
              </div>
            </div>

            <!-- 活跃时段分布 -->
            <div class="bg-white rounded-xl p-5 border border-slate-100 shadow-sm">
              <h3 class="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                 <span class="w-2 h-2 rounded-full bg-emerald-500"></span> 活跃时段分布 (24h)
              </h3>
              <div class="h-48">
                <canvas id="chart-hour"></canvas>
              </div>
            </div>

            <!-- 开发/生产环境占比 -->
            <div class="bg-white rounded-xl p-5 border border-slate-100 shadow-sm">
              <h3 class="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                 <span class="w-2 h-2 rounded-full bg-purple-500"></span> 环境分布
              </h3>
              <div class="h-48">
                <canvas id="chart-env"></canvas>
              </div>
            </div>

            <!-- 屏幕分辨率 Top 5 -->
            <div class="bg-white rounded-xl p-5 border border-slate-100 shadow-sm">
              <h3 class="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                 <span class="w-2 h-2 rounded-full bg-pink-500"></span> 屏幕分辨率 (Top 5)
              </h3>
              <div class="h-48">
                <canvas id="chart-resolution"></canvas>
              </div>
            </div>
          </div>
        </section>

        <!-- Data Table Section -->
        <section class="glass-panel rounded-2xl p-6 md:p-8">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-bold text-slate-900">详细数据</h2>
            <div class="flex bg-slate-100 p-1 rounded-lg">
              <button id="load-combined" class="px-4 py-1.5 rounded-md text-sm font-medium text-slate-600 hover:bg-white hover:shadow-sm transition-all">用户汇总</button>
              <button id="load-events" class="px-4 py-1.5 rounded-md text-sm font-medium text-slate-600 hover:bg-white hover:shadow-sm transition-all">原始事件</button>
            </div>
          </div>
          
          <div id="table-container" class="bg-white border border-slate-200 rounded-xl overflow-hidden min-h-[200px]">
             <div class="h-full flex flex-col items-center justify-center text-slate-400 py-12 space-y-2">
                <svg class="w-12 h-12 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"></path></svg>
                <span class="text-sm">请先登录并加载数据</span>
             </div>
          </div>
        </section>

      </div>
    </div>
  </main>

  <script>
    // --- Config ---
    const cfgKeys = {
      supabaseUrl: 'supabase-url',
      supabaseAnon: 'supabase-anon'
    };

    const DEFAULT_CONFIG = {
      supabaseUrl: 'https://your-project.supabase.co',
      supabaseAnon: '' 
    };

    const getConfig = () => ({
      supabaseUrl: localStorage.getItem(cfgKeys.supabaseUrl) || DEFAULT_CONFIG.supabaseUrl || '',
      supabaseAnon: localStorage.getItem(cfgKeys.supabaseAnon) || DEFAULT_CONFIG.supabaseAnon || ''
    });

    const setConfig = (cfg) => {
      localStorage.setItem(cfgKeys.supabaseUrl, cfg.supabaseUrl.trim());
      localStorage.setItem(cfgKeys.supabaseAnon, cfg.supabaseAnon.trim());
    };

    // --- Supabase ---
    let supabaseClient = null;
    const ensureSupabase = () => {
      const cfg = getConfig();
      if (!cfg.supabaseUrl || !cfg.supabaseAnon) {
        showMsg('请先配置 Supabase URL 和 Key', 'error');
        return null;
      }
      if (supabaseClient) return supabaseClient;
      try {
        supabaseClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnon);
      } catch (e) {
        showMsg('Supabase 初始化失败: ' + e.message, 'error');
        return null;
      }
      return supabaseClient;
    };

    // --- UI Helpers ---
    const showMsg = (msg, type = 'info') => {
      const el = document.getElementById('login-msg');
      el.textContent = msg;
      el.className = `text-xs text-center min-h-[1.5em] font-medium ${type === 'error' ? 'text-rose-500' : 'text-emerald-500'}`;
      setTimeout(() => { el.textContent = ''; }, 3000);
    };

    const updateAuthUI = async () => {
        const supa = ensureSupabase();
        if(!supa) return;
        const { data: { session } } = await supa.auth.getSession();
        const statusEl = document.getElementById('auth-status');
        const logoutBtn = document.getElementById('logout-btn');
        
        if (session) {
            statusEl.textContent = session.user.email;
            statusEl.classList.add('text-indigo-600', 'font-medium');
            logoutBtn.classList.remove('hidden');
        } else {
            statusEl.textContent = '未登录';
            statusEl.classList.remove('text-indigo-600', 'font-medium');
            logoutBtn.classList.add('hidden');
        }
    };

    const formatTime = (ts) => {
        if (!ts) return '-';
        return new Date(ts).toLocaleString('zh-CN', { hour12: false });
    };

    // --- Charts ---
    const charts = {};
    const destroyChart = (key) => {
      if (charts[key]) {
        charts[key].destroy();
        delete charts[key];
      }
    };

    const upsertChart = (key, ctx, config) => {
      destroyChart(key);
      charts[key] = new Chart(ctx, config);
    };

    const countBy = (rows, key) => {
      const m = {};
      rows.forEach(r => {
        const k = (r[key] || 'unknown').toString();
        m[k] = (m[k] || 0) + 1;
      });
      return m;
    };

    const toDataset = (m) => {
      const labels = Object.keys(m);
      const values = labels.map(k => m[k]);
      return { labels, values };
    };

    const palette = ['#3b82f6', '#6366f1', '#10b981', '#f97316', '#ef4444', '#14b8a6', '#a855f7', '#f59e0b'];

    const loadCharts = async () => {
      const supa = ensureSupabase();
      if (!supa) return;

      const { data: { session } } = await supa.auth.getSession();
      if (!session) {
          showMsg('请先登录', 'error');
          return;
      }

      // 查询所有事件数据
      const { data: events, error } = await supa.from('events').select('*').limit(10000);

      if (error) {
        showMsg('数据加载失败，请检查权限', 'error');
        return;
      }

      if (!events || events.length === 0) {
        showMsg('暂无数据', 'info');
        return;
      }

      // ===== 1. 用户规模统计 =====
      const totalUsers = new Set(events.map(e => e.user_id)).size;
      document.getElementById('stat-total-users').textContent = totalUsers;

      const now = new Date();

      // DAU - 今天0点到现在的活跃用户
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const dau = new Set(events.filter(e => new Date(e.ts) >= todayStart).map(e => e.user_id)).size;
      document.getElementById('stat-dau').textContent = dau;

      // WAU - 本周一0点到现在的活跃用户
      const dayOfWeek = now.getDay();
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // 周日算6天前
      const thisWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToMonday, 0, 0, 0);
      const wau = new Set(events.filter(e => new Date(e.ts) >= thisWeekStart).map(e => e.user_id)).size;
      document.getElementById('stat-wau').textContent = wau;

      // MAU - 本月1日0点到现在的活跃用户
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      const mau = new Set(events.filter(e => new Date(e.ts) >= thisMonthStart).map(e => e.user_id)).size;
      document.getElementById('stat-mau').textContent = mau;

      // 新用户 (本周激活)
      const newUsers = events.filter(e => e.event === 'activation_success' && new Date(e.ts) >= thisWeekStart).length;
      document.getElementById('stat-new-users').textContent = newUsers;

      // ===== 2. 用户行为统计（基于最近30天）=====
      const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
      const recentEvents = events.filter(e => new Date(e.ts) >= thirtyDaysAgo);

      // 计算平均使用时长（从 app_start 到 app_quit 的时间差）
      const sessions = {};
      recentEvents.forEach(e => {
        if (e.event === 'app_start') {
          sessions[e.session_id] = { start: new Date(e.ts), quit: null };
        } else if (e.event === 'app_quit' && sessions[e.session_id]) {
          sessions[e.session_id].quit = new Date(e.ts);
        }
      });

      // 计算有效会话时长（排除异常值：<10秒 或 >2小时）
      const durations = Object.values(sessions)
        .filter(s => s.quit)
        .map(s => (s.quit - s.start) / 1000 / 60) // 分钟
        .filter(d => d >= 0.17 && d <= 120); // 10秒到2小时

      const avgDuration = durations.length > 0
        ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1)
        : '0';
      document.getElementById('stat-avg-duration').textContent = avgDuration;

      // 日均启动次数（用户维度：平均每个活跃用户每天启动多少次）
      const appStarts = recentEvents.filter(e => e.event === 'app_start');
      // 统计"用户-日期"的唯一组合数，表示有多少个"用户活跃天"
      const activeUserDays = new Set(appStarts.map(e => {
        const date = new Date(e.ts).toDateString();
        return `${e.user_id}_${date}`;
      })).size;
      const avgStarts = activeUserDays > 0 ? (appStarts.length / activeUserDays).toFixed(1) : '0';
      document.getElementById('stat-avg-starts').textContent = avgStarts;

      // 激活成功率（最近30天的首次激活率）
      const recentActivations = recentEvents.filter(e => e.event === 'activation_success');
      const recentUsers = new Set(recentEvents.map(e => e.user_id)).size;
      const activationRate = recentUsers > 0 ? ((recentActivations.length / recentUsers) * 100).toFixed(1) : '0';
      document.getElementById('stat-activation-rate').textContent = activationRate;

      // 崩溃率（最近30天没有正常退出的会话比例）
      const totalSessions = Object.keys(sessions).length;
      const crashedSessions = Object.values(sessions).filter(s => !s.quit).length;
      const crashRate = totalSessions > 0 ? ((crashedSessions / totalSessions) * 100).toFixed(1) : '0';
      document.getElementById('stat-crash-rate').textContent = crashRate;

      // ===== 3. 图表数据 =====

      // 3.1 操作系统分布 (按用户数统计)
      const platformMap = {};
      events.forEach(e => {
        if (e.os_platform) {
          if (!platformMap[e.os_platform]) platformMap[e.os_platform] = new Set();
          platformMap[e.os_platform].add(e.user_id);
        }
      });
      const platformData = toDataset(
        Object.fromEntries(Object.entries(platformMap).map(([k, v]) => [k, v.size]))
      );
      upsertChart('platform', document.getElementById('chart-platform').getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: platformData.labels,
          datasets: [{ data: platformData.values, backgroundColor: palette, borderWidth: 0 }]
        },
        options: {
            plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } },
            cutout: '65%'
        }
      });

      // 3.2 CPU 架构分布 (按用户数统计)
      const archMap = {};
      events.forEach(e => {
        if (e.os_arch) {
          if (!archMap[e.os_arch]) archMap[e.os_arch] = new Set();
          archMap[e.os_arch].add(e.user_id);
        }
      });
      const archData = toDataset(
        Object.fromEntries(Object.entries(archMap).map(([k, v]) => [k, v.size]))
      );
      upsertChart('arch', document.getElementById('chart-arch').getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: archData.labels,
          datasets: [{ data: archData.values, backgroundColor: palette, borderWidth: 0 }]
        },
        options: {
            plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } },
            cutout: '65%'
        }
      });

      // 3.3 应用版本分布 (Top 6) (按用户数统计)
      const versionMap = {};
      events.forEach(e => {
        if (e.app_version) {
          if (!versionMap[e.app_version]) versionMap[e.app_version] = new Set();
          versionMap[e.app_version].add(e.user_id);
        }
      });
      const versionEntries = Object.entries(versionMap)
        .map(([k, v]) => [k, v.size])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);
      upsertChart('version', document.getElementById('chart-version').getContext('2d'), {
        type: 'bar',
        data: {
          labels: versionEntries.map(e => e[0]),
          datasets: [{ label: '用户数', data: versionEntries.map(e => e[1]), backgroundColor: palette[3], borderRadius: 4 }]
        },
        options: {
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, grid: { display: false } }, y: { grid: { display: false } } }
        }
      });

      // 3.4 活跃时段分布 (24h) (按用户数统计)
      const hourMap = {};
      for (let i = 0; i < 24; i++) hourMap[i] = new Set();
      events.forEach(e => {
        const hour = new Date(e.ts).getHours();
        hourMap[hour].add(e.user_id);
      });
      const hourLabels = Object.keys(hourMap).map(h => `${h}:00`);
      const hourValues = Object.values(hourMap).map(s => s.size);
      upsertChart('hour', document.getElementById('chart-hour').getContext('2d'), {
        type: 'line',
        data: {
          labels: hourLabels,
          datasets: [{
            label: '活跃用户数',
            data: hourValues,
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderColor: palette[2],
            borderWidth: 2,
            fill: true,
            tension: 0.4
          }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: {
              y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
              x: { grid: { display: false } }
            }
        }
      });

      // 3.5 环境分布 (开发/生产) (按用户数统计)
      const devUsers = new Set();
      const prodUsers = new Set();
      events.forEach(e => {
        if (e.extra && typeof e.extra === 'object') {
          if (e.extra.isDev === true) devUsers.add(e.user_id);
          else if (e.extra.isDev === false) prodUsers.add(e.user_id);
        }
      });
      upsertChart('env', document.getElementById('chart-env').getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['生产环境', '开发环境'],
          datasets: [{ data: [prodUsers.size, devUsers.size], backgroundColor: [palette[2], palette[6]], borderWidth: 0 }]
        },
        options: {
            plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } },
            cutout: '65%'
        }
      });

      // 3.6 屏幕分辨率 (Top 5) (按用户数统计)
      const resolutionMap = {};
      events.forEach(e => {
        if (e.screen_resolution) {
          if (!resolutionMap[e.screen_resolution]) resolutionMap[e.screen_resolution] = new Set();
          resolutionMap[e.screen_resolution].add(e.user_id);
        }
      });
      const resolutionEntries = Object.entries(resolutionMap)
        .map(([k, v]) => [k, v.size])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      upsertChart('resolution', document.getElementById('chart-resolution').getContext('2d'), {
        type: 'bar',
        data: {
          labels: resolutionEntries.map(e => e[0]),
          datasets: [{ label: '用户数', data: resolutionEntries.map(e => e[1]), backgroundColor: palette[7], borderRadius: 4 }]
        },
        options: {
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, grid: { display: false } }, y: { grid: { display: false } } }
        }
      });

      showMsg('图表已更新', 'success');
    };

    // --- Table ---
    const renderTable = (rows, columns = []) => {
      const el = document.getElementById('table-container');
      if (!rows || rows.length === 0) {
        el.innerHTML = '<div class="p-12 text-center text-slate-400">暂无数据</div>';
        return;
      }
      
      const headers = columns.length > 0 ? columns : Object.keys(rows[0]);
      
      // Helper to get nested value or format
      const getVal = (row, col) => {
          const key = typeof col === 'string' ? col : col.key;
          const val = row[key];
          if (typeof col === 'object' && col.format) {
              return col.format(val, row);
          }
          return val ?? '-';
      };
      
      const getHeader = (col) => typeof col === 'string' ? col : col.label;

      const html = [
        '<div class="overflow-auto max-h-[500px]">',
        '<table class="min-w-full text-left border-collapse">',
        '<thead class="sticky top-0 z-10 bg-slate-50"><tr>',
        headers.map(h => `<th class="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200 whitespace-nowrap">${getHeader(h)}</th>`).join(''),
        '</tr></thead>',
        '<tbody class="divide-y divide-slate-100 bg-white">',
        rows.map(r => `<tr class="hover:bg-slate-50 transition-colors">${headers.map(h => `<td class="px-4 py-3 text-sm text-slate-600 border-b border-slate-50 max-w-xs truncate" title="${getVal(r, h)}">${getVal(r, h)}</td>`).join('')}</tr>`).join(''),
        '</tbody></table></div>'
      ].join('');
      el.innerHTML = html;
    };

    const loadTableData = async (type) => {
        const supa = ensureSupabase();
        if (!supa) return;

        const { data: { session } } = await supa.auth.getSession();
        if (!session) {
            showMsg('请先登录', 'error');
            return;
        }

        let data = [];
        let columns = [];

        if (type === 'combined') {
            // 查询最近 1000 条事件
            const { data: events, error } = await supa.from('events').select('*').order('ts', { ascending: false }).limit(1000);

            if (error) {
                showMsg('加载失败', 'error');
                return;
            }

            // 按用户聚合数据
            const userMap = new Map();
            events.forEach(e => {
                if (!userMap.has(e.user_id)) {
                    userMap.set(e.user_id, {
                        user_id: e.user_id,
                        os_platform: e.os_platform,
                        os_arch: e.os_arch,
                        app_version: e.app_version,
                        screen_resolution: e.screen_resolution,
                        first_seen_at: e.ts,
                        last_seen_at: e.ts,
                        total_events: 0,
                        total_sessions: new Set()
                    });
                }
                const user = userMap.get(e.user_id);
                user.total_events++;
                user.total_sessions.add(e.session_id);
                if (new Date(e.ts) < new Date(user.first_seen_at)) {
                    user.first_seen_at = e.ts;
                }
                if (new Date(e.ts) > new Date(user.last_seen_at)) {
                    user.last_seen_at = e.ts;
                    user.os_platform = e.os_platform || user.os_platform;
                    user.app_version = e.app_version || user.app_version;
                }
            });

            data = Array.from(userMap.values()).map(u => ({
                ...u,
                total_sessions: u.total_sessions.size
            }));

            columns = [
                { key: 'user_id', label: 'User ID' },
                { key: 'os_platform', label: '操作系统' },
                { key: 'os_arch', label: 'CPU架构' },
                { key: 'app_version', label: '应用版本' },
                { key: 'screen_resolution', label: '屏幕分辨率' },
                { key: 'total_sessions', label: '会话数' },
                { key: 'total_events', label: '事件数' },
                { key: 'first_seen_at', label: '首次活跃', format: formatTime },
                { key: 'last_seen_at', label: '最后活跃', format: formatTime },
            ];
        } else {
            // 直接查询原始表（events, user_profile, user_tags）
            const { data: rawData, error } = await supa.from(type).select('*').order('ts', { ascending: false }).limit(100);
            if (error) {
                showMsg(`加载失败: ${error.message}`, 'error');
                return;
            }
            data = rawData;
            // Auto columns but format dates
            columns = Object.keys(data[0] || {}).map(k => {
                if (k.includes('_at') || k.includes('time') || k === 'ts') {
                    return { key: k, label: k, format: formatTime };
                }
                return k;
            });
        }

        renderTable(data, columns);
        showMsg(`已加载数据`, 'success');
    };

    // --- Init & Bindings ---
    document.getElementById('supabase-url').value = getConfig().supabaseUrl;
    document.getElementById('supabase-anon').value = getConfig().supabaseAnon;

    document.getElementById('save-config').onclick = () => {
      setConfig({
        supabaseUrl: document.getElementById('supabase-url').value,
        supabaseAnon: document.getElementById('supabase-anon').value
      });
      supabaseClient = null;
      showMsg('配置已保存', 'success');
    };

    document.getElementById('login').onclick = async () => {
      const supa = ensureSupabase();
      if (!supa) return;
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value.trim();
      if(!email || !password) {
          showMsg('请输入邮箱和密码', 'error');
          return;
      }
      const { error } = await supa.auth.signInWithPassword({ email, password });
      if (error) {
        showMsg(error.message, 'error');
      } else {
        showMsg('登录成功', 'success');
        updateAuthUI();
      }
    };

    document.getElementById('logout-btn').onclick = async () => {
      const supa = ensureSupabase();
      if (!supa) return;
      await supa.auth.signOut();
      showMsg('已退出登录', 'info');
      updateAuthUI();
      document.getElementById('table-container').innerHTML = '<div class="h-full flex flex-col items-center justify-center text-slate-400 py-12 space-y-2"><span class="text-sm">请先登录并加载数据</span></div>';
    };

    document.getElementById('load-charts').onclick = loadCharts;
    document.getElementById('load-combined').onclick = () => loadTableData('combined');
    document.getElementById('load-events').onclick = () => loadTableData('events');

    // Check auth on load
    setTimeout(updateAuthUI, 500);

  </script>
</body>
</html>
```
