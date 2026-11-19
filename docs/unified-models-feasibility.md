# 原模型页统一编辑器：公开插槽可行性实测

2026-11-19。本轮按已批准的方案先验证三个前提；未改动生产组件、宿主程序、本机插件安装或用户模型配置。

## 结果

| 前提 | 实测结果 | 证据范围 |
| --- | --- | --- |
| 覆盖原“模型”标签，不增加第二标签 | 通过 | 真实 SlotCore，`settings.section` / `id: models` / `priority: -10` |
| 移除覆盖注册后恢复原生页面 | 通过 | 原生注册仍在；覆盖注册的 disposer 执行后恢复原赢家 |
| 替换页继续承载原供应商扩展和页脚 | 未满足 | 原子插槽的所有权不随同 ID 的覆盖注册转移 |

这里的前两项是插槽核心测试，不代表已完成完整模型页的浏览器或真机验收。

## 具体障碍

原生模型页注册同时声明 `settings.models.provider-card` 和 `settings.models.footer`。其他插件向这两个子插槽贡献内容。

新页面使用同一个 `models` ID 可以覆盖原页面，但它没有自动获得这两个子插槽的所有权：

- 重新声明时报 `slot "settings.models.provider-card" is already declared`；页脚同理。
- 不声明而直接渲染时，实际宿主渲染器报 `SlotOwnershipError: slot 'settings.models.provider-card' is not declared by this entry's children`；页脚同理。
- 原生注册释放后，原有子插槽随之释放；保留的原渲染授权会抛出 `StaleAuthorizationError`，不能作为可靠转接手段。

已核对实现：纯核心 `SlotCore.register` 的声明去重，宿主 renderer 的逐 entry 子插槽授权。没有找到可公开调用的子插槽所有权转交接口。本轮没有使用私有状态、借用原组件授权、隐藏 DOM 或修改宿主源码绕开这些约束。

## 复现

测试文件：`test/models-page-feasibility.test.mjs`。

测试使用 registry.npmjs.org 公开发布的 `@deepseek-ai/dsh-client-ui-slots@0.2.2-rc.1`；宿主为本机 DSH 0.2.2-rc.1 的实际 `dsh-client-ui-renderer`。渲染器测试仅在内存中暴露已有授权闭包以断言行为，不修改磁盘文件，也不向生产包引入私有模块。

```sh
DSH_SLOT_CORE=/tmp/dsh-groups-slot-core/package/lib/index.js \
DSH_ROOT=/opt/dsh \
DSH_UI_TEST_TOOLS=/tmp/dsh-groups-ui-tools/package.json \
node --test test/models-page-feasibility.test.mjs
```

缺少这些显式测试环境变量时，本文件跳过探针，不增加生产依赖。

## 本轮验证及本机状态

显式启用上述探针后，4 项断言全部通过、0 项跳过，其中两项确认替换/恢复行为，两项确认声明冲突与渲染授权限制；这不是“统一页面已验收通过”。

只读核对本机仍安装 `0.4.0-alpha.12`，迁移记录 1 项且已激活，10 个密钥组、42 个模型；5 个历史补丁目标均为 `pristine`。本轮没有安装新包、重启引擎或改动这些配置。

## 决策

按批准方案中的“任何一个前提不成立就停止并报告”，本轮停止整页替换实现与安装。当前结果不意味着多密钥本身不可实现，而是现有替换方案尚不能同时满足保留第三方扩展这一硬条件。

优先的后续接口设计是让原生模型页提供供应商编辑器替换插槽：原生页面继续负责目录、账户、页脚和扩展区，插件只接管多密钥供应商的编辑器。另一种需要宿主支持的设计是明确的子插槽授权转交机制。两者都涉及宿主能力变化，应单独评审；不能伪装成目前已有的通用插件接口。
