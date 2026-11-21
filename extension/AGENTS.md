# AGENTS.md

本文是 `cc-3-8-x-mcp` 的 agent 使用规则。它只支持 Cocos Creator 3.8.x；项目自己的预览参数、业务本地服地址、测试账号和验证步骤写在项目文档里。

## 允许入口

使用本插件时，只允许从下面这些入口进入：

| 入口 | 用途 |
|---|---|
| 全局 `cocos-mcp-gateway` 注入的项目 tool | `scene` / `asset-db` / `preview` / `local` 域操作 |
| `cocos-mcp-cli` offline 命令 | `.prefab` / `.anim` 文件查询和修改 |
| Playwright / Chrome | 浏览器里真实游戏页面的交互验证 |
| `temp/refresh` 的 `restart-package` | 重启本扩展代码 |

项目扩展的 `/bridge` 是 Gateway 私有协议，agent 和其他 MCP 客户端不得直接调用、不得直接读取或复制注册记录中的 token。其它入口不作为本插件使用路径。

## 绑定当前项目

先调用公开的 `gateway_list_editors`。将任务目标工程和结果中的 `projectPath` 规范化为真实绝对路径并精确匹配，仅使用 `transport=editor-bridge`、`gatewayApiVersion>=2`、`bridgeApiVersion=1` 的实例。由此确定项目后，再使用 Gateway 为该实例公开的项目工具。简称或工具前缀不能单独用于选项目。

没有匹配项或无法唯一确定目标时，暂停涉及该实例的操作并报告。注册发现、心跳和鉴权由 Gateway 负责，客户端不扫描注册文件、读取 token 或直连私有 Bridge。

## Gateway Tool

同一真实路径对应多个在线实例时，根据已确认的目标编辑器选择其 `pid`。查询工具和执行调用都传同一组 `projectPath`、`pid`；无法确定目标时暂停。

优先使用 Gateway 的固定项目入口；会话启动后新增或切换编辑器时，无需等待客户端更新项目工具前缀：

```text
gateway_list_editors()
gateway_get_project_tools(projectPath=目标绝对路径, pid=目标进程号)
gateway_call_project_tool(projectPath=目标绝对路径, pid=目标进程号, toolName="local_get_status", arguments={})
```

以下带项目名前缀的工具仍可使用，但必须确认前缀与项目匹配：

```text
forest__preview_query_url
forest__asset_reimport
forest__preview_refresh_and_reload
```

如果只有旧前缀，使用固定项目入口。如果固定入口也不存在，先重新连接或升级全局 `cocos-mcp-gateway`。禁止把项目 `/bridge` 当成 HTTP MCP fallback。

## 预览 URL

预览 URL 只允许来自：

| 来源 | 说明 |
|---|---|
| `preview_query_url` | 首选 |
| `local_get_status` | 查预览端口、Bridge 状态、编辑器状态 |
| 项目文档明确声明的只读兜底文件 | 仅在 Gateway 不通时使用 |

没有项目文档声明时，不读取旧 `.dev/preview-url`，不猜 `localhost:7456`。

浏览器验证必须在 Gateway tool 返回的 URL 上追加唯一 `tid`：

```text
<preview_url>/?tid=<unique-id>
```

已有 query 时用 `&tid=`。本地服务器、测试账号、业务参数由项目文档声明。

## 资源修改后刷新

offline CLI 写入磁盘后，按[Prefab 直改后的核验流程](doc/prefab-direct-edit.md#offline-改完后的操作流程)选择步骤。定向导入检查资源，实例回读检查绑定；多个文件的修改本身不要求软重载或游戏预览。

扩展代码需重新加载时，`temp/refresh` 只承载 `restart-package`。

## CLI 与 MCP 分工

| 操作 | 推荐入口 |
|---|---|
| 查 prefab 节点树 / 组件字段 | `prefab_query` 或 `cocos-mcp-cli query` |
| 批量改 prefab | `prefab_edit` / `prefab_batch` 或 `cocos-mcp-cli batch` |
| 改 `.anim` 结构 | `cocos-mcp-cli anim` |
| 查 AssetDB 资源信息 | `asset_query_assets` / `asset_query_info` |
| 重导资源 | `asset_reimport` |
| 查场景运行态节点 | `scene_query_node_tree` / `scene_query_node` |
| 调组件方法或改运行态属性 | `scene_execute_component_method` / `scene_set_property` |
| 拿预览 URL | `preview_query_url` |
| 刷新资产并软重载当前编辑器场景 | `preview_refresh_and_reload`，传 `expectedAssetUuid` |

结构化资源文件优先走 CLI 或 MCP tool。纯文本说明文档才直接编辑。

## 浏览器验证

用户明确要求游戏预览时，由 Gateway 查询预览 URL，在 Playwright / Chrome 中验证真实页面。编辑器软重载只影响编辑上下文。

推荐流程：

```text
preview_query_url
browser_navigate -> <preview_url>/?tid=<unique-id>
browser_evaluate
browser_take_screenshot
```

## 失败处理

按顺序排查：

1. 列表中没有匹配项目：核对项目真实路径、编辑器及扩展状态。
2. 编辑器刚重启或实例失联：重新调用 `gateway_list_editors` 并匹配当前实例。
3. Editor Bridge 不通：先报告阻塞并保护未保存编辑；仅在重启属于已授权范围时重启扩展或编辑器，再重新绑定。
4. Gateway tool 返回的预览 URL 为空：确认编辑器预览已启动。
5. 工具行为异常或文档与实际不一致：反馈插件问题，由用户决定是否修插件本身。
