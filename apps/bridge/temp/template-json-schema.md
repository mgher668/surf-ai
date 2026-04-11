# Hangtag Template JSON（与 `hangtag-template.schema.json` 对齐）

> 本文档把 Schema 转成可读说明，指导 Fabric.js 导出如何转换为后端渲染模板。字段和示例必须与 Schema 100% 对齐，否则校验直接失败。

## 速查
- 单位：全部尺寸用 pt 存储（印刷标准）。设计器可用 mm/cm 输入，导出时换算为 pt（1 mm = 2.83465 pt，保留 6–8 位小数）。
- 组件类型：`textBlock`（文本）、`imageBlock`（图片）、`vectorShape`（路径/多边形）、`decor`（线/椭圆/矩形等装饰）、`symbology`（条码/二维码占位）、`compound`（分组）。
- 资源引用：绘制对象用 `resourceRef` 指向 `resources.fonts/images` 的 `id`，禁止直接写文件路径。
- 数据绑定：动态文案/码制必须给 `dataBinding.field`；静态内容可省略。示例数据放在 `dataBindings.samplePayload`。

## 1. 顶层结构

模板是一个对象，必须包含：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `$schema` | ✔︎ | 固定为 `https://example.com/schemas/hangtag-template.schema.json`。 |
| `templateVersion` | ✔︎ | 业务版本号，如 `v2`（格式：`v` + 数字，可带 `.x`）。 |
| `designAppVersion` | ✔︎ | 设计器版本（Fabric.js 版本）。 |
| `meta` | ✔︎ | 模板元数据。 |
| `resources` | ✔︎ | 字体与图片资源目录，供 `resourceRef` 引用。 |
| `dataBindings` | ✔︎ | 模板所需字段及示例数据。 |
| `canvas` | ✔︎ | Fabric 画布快照（对象列表需符合本 Schema）。 |

### 1.1 `meta`

```jsonc
"meta": {
  "templateId": "tpl_20250301_001",
  "displayName": "标准吊牌",
  "description": "可选",
  "page": {
    "size": "Custom",    // A4/A5/Letter/Legal/Custom
    "widthPt": 141.732,  // 单位：pt
    "heightPt": 311.811,
    "bleedPt": 6         // 可选
  }
}
```

### 1.2 `resources`

```jsonc
"resources": {
  "fonts": [
    {
      "id": "font_sans_regular",
      "family": "Source Han Sans",
      "weight": 400,
      "style": "normal",     // 可选
      "subset": "latin+han", // 可选
      "uri": "fonts/SourceHanSansCN-Regular.ttf",
      "embed": true
    }
  ],
  "images": [
    {
      "id": "img_logo_main",
      "uri": "assets/svg/logo.svg",   // 可用 https://、file:// 或 data: URI
      "checksum": "sha256-...",
      "type": "svg",                  // svg/png/jpeg/webp
      "widthPx": 512,
      "heightPx": 128
    }
  ]
}
```

### 1.3 `dataBindings`

```jsonc
"dataBindings": {
  "requiredFields": ["title", "price", "barcode"],
  "samplePayload": {
    "title": "SKU-001",
    "price": "99.00",
    "barcode": "6901234567892"
  }
}
```

### 1.4 `canvas`

```jsonc
"canvas": {
  "type": "fabric-canvas",
  "version": "6.7.0",
  "width": 141.732,
  "height": 311.811,
  "background": "rgba(0,0,0,0)",
  "backgroundImage": null,
  "overlayImage": null,
  "clipPath": null,
  "objects": [ /* 见第 3 章 */ ]
}
```

## 2. 基础字段（`baseObject`）

| 字段 | 说明 |
| --- | --- |
| `type` | Fabric 类型的小写形式，必须匹配 Schema 的 `const/enum`（如 `Textbox` → `"textbox"`）。 |
| `componentType` | 语义层枚举：`textBlock` / `imageBlock` / `vectorShape` / `decor` / `symbology` / `compound`。 |
| `originX` / `originY` | `left|center|right`、`top|center|bottom`。 |
| `left` / `top` / `width` / `height` | 坐标和尺寸（pt）。 |
| 变换 | `angle`, `opacity`, `scaleX`, `scaleY`, `flipX`, `flipY`, `skewX`, `skewY`。 |
| 轮廓/填充 | `stroke`, `strokeWidth`, `strokeDashArray`, `fill`, `shadow`, `clipPath`。 |
| `dataBinding` | 允许为 `null`，示例：`{"field":"price","format":"decimal(2)","fallback":"N/A"}`。 |
| `renderHints` | 允许：`pdfReuse`, `pictureCache`, `antialias`, `flattenToPath`, `autoScale`, `preferVector`, `quietZoneModules`, `errorCorrection` (L/M/Q/H), `moduleWidthOverride`。 |
| `resourceRef` | 指向 `resources.fonts/images` 的 `id`。 |
| 其他 | `zIndex`, `customMetadata` 可选。 |

