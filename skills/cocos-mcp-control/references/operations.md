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
| 获取或刷新预览 | `<shortName>__preview_query_url` / `<shortName>__preview_refresh_and_reload` |

## 项目识别

优先用当前工作区的真实绝对路径匹配注册项的 `projectPath`。符号链接路径需先规范化。同名项目或多个 worktree 不能只用 `shortName`。

编辑器未启动时：

1. 确认 Creator 版本为 3.8.x，且项目存在 `extensions/cc-3-8-x-mcp`。缺失时运行 `cocos-mcp-connect <项目绝对路径>`，该命令不会覆盖已有扩展。非 3.8.x 项目停止安装。
2. 从 `package.json` 读取 `creator.version`。
3. 调用 `editor_spawn`，传入绝对 `projectPath` 和 `version`。
4. 启动超时但检测到进程时，用 `editor_wait_ready` 等待，不重复启动。

## 常见失败

- 没有项目注册：编辑器未启动，或项目侧扩展未启用。
- 注册存在但 `/bridge` 不通：等待扩展完成启动；仍失败时由用户决定是否重启扩展或编辑器。不要把 Bridge 当成 MCP endpoint 直接调用。
- offline 修改后界面不变：按下述字段回读闭环检查导入、目标实例及 override；不默认刷新预览或重开场景。
- 工具前缀变化：重新调用 `gateway_list_editors`，以当前返回的 `shortName` 为准。
- Prefab 修改报结构错误：停止修改，先查询节点、stub 和 override；禁止直接文本编辑 JSON 数组。

## 字段回读闭环

- 写盘前后用资源路径、节点层级及组件类型锁定目标，保留本次字段的预期值。查询结果过大时只提取涉及的字段，避免整场景重复扫描。
- `scene_query_node_tree` / `scene_query_node` 查询的是当前编辑器加载场景或 Prefab 编辑上下文，不自动代表浏览器运行实例。目标未加载时报告缺失，不把其他同名节点作为验收对象。
- 重新获取实例 UUID 时结合层级、父节点及组件类型核对身份；同名歧义无法消除就停止。资源 UUID、Prefab fileId、序列化数组索引均不能直接作为实例 UUID 使用。
- 标量、枚举、向量逐项核对；资源引用先通过 AssetDB 确认对应资源身份，节点/组件引用核对实际指向的实例。不要仅比较显示名称或将两种序列化表示直接按字符串比较。
- 不一致可能来自未保存编辑、实例 override、错误目标或未完成导入；不要直接判定缓存损坏。当前工具没有可靠的未保存状态证据时，应询问用户，不得把查询失败或 `ok` 当作“无未保存编辑”。
- 安全重导入后重新查询节点树和字段；如果还需切换/重开场景、保存或放弃编辑，先取得相应授权。一次纠正后仍不一致则报告差异，不自动强制覆盖。
- 交付分别说明磁盘差异、导入结果、实例字段回读及未做的运行/视觉验证。无法执行某一层时注明原因，不将上一层通过写成下一层通过。
