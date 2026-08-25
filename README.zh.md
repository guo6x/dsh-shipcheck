# 🚢 dsh-shipcheck —— 交付前先拿证据

[![ci](https://github.com/guo6x/dsh-shipcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/guo6x/dsh-shipcheck/actions/workflows/ci.yml) · [English](README.md) · [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件

> 前端不是因为 agent 说“看起来不错”就能交付；真实浏览器跑出证据，才算完成验收。

`dsh-shipcheck` 是 DeepSeek Harness 的证据优先前端交付验收插件。它调用 `dsh-pilot` 打开真实页面，再生成确定性的检查结果、截图、命名基线和可复现 JSON 报告。它不会修改项目，也不会替你忽略失败项。它的证据格式已经为下一阶段接入 `dsh-palate` 的高层设计判断留好接口。

## 它解决什么问题

设计库给建议，浏览器插件给双手；Shipcheck 先把事实证据闭环，后续再接入 palate 的设计判断，不让主观评分替代证据：

```text
项目 URL → 真实浏览器 → 页面证据 → 确定性检查 → 基线对比 → 带截图报告
```

首版检查：

- 页面可用性、标题、可见正文和主标题
- 图片缺少替代文本、控件/链接缺少可访问名称
- 当前视口下的横向溢出
- 必须出现/禁止出现的文字、必须存在的 CSS selector
- 与明确命名基线之间的结构回归
- 浏览器运行时故障：控制台错误、未捕获异常、失败请求和 HTTP 4xx/5xx

每个失败项都会附带具体证据。只有显式调用 `shipcheck_baseline` 才会写入基线；普通验收不会覆盖已有基线。

## 工具

| 工具 | 作用 |
|---|---|
| `shipcheck_run` | 用真实浏览器检查 URL，对比基线，保存截图和 JSON 报告 |
| `shipcheck_baseline` | 显式把人工确认过的页面保存为命名结构基线 |
| `shipcheck_history` | 查看最近报告及通过/失败摘要 |

Web 面板提供同样的本地闭环：侧边栏点 `🚢`，输入开发服务器地址，点“验收”，查看状态、失败证据、截图路径和历史记录。

## 90 秒安装体验

```sh
dsh plugin --profile web add github:guo6x/dsh-pilot
dsh plugin --profile web add github:guo6x/dsh-shipcheck
```

重启 `dsh web`，打开侧边栏的 `🚢` 按钮，输入 `http://127.0.0.1:3000` 之类的本地地址。

也可以让 agent 执行：

> 用 `shipcheck_run` 检查 `http://127.0.0.1:3000`，项目名为 `checkout`，要求页面出现“Checkout”，禁止出现“Something went wrong”，告诉我是否可以继续人工验收。不要修改文件。

人工确认页面没问题后：

> 用 `shipcheck_baseline` 把当前 checkout 页面保存为 `checkout` 基线，再运行一次 `shipcheck_run`，如果有结构回归，说明变化和证据路径。

证据默认保存在 `$DSH_HOME/shipcheck/`：

```text
shipcheck/
├── artifacts/       # 页面截图
├── baselines/       # 显式保存的命名基线
└── reports/         # 最近 JSON 报告，最多保留 100 条
```

不需要 API key、云端面板、embedding 服务，也不需要自动写项目。`dsh-pilot` 作为同一 profile 的配套插件单独安装，这是因为 DSH 会阻止插件依赖里再嵌套 GitHub 仓库；如果缺少它，Shipcheck 会明确提示安装命令。

## 诚实边界

- 这是交付验收门，不是完整的跨操作系统像素级视觉回归实验室；首版基线比较稳定结构和文本漂移，不宣称不同机器上的截图像素完全一致。
- 首版还不会用 dsh-palate 原则给页面打分；当前先把供下一阶段使用的证据结构保存下来。
- 运行时证据通过浏览器 CDP 事件采集；如果配套浏览器不提供该能力，Shipcheck 会明确报告 warning，而不是假装运行时没有问题。
- 自动检查通过后，产品语义、内容质量和有意设计例外仍需要人工确认。

## 开发

```sh
pnpm install
pnpm test
```

核心测试使用伪造页面证据，不依赖浏览器；真实浏览器路径在 DSH Web profile 中调用 `shipcheck_run` 时运行。

MIT 协议。
