# 截图视觉回归

这组测试在独立的本地 Vite 服务器上运行真实的页面和 PNG 导出流程。所有聊天、联系人和群聊数据都是虚构的；测试拦截 `/api` 请求并禁止访问其他主机，不会读取本机聊天记录或调用真实后端。测试页面只用于开发服务器，不进入生产构建。

安装前端依赖后，首次运行需要安装浏览器：

```sh
cd frontend
npm ci
npx playwright install chromium firefox webkit
npm run test:visual
```

只跑一种浏览器：`npm run test:visual -- --project=chromium`。Linux 上 Playwright 可能需要 `npx playwright install --with-deps`；为覆盖中文字体，安装 Noto CJK 字体。CI 在 Linux 的 Noto CJK 和 macOS 的系统中文字体环境中分别运行，不将不同平台的整张图片强行与同一基准图逐像素比较。

也可以从仓库根目录通过 Playwright 容器运行，无须在宿主机安装 Node 或浏览器。源码只读挂载，依赖和结果放在临时容器中：

```sh
docker run --rm --ipc=host \
  --mount "type=bind,src=$PWD/frontend,dst=/source,readonly" \
  --workdir /tmp/welink mcr.microsoft.com/playwright:v1.65.0-noble \
  bash -lc 'cp /source/package.json /source/package-lock.json /source/vite.config.ts /source/tsconfig.json /source/tsconfig.node.json /source/postcss.config.js /source/tailwind.config.js /source/index.html /source/playwright.config.mjs . && cp -R /source/src /source/public /source/tests . && npm ci --no-audit --no-fund --registry=https://registry.npmjs.org/ && npm run test:visual'
```

容器镜像中的 Playwright 版本需与 `package-lock.json` 一致；容器销毁后，测试报告也会随之删除。需要保留报告时，应将测试输出目录单独挂载出来。

测试检查实际 PNG 中的标签文字与色块的相对位置、默认头像文字、聊天气泡及长图边界，并验证三种手机屏幕的精确输出尺寸。失败时 `frontend/test-results/` 保存测试截图、合成导出图片和 trace；CI 只在失败时上传这些虚构数据生成的文件。测试不保证识别所有内容截断或所有字体的排版问题，新增分享卡片或发现错位时应补充对应场景和可测的像素约束。
