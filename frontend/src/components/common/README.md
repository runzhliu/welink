# WeLink 共用控件

页面使用这里的控件维护一致的浅色、深色、键盘操作和浮层行为。不要在业务页面新增原生 `select`、`datalist` 或日期/时间弹出选择器。

- `Select`：固定选项，`value` + `onValueChange(string)`；支持 `options` 数据或 JSX `option` 描述（不会生成原生下拉）。超过 8 项自动提供搜索，支持方向键、Enter、Escape、Tab、禁用选项和空结果。
- `ComboBox`：允许自由输入的推荐列表，适用于自定义模型和声音。`options` 只提供建议，不限制输入值。
- `DatePicker`：日期值保持 `YYYY-MM-DD`，支持 `min`、`max`、清除、今天、年月切换，以及方向键、Home/End、PageUp/PageDown。
- `TimePicker`：时间值保持 `HH:mm`，小时与分钟使用同一套 `Select`。
- `Popover`：统一浮层定位、窗口边界、滚动跟随、外部点击和逐层 Escape；在父弹窗内部挂载以保留焦点边界。
- `Avatar`：传入联系人资料及可选的接口头像，优先尝试当前联系人的小图、大图，再尝试接口图片；全部不可用时显示姓名首字。外部图片统一走头像代理。
- `Dialog` / `Switch`：统一弹窗焦点管理与开关交互。

为控件提供具体的 `aria-label` 或关联的 `label`，例如“开始日期”“模型提供商”，不要只用图标或颜色传达含义。颜色与浮层样式统一在 `src/index.css` 中维护。

运行 `npm run test:ui` 验证搜索、键盘选择、禁用态、嵌套弹窗、日期边界和头像回退；`npm run build` 负责全量类型检查与生产构建。
