# 灵思 Logo 图标生成指南

## SVG 源文件

已创建的 SVG Logo 文件：
- `public/app-icon.svg` - 1024x1024 应用图标（单字"灵"）
- `public/logo.svg` - 512x512 品牌 Logo（"灵思"）
- `public/favicon.svg` - 32x32 浏览器图标

## 生成 PNG 图标

### 方法 1: 使用在线工具（推荐）

1. 打开 [CloudConvert](https://cloudconvert.com/svg-to-png) 或 [SVG to PNG](https://svgtopng.com/)
2. 上传 `public/app-icon.svg`
3. 设置输出尺寸为 1024x1024
4. 下载并保存为 `public/app-icon.png`

### 方法 2: 使用 macOS 预览

1. 在 Finder 中双击 `app-icon.svg` 打开预览
2. 文件 → 导出
3. 格式选择 PNG，分辨率选择 1024x1024
4. 保存

### 方法 3: 使用 Inkscape（跨平台）

```bash
# 安装 Inkscape
brew install inkscape  # macOS

# 转换 SVG 到 PNG
inkscape public/app-icon.svg -w 1024 -h 1024 -o public/app-icon.png
inkscape public/logo.svg -w 512 -h 512 -o public/logo.png
```

## 生成 Tauri 应用图标

生成 `app-icon.png` 后，使用 Tauri 内置工具生成所有平台图标：

```bash
# 确保 app-icon.png 存在且为 1024x1024
pnpm tauri icon public/app-icon.png
```

这将自动生成：
- `src-tauri/icons/*.png` - 各种尺寸的 PNG
- `src-tauri/icons/icon.icns` - macOS 图标
- `src-tauri/icons/icon.ico` - Windows 图标
- `src-tauri/icons/ios/*` - iOS 图标
- `src-tauri/icons/android/*` - Android 图标

## 生成 Favicon

### ICO 文件（用于旧浏览器兼容）

使用 [favicon.io](https://favicon.io/favicon-converter/) 或 [RealFaviconGenerator](https://realfavicongenerator.net/)：

1. 上传 `app-icon.png`
2. 下载生成的 `favicon.ico`
3. 替换 `public/favicon.ico`

### SVG Favicon（现代浏览器）

`public/favicon.svg` 已经创建好，现代浏览器会自动使用它。

## 颜色参考

- 主色（顶部）: `#1890FF` - Ant Design 蓝
- 深色（底部）: `#096DD9` - 深蓝
- 文字: `#FFFFFF` - 白色
