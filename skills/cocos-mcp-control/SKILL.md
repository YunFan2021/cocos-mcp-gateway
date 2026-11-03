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

先调用 scene_query_context，检查 reason 和 diagnostics。默认查询总预算 3000ms，未知 dirty 不能视为已保存。用 prefab_open({asset}) 打开本项目资源，返回 operationId、phase、startedAt（Unix 毫秒）、elapsedMs、dispatched、settled 和最后上下文。仅 opened/already_open 可回读实例。busy/pending/unconfirmed 时调用 prefab_query_open({operationId}) 诊断，禁止重复发起切换。预检超时且 dispatched=false 时可重新检查后再操作。已发出请求只有在消息结束且目标实际加载后，状态查询才解除保护；请求一直不结束时保留保护，需要人工确认 Creator 状态。查询不会取消 Creator 请求。扩展重载后旧 operationId 返回 not_found，不能以此认定旧请求已取消。

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


### 编辑写入保护

- scene_open_scene、scene_soft_reload、scene_save_scene、scene_set_property 和 preview_refresh_and_reload 与 prefab_open 共用操作锁及迟到消息保护。
- scene_save_scene 和 preview_refresh_and_reload 必须传 expectedAssetUuid。保存需要用户已授权保存该资源，工具不自动保存或丢弃未保存编辑。其他受保护入口可传 expectedAssetUuid 检测调用前的页面切换。
- 这些受保护工具返回结构化 status，completed 表示操作完成，blocked 表示上下文冲突或未保存，unconfirmed/pending 时用 prefab_query_open 查询操作。不得再把任意非空返回值视为成功。
- scene_set_property 配对 begin-recording/end-recording，保证 Creator 修改记录及 dirty 状态正确；失败时保留诊断及迟到保护，不自动回滚其他编辑。
- Bridge 验证现有 inputSchema 的类型、必填字段、枚举及顶层未知字段。dump 和脚本 args 的开放内容仍按工具声明处理。参数错误返回 isError 与 INVALID_ARGUMENTS，不发送 Editor 消息。
- 共享锁覆盖以上命名入口；scene_execute_script 和 scene_execute_component_method 属于显式执行能力，仍需调用者根据具体方法检查副作用。

### 资源确认、绑定校验与维护身份

- asset_reimport_confirm 传 url 和 expectedAssetUuid，复用编辑锁。import.status=imported 表示指定资源完成重导入且源文件/meta 哈希稳定，instanceVerified=false 表示仍需另查实例。返回 source_changed、unconfirmed 或外层 pending 时不能当作成功。
- scene_verify_bindings 为只读工具，传 expectedAssetUuid 和 checks 数组，每项包含 nodeUuid、componentType、field、expected（UUID 或 UUID 数组）及可选 expectedType。核对数量、顺序、空引用、引用可解析性；上下文或字段二次读取发生变化返回 invalidated。
- local_query_identity 比较扩展启动时的 loaded 与当前 disk 身份。maintenance-manifest.json 明确覆盖 main.js、package.json 和 server 生产模块，按规范化换行后的内容哈希标识，不声称覆盖 CLI、引擎或游戏业务。
- Gateway 的 scripts/check-extension.js <扩展绝对目录> 只读比较模板与安装副本。matched 返回0；local_changes、different_baseline、unknown 返回1，均不覆盖文件。connect-project 对已有安装也执行同样核验。
- 更新模板时按 maintenance-manifest.json 的文件清单同步生产入口并核对哈希，源码、模板、项目副本分别检查；本地差异需先处理。运行身份仍须在重新加载扩展后通过 local_query_identity 确认。
