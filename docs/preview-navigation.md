# 预览导航

缩放、鼠标拖拽、触控缩放、滚轮平移和位置边界由 `react-zoom-pan-pinch` 管理。`DevicePreview` 负责设备真实视口、旋转外壳、内容边界和已有工具栏的对接，不再维护另一套手势坐标或缩放动画。

`server/previewNavigation.ts` 是 iframe 适配：内部有可滚动内容时优先原生滚动；滚动容器在对应方向声明 `overscroll-behavior: contain` 或 `none` 时，到达边界后仍保留原生滚动隔离。未声明隔离、内部不能继续滚动且画布可平移时，把滚轮消息交给外层库。Ctrl / Meta + 滚轮交给库缩放。来源必须是当前预览的 iframe，消息数值必须有限。

鼠标点击和输入不自动平移画布。键盘导航到裁切区域外的控件时，使用库的 `panBy` 显示控件；裁切容器使用 `overflow: clip`，避免浏览器额外改变隐藏的滚动偏移。

`DevicePreview` 将画布可见范围反算到 iframe 坐标，通过 `cea:visible-area` 同步给播放页；列表由 `FitStage` 提供同一消息。原生 Popover 在这个范围内限制尺寸并保留原生滚动，测量不包含入场 transform，关闭后恢复素材样式。弹层不参与组件内容边界计算。

播放页只给打开的 Popover 设置 `will-change: transform`，避免缩放 iframe 中的弹层文字反复重绘出重影。关闭后恢复默认，不给所有控件常驻图层。`weather-stability.browser.ts` 对菜单连续截图做像素对比，补充坐标和透明度检查。

编辑 Tab 隐藏时暂停库的尺寸观察，恢复时以当前尺寸重新观察，避免 `display:none` 的零尺寸改变预览位置。

工具栏动作：

- 移动画布：开启后由库接管拖拽，临时不接收 iframe 内的点击；关闭后恢复组件互动。按住空格也可临时移动。
- 回到中央：保留当前倍率，回到当前画面的中心。
- 完整显示：重算当前视图的适配倍率并居中。它是可重复执行的命令，不是开关。

运行 `npm run test:browser -- preview-pan.browser.ts device-viewport.browser.ts device-switch.browser.ts`，验证放大、拖动边界、iframe 滚动、鼠标与键盘焦点、重复恢复视图，以及切换设备不重载。
