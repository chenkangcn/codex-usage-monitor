# Codex 五小时用量监控器 / Codex Five-Hour Usage Monitor (macOS)

一个无第三方依赖的本地 Node.js 小工具。它从 Codex 本地 JSONL 事件中寻找最新的五小时（300 分钟）限额记录，生成稳定的状态 JSON，并在用量每跨过 10% 时发送 macOS 系统通知。

A dependency-free local Node.js utility. It finds the latest five-hour (300-minute) rate-limit record in Codex's local JSONL events, writes a stable JSON status file, and sends a macOS system notification whenever usage crosses another 10% milestone.

它不调用 OpenAI API，也不会消耗 Codex 用量。扫描时先用 `rate_limits` 文本预筛，只解析 `event_msg/token_count` 事件；不会保存或输出提示词、回复或其他会话正文。

It does not call the OpenAI API or consume Codex usage. The scanner first prefilters lines for `rate_limits` and only parses `event_msg/token_count` events. It never stores or outputs prompts, responses, or other conversation content.

## 行为 / Behavior

- 用量跨过 10%、20%、30%……100% 时分别通知；每个里程碑在同一窗口只通知一次。  
  Notifications are sent at 10%, 20%, 30% … 100%; each milestone is sent only once per window.
- 如果一次检查跨过多个里程碑，只发送当前最高档的一条通知，避免通知轰炸。  
  If one check jumps across several milestones, only the current highest milestone is reported to avoid notification spam.
- 剩余 `< 20%`（即使用量 `> 80%`）时进入 `severe` 并显示严重警告；剩余 `< 10%`（即使用量 `> 90%`）时进入 `critical` 并显示紧急警告。边界值 20% 和 10% 分别仍属于前一级。  
  When remaining allowance is `< 20%` (usage `> 80%`), status becomes `severe`; below `10%` (usage `> 90%`), it becomes `critical`. Exact boundary values of 20% and 10% remain in the preceding level.
- 去重窗口键是 `resets_at`。新窗口出现后会重新允许各个里程碑通知。  
  The deduplication window key is `resets_at`. Every milestone becomes eligible again in a new window.
- 已过期、缺失或无效的记录产生 `no_data`，不会通知。  
  Expired, missing, or invalid records produce `no_data` and do not trigger a notification.
- 同时扫描 `~/.codex/sessions` 和 `~/.codex/archived_sessions`，严格忽略非 `.jsonl` 备份文件。  
  Both `~/.codex/sessions` and `~/.codex/archived_sessions` are scanned; backup files that do not end in `.jsonl` are ignored.
- 文件按 mtime 倒序检查，并从末尾反向分块查找。找到有效事件后可安全剪枝更旧文件，避免周期性全量读取大型会话目录。  
  Files are checked by descending mtime and read backward in chunks. Once a valid event is found, older files can be safely pruned, avoiding repeated full scans of large session directories.

状态写到 `~/.codex/usage-monitor/state.json`，权限为当前用户可读写，字段固定如下：

The status is written to `~/.codex/usage-monitor/state.json`, readable and writable only by the current user, with the following stable fields:

```json
{
  "status": "ok",
  "usedPercent": 63,
  "remainingPercent": 37,
  "windowMinutes": 300,
  "resetsAt": "2026-07-11T11:47:12.000Z",
  "lastCheckedAt": "2026-07-11T07:10:00.000Z",
  "sourceUpdatedAt": "2026-07-11T07:09:32.000Z"
}
```

`status` 为 `ok`、`severe`、`critical` 或 `no_data`。没有有效数据时，限额相关字段为 `null`。该文件不包含源文件路径、会话 ID、模型输入或输出，可供其他本地工具读取。

`status` is one of `ok`, `severe`, `critical`, or `no_data`. Rate-limit fields are `null` when no valid data is available. The file contains no source path, session ID, model input, or model output and can be consumed by other local tools.

## 命令 / Commands

要求本机 Node 位于 `/opt/homebrew/opt/node@22/bin/node`。

Node is expected at `/opt/homebrew/opt/node@22/bin/node`.

运行测试、执行一次检查、查看状态：

Run the tests, perform a one-time check, and inspect the current status:

```sh
npm test
npm run run-once
/opt/homebrew/opt/node@22/bin/node bin/codex-usage-monitor.js status
```

安装 LaunchAgent。执行后会立即加载，并默认每 3 分钟运行一次：

Install the LaunchAgent. It is loaded immediately and runs every three minutes by default:

```sh
/opt/homebrew/opt/node@22/bin/node bin/codex-usage-monitor.js install
```

停止并卸载：

Stop and uninstall:

```sh
/opt/homebrew/opt/node@22/bin/node bin/codex-usage-monitor.js uninstall
```

