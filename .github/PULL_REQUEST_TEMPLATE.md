<!--
感谢贡献！提 PR 前请花 30 秒过一遍下面的清单。
如果是改文档 / 修 typo，大部分可以跳。
-->

## 这个 PR 做了什么

<!-- 一句话概括。关联的 issue 可以用 `Fixes #123` -->

## 为什么要改 / 解决了什么问题

<!-- 背景 + 用户看到的差异。和 issue 的联系也在这里说 -->

## 改动清单

<!-- 分 bullet 列；跨文件 / 跨模块的改动请分块 -->

- [ ]
- [ ]

## 测试 / 验证

<!-- 截图 / GIF / 手动测试的步骤 / 是否跑了单元测试 -->

## 自检 Checklist

- [ ] 代码 build 通过（`go build` + `npm run build`）
- [ ] 类型检查通过（`cd frontend && npx tsc --noEmit`）
- [ ] 如果加了新 API，更新了 `docs/api.md` 和 `backend/swagger.go`
- [ ] 如果加了新功能，在 `docs/ux.md` / 相关文档里说明
- [ ] Commit message 用 [Conventional Commits](https://www.conventionalcommits.org/)（`feat:` / `fix:` / `docs:` 等）
- [ ] 每个 commit 都已 sign off：`git commit -s`（DCO 要求，见 [贡献指南](https://welink.click/contribute)）

## 其他（可选）

<!-- 性能影响 / 破坏性变更 / 需要迁移脚本 / 需要特定配置 / 依赖新包 等 -->
