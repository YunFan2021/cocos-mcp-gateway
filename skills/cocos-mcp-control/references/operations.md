# Cocos MCP 操作参考

## 工具分工

| 目标 | 入口 |
|---|---|
| 列出活跃编辑器 | `gateway_list_editors` |
| 启动、等待、重启、关闭编辑器 | `editor_spawn` / `editor_wait_ready` / `editor_restart` / `editor_kill` |
| 查询或批量修改 Prefab | `prefab_query` / `prefab_edit` / `prefab_batch` |
| 查询场景运行态节点 | `<shortName>__scene_query_node_tree` / `<shortName>__scene_query_node` |
| 修改运行态属性或执行组件方法 | `<shortName>__scene_set_property` / `<shortName>__scene_execute_component_method` |
| 查询和重导资源 | `<shortName>__asset_query_*` / `<shortName>__asset_reimport` |
| 确认导入 / 回读资源绑定 | `asset_reimport_confirm` 核对导入状态；`scene_verify_bindings` 只读比对目标实例字段 |
| 刷新资产并软重载当前编辑器场景 | 确有需要且目标一致、无未保存编辑时调用 `preview_refresh_and_reload`，传 `expectedAssetUuid`；随后回读实例 |
| 验证游戏画面或交互 | 用户明确要求预览时，用 `preview_query_url` 查询地址，通过浏览器进入目标页面验证 |

## 项目识别

先调用 `gateway_list_editors`，将规范化的项目真实绝对路径与 `projectPath` 精确匹配。优先用 `gateway_get_project_tools` 查询工具定义，再用 `gateway_call_project_tool` 调用原始工具名（不带前缀）。同项目多实例时两个调用均传同一个已确认的 `pid`。表中的带前缀形式仅用于当前会话已注入且确认匹配的工具。

编辑器未启动时：

1. 确认 Creator 版本为 3.8.x，且项目存在 `extensions/cc-3-8-x-mcp`。缺失时运行 `cocos-mcp-connect <项目绝对路径>`，该命令不会覆盖已有扩展。非 3.8.x 项目停止安装。
2. 从 `package.json` 读取 `creator.version`。
3. 调用 `editor_spawn`，传入绝对 `projectPath` 和 `version`。
4. 启动超时但检测到进程时，用 `editor_wait_ready` 等待，不重复启动。

## 常见失败

- 没有项目注册：编辑器未启动，或项目侧扩展未启用。
- 注册存在但 `/bridge` 不通：等待扩展完成启动；仍失败时由用户决定是否重启扩展或编辑器。不要把 Bridge 当成 MCP endpoint 直接调用。
- offline 修改后界面不变：按下述字段回读闭环检查导入、目标实例及 override；不默认刷新预览或重开场景。
- 工具前缀变化：重新列出实例并按真实绝对路径匹配，再通过固定入口调用。
- Prefab 修改报结构错误：停止修改，先查询节点、stub 和 override；禁止直接文本编辑 JSON 数组。

## 字段回读闭环

- 写盘前后用资源路径、节点层级及组件类型锁定目标，保留本次字段的预期值。查询结果过大时只提取涉及的字段，避免整场景重复扫描。
- `scene_query_node_tree` / `scene_query_node` 查询的是当前编辑器加载场景或 Prefab 编辑上下文，不自动代表浏览器运行实例。目标未加载时报告缺失，不把其他同名节点作为验收对象。
- 重新获取实例 UUID 时结合层级、父节点及组件类型核对身份；同名歧义无法消除就停止。资源 UUID、Prefab fileId、序列化数组索引均不能直接作为实例 UUID 使用。
- 标量、枚举、向量逐项核对；资源引用先通过 AssetDB 确认对应资源身份，节点/组件引用核对实际指向的实例。不要仅比较显示名称或将两种序列化表示直接按字符串比较。
- 不一致可能来自未保存编辑、实例 override、错误目标或未完成导入；不要直接判定缓存损坏。当前工具没有可靠的未保存状态证据时，应询问用户，不得把查询失败或 `ok` 当作“无未保存编辑”。
- 安全重导入后重新查询节点树和字段；如果还需切换/重开场景、保存或放弃编辑，先取得相应授权。一次纠正后仍不一致则报告差异，不自动强制覆盖。
- 交付分别说明磁盘差异、导入结果、实例字段回读及未做的运行/视觉验证。无法执行某一层时注明原因，不将上一层通过写成下一层通过。


## 超时操作恢复

1. 先查询旧 operationId，区分等待超时、请求迟到成功、请求明确失败及传输结果或错误类别未知。检查 kind、requestOutcome、requestError、settledAt 和 lockActive，不能只读 status 或初次 TIMEOUT。
2. failed 且 lockActive=false 表示失败已经收尾；保留失败报告，再继续其他授权操作，不自动重放保存、导入或属性写入。superseded 只表示成功消息后的旧上下文已被人工接手，仍须回读当前目标实例。
3. 人工切页后将新查到的资源 UUID 和根 UUID 传给 prefab_recover_operation。参数不匹配、上下文变化、未保存或远端副作用未知时均不解除保护。
4. already_open/readOnly=true 允许只读验证当前实例，blockingOperation 保留旧操作诊断。它不表示旧重载成功，也不允许绕开锁写入。
5. 请求一直未结束或传输结果或错误类别未知时，不盲目重试或热重载扩展清锁；先保留证据并检查 Creator。进程重启是终止旧进程请求的维护手段，必须保护未保存编辑、核对目标项目且不能绕过活跃调试保护。

扩展回归入口为 `node --test server/test/*.test.js`。恢复用例覆盖迟到成功/失败、传输断连、脏或变化中的上下文、人工接手、只读回读和后续切换；替身测试不替代 Creator 实际消息与实例回读。