安装会创建 `~/Library/LaunchAgents/com.local.codex-usage-monitor.plist`。LaunchAgent 使用固定参数直接启动 Node，不经过 shell。通知内容通过 `osascript` 的 argv 传递，不会拼接到 AppleScript 源码中。

Installation creates `~/Library/LaunchAgents/com.local.codex-usage-monitor.plist`. The LaunchAgent starts Node directly with fixed arguments and does not invoke a shell. Notification text is passed through `osascript` argv rather than interpolated into AppleScript source.

## 配置 / Configuration

可选配置文件位于 `~/.codex/usage-monitor/config.json`：

The optional configuration file is `~/.codex/usage-monitor/config.json`:

```json
{
  "alertStepPercent": 10,
  "severeThreshold": 80,
  "criticalThreshold": 90,
  "checkIntervalSeconds": 180
}
```

`alertStepPercent` 控制通知步长，当前默认为 10。检查间隔最小为 30 秒。修改检查间隔后请再次执行 `install`，让 plist 中的间隔生效。`CODEX_USAGE_MONITOR_DATA_DIR` 环境变量可为测试或集成指定另一状态目录；LaunchAgent 默认不设置它。

`alertStepPercent` controls the notification interval and currently defaults to 10. The minimum check interval is 30 seconds. Run `install` again after changing the check interval so the value in the plist is refreshed. `CODEX_USAGE_MONITOR_DATA_DIR` can select a different state directory for testing or integration; the LaunchAgent does not set it by default.

## 权限与排错 / Permissions and Troubleshooting

首次通知时，macOS 可能要求允许通知；请在“系统设置 → 通知”中检查 `osascript` 或脚本宿主的通知权限。工具以当前登录用户运行，通常可直接读取同一用户的 `~/.codex`。如果系统隐私设置阻止访问，请在“隐私与安全性”中为实际运行它的终端或宿主授权。

macOS may request notification permission the first time a notification is sent. Check the notification settings for `osascript` or the script host under System Settings → Notifications. The utility runs as the current user and can normally read that user's `~/.codex`. If macOS privacy controls block access, grant the required permission to the terminal or host that actually runs it under Privacy & Security.

常用检查命令 / Useful diagnostic commands:

```sh
/opt/homebrew/opt/node@22/bin/node bin/codex-usage-monitor.js status
tail -n 50 ~/.codex/usage-monitor/monitor.log
plutil -lint ~/Library/LaunchAgents/com.local.codex-usage-monitor.plist
launchctl print gui/$(id -u)/com.local.codex-usage-monitor
```

LaunchAgent 自动执行时采用 `--quiet`，正常检查不写日志；`monitor.log` 主要记录启动或运行错误。如果状态为 `no_data`，请先运行一次 Codex 任务以产生新的 `token_count` 事件，再执行 `run-once`。损坏的 JSON 行会被忽略，不会中止扫描。

Automatic LaunchAgent runs use `--quiet`, so successful checks do not write log entries; `monitor.log` mainly records startup or runtime errors. If the status is `no_data`, run a Codex task to generate a fresh `token_count` event, then execute `run-once`. Malformed JSON lines are ignored and do not abort the scan.

## 文件位置与隐私边界 / File Locations and Privacy Boundary

| 用途 / Purpose | 路径 / Path |
| --- | --- |
| 输入 / Input | `~/.codex/sessions/**/*.jsonl`, `~/.codex/archived_sessions/*.jsonl` |
| 公共状态 / Public status | `~/.codex/usage-monitor/state.json` |
| 内部通知去重 / Internal notification deduplication | `~/.codex/usage-monitor/.notification-state.json` |
| 可选配置 / Optional configuration | `~/.codex/usage-monitor/config.json` |
| 错误日志 / Error log | `~/.codex/usage-monitor/monitor.log` |
| LaunchAgent | `~/Library/LaunchAgents/com.local.codex-usage-monitor.plist` |

工具不会联网，不会调用 OpenAI API，也不会把会话正文写入状态或日志。内部去重文件只保存重置时间和已通知的用量里程碑。

The utility does not access the network, call the OpenAI API, or write conversation content to its status or logs. The internal deduplication file stores only the reset time and usage milestones already reported.

## 兼容性说明 / Compatibility Notice

Codex 本地事件格式不是官方稳定 API。Codex 升级后字段结构可能变化，届时需要适配解析器。当前实现兼容实测的 `payload.rate_limits.primary`，并保留对少数相近旧路径的读取兼容，但仍严格要求顶层 `event_msg` 和 `payload.type=token_count`。

Codex's local event format is not an officially stable API. Field structures may change after a Codex upgrade, in which case the parser may need to be adapted. The current implementation supports the observed `payload.rate_limits.primary` structure and retains compatibility with a few similar legacy paths, while still requiring a top-level `event_msg` and `payload.type=token_count`.
