---
name: cocos-mcp-control
description: 连接和控制当前工作区对应的 Cocos Creator 项目。处理 Cocos 编辑器启动与状态、场景和 AssetDB 操作、预览刷新、Prefab 或 Anim 查询修改、多项目实例选择，以及 cocos-mcp-cli 使用时触发。
---

# Cocos MCP 控制

## 绑定当前项目

1. 从当前工作目录向上寻找同时包含 `assets/`、`settings/` 和 `package.json` 的项目根。
2. 调用 `gateway_list_editors`，用规范化后的绝对 `projectPath` 精确匹配当前项目。不要只凭工具前缀或项目名猜实例。
3. 匹配后优先用 `gateway_get_project_tools(projectPath)` 读取该项目当前工具的原始名称、参数与 annotations，再用 `gateway_call_project_tool(projectPath, toolName, arguments)` 调用。两者为固定工具名，会话开始时没有编辑器、或后来切换项目也可使用；同项目有多个实例时显式传 `pid`。多个项目同时打开时只操作当前项目。
4. 没有匹配实例时，读取项目 `package.json` 的 `creator.version`，调用 `editor_spawn`，显式传绝对 `projectPath` 和版本，再等待就绪。
5. `gateway_list_editors` 只应返回 `transport=editor-bridge`、`gatewayApiVersion>=2`、`bridgeApiVersion=1` 的实例；旧项目 `/mcp` 不受支持。
6. Cocos Creator 3.8.x 项目缺少 `extensions/cc-3-8-x-mcp` 时：若用户要求接入项目，运行 `cocos-mcp-connect <项目绝对路径>`；若当前任务未授权安装扩展，则停止并说明缺失。非 3.8.x 项目不得安装此扩展。

## 选择入口

- `.prefab`、`.anim` 的结构化查询与修改：优先使用全局 `prefab_query`、`prefab_edit`、`prefab_batch`；路径必须为绝对路径。
- 场景运行态、AssetDB、预览和编辑器状态：优先使用 Gateway 的固定项目入口；客户端已注入且与目标匹配的 `<shortName>__*` 工具也可使用。不得将过期前缀自动映射到其他项目。
- 项目扩展的 `/bridge` 是 Gateway 私有协议；不要直接调用、不要把它注册成 MCP Server，也不要输出注册记录里的 token。
- 浏览器中的真实交互：先用 MCP 获取预览 URL，再交给可用的浏览器工具。
- 纯文本源码和文档：使用普通文件工具，不走 Prefab CLI。

修改 Prefab 前先查询节点树或字段；批量修改先 dry-run；任一操作失败时不要绕过 CLI 直接改 JSON。

## 打开并回读 Prefab

先调用项目的 scene_query_context。需要切换时调用 prefab_open({asset})，优先传完整 db://assets URL。同名资源按 UUID 区分，仅在 opened 或 already_open 后使用返回的 rootUuid 查询节点。blocked 表示未保存或状态不确定，请用户处理。busy、pending、unconfirmed 时先查询上下文，不重试切换或代为保存。若迟到请求一直无法确认，由用户在编辑器中打开请求的目标并确认上下文后再继续。

## 修改后的闭环

只核对本次修改的资源、节点和字段；纯文档修改不触发资源导入。

1. 写盘后核对序列化差异与目标字段，保留无关改动，不能以工具返回 `ok` 代替验证。
2. 导入前确认目标资源没有会被覆盖的未保存编辑；不能确认时暂停可能覆盖编辑的操作并询问用户。单资源按需 `asset_reimport`；多资源或依赖不明时选择必要范围的 `asset_refresh`，不默认刷新预览。
3. 对已加载的目标实例，用当前项目的 `scene_query_node_tree` 定位节点，再用 `scene_query_node` 回读本次涉及的组件字段，对比磁盘预期值。磁盘节点标识与加载实例 UUID 不可混用。
4. 不一致时先检查未保存编辑、目标实例身份及 Prefab override；不得自动保存、丢弃编辑或重开场景。确认安全后最多做一次定向重导入；需要重载实例时先确认安全与授权。
5. 重导入或重载后重新查询节点树取得当前实例 UUID，再回读字段；不能复用旧实例 UUID。仍不一致就报告预期值、实际值和验证边界，不无限重试。
6. 当前没有目标加载实例、工具无法提供字段或编辑器未启动时，明确说明“仅静态验证，实例回读未完成”；不为补齐检查擅自启动、切换场景或覆盖未保存内容。身份和引用的核对细节见 [操作参考](references/operations.md#字段回读闭环)。

上述字段核对通常通过 MCP 即可完成，不要求截图、浏览器或游戏预览。视觉、动画、输入和生命周期效果仍需单独验证；仅在任务授权及项目约定允许时刷新/运行预览。类型检查按实际修改类型执行，字段一致不等于运行或视觉验收通过。

## 安全边界

- 重启或关闭编辑器前先确认目标 `projectPath`；工具报告存在活跃调试连接时，不传 `force` 绕过。
- `editor_spawn`、`editor_restart`、`editor_wait_ready` 在编辑器未注册时必须显式传绝对项目路径。
- 工具行为、文档与实际不一致时报告插件问题，不在业务项目添加临时 workaround。
- 若只看到旧项目工具前缀，先检查是否有固定项目入口；有则按目标 `projectPath` 查询和调用，无需重启 Creator。若固定入口也不存在，说明当前连接仍加载旧版 Gateway，需要重连 MCP 或在加载新版插件后启动新会话。
- 详细工具分工和失败排查见 [references/operations.md](references/operations.md)。