## 3. 对象类型参考

### 3.1 文本（`text` / `textbox` / `i-text`）
- 必填：`componentType: "textBlock"`, `text`, `fontSize`, `fontFamily`。
- 可选：`fontWeight`, `fontStyle`, `underline`, `linethrough`, `overline`, `textAlign` (`left|center|right|justify`), `lineHeight`, `charSpacing`。
- `renderConstraints`（可选）：

```jsonc
"renderConstraints": {
  "maxLines": 2,
  "overflow": "ellipsis",   // clip / ellipsis / shrinkToFit
  "autoScale": false
}
```

> 不支持 Fabric 富文本 `styles[]` 或沿路径文本；导出前请拆分或降级。

### 3.2 图像（`imageObject`）

```jsonc
{
  "type": "image",
  "componentType": "imageBlock",
  "resourceRef": "img_logo_main",
  "cropX": 0,
  "cropY": 0,
  "objectCaching": true,
  "filterStack": [
    { "name": "grayscale", "options": {} }
  ]
}
```

### 3.3 矢量 / Path / 几何
- `pathObject`: `type` 为 `"path"` 或 `"polygon"`，需 `path`（字符串或点数组）；可选 `strokeLineCap`, `strokeLineJoin`, `strokeMiterLimit`。
- `polygonObject`: `type: "polygon"`，`points` 为二维数组（≥3 个点）。
- `rectObject`: `type: "rect"`，可带 `rx/ry` 圆角。
- `lineObject`: 需 `x1/y1/x2/y2`。
- `ellipseObject`: 需 `rx/ry`。

### 3.4 组合（`groupObject`）
`type: "group"`, `componentType: "compound"`，`objects` 内嵌任意 `fabricObject`。Group 也可自带 `dataBinding` / `renderHints`。

### 3.5 码制占位符（Symbology）
统一 `componentType: "symbology"`，用 `symbologyType` 指定码制。

支持的码制：
- 1D：`CODE128`, `CODE39`, `CODE93`, `CODABAR`, `ITF`, `ITF14`, `MSI`, `MSI10`, `MSI11`, `MSI1010`, `MSI1110`
- GS1：`GS1_128`, `EAN13`, `EAN8`, `UPC_A`, `UPC_E`, `GS1_DATABAR_OMNI`, `GS1_DATABAR_STACKED`, `GS1_DATABAR_EXPANDED`
- 专用：`PHARMACODE`, `POSTNET`, `PLANET`, `JAPAN_POST`
- 2D：`QR`, `MICRO_QR`, `DATAMATRIX`, `PDF417`, `AZTEC`, `MAXICODE`

```jsonc
{
  "type": "rect",
  "componentType": "symbology",
  "symbologyType": "EAN13",
  "dataBinding": { "field": "barcode" },
  "renderHints": {
    "moduleWidthOverride": 0.33,
    "quietZoneModules": 11,
    "pdfReuse": true
  }
}
```

## 4. Fabric → Schema 映射

| Fabric 类型 | Schema `type` | `componentType` | 备注 |
| --- | --- | --- | --- |
| `Textbox`, `IText`, `Text` | `textbox` / `i-text` / `text` | `textBlock` | 输出小写，富文本需拆分。 |
| `Image` | `image` | `imageBlock` | 必须填 `resourceRef`。 |
| `Rect` | `rect` | `decor` 或 `symbology` | 码制需额外给 `symbologyType`。 |
| `Circle`, `Ellipse` | `ellipse` | `decor` | 记录 `rx/ry`。 |
| `Line` | `line` | `decor` | 提供 `x1/y1/x2/y2`。 |
| `Polygon`, `Triangle` | `polygon` | `vectorShape` | `points` ≥ 3。 |
| `Path` | `path` | `vectorShape` | `path` 可为命令数组。 |
| `Group` | `group` | `compound` | 子对象继续适配。 |

## 5. 导出流程（推荐）
1. **收集自定义属性**：Fabric `canvas.toJSON([...])` 传入 `['componentType','dataBinding','renderHints','resourceRef','zIndex','customMetadata']` 等。
2. **规整结构**：包装 `$schema/templateVersion/meta/resources/dataBindings/canvas`；归一化 `type/componentType/resourceRef`；只保留 Schema 支持的属性；填好 `resources` 与可选 `checksum`。
3. **Schema 校验**：用 AJV（Draft 2020-12）或同类工具加载 `docs/hangtag-template.schema.json`，前端或 CI 必须先通过校验。
4. **渲染调用**：后端仅负责“合法 Schema + 数据 payload → PDF”，不解析裸 Fabric JSON。

---

新增字段或高级特性时，需同步更新 `docs/hangtag-template.schema.json` 与本文档，保持 100% 对齐。
