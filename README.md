<div align="center">
  <img src="assets/logo.svg" width="88" height="88" alt="ClusterGlyph logo" />

# ClusterGlyph

**Semantic raster-to-SVG reconstruction in your browser.**

[![Live Demo](https://img.shields.io/badge/live-GitHub%20Pages-b8ff5a?style=flat-square&labelColor=111318)](https://vtavakkoli.github.io/ClusterGlyph/)
[![Tests](https://img.shields.io/github/actions/workflow/status/vtavakkoli/ClusterGlyph/test.yml?branch=main&style=flat-square&label=tests)](https://github.com/vtavakkoli/ClusterGlyph/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-66e7ff?style=flat-square&labelColor=111318)](LICENSE)
![OCR](https://img.shields.io/badge/OCR-Tesseract.js-929cab?style=flat-square&labelColor=111318)

[**Open the vectorizer**](https://vtavakkoli.github.io/ClusterGlyph/) · [Report a bug](https://github.com/vtavakkoli/ClusterGlyph/issues) · [Request a feature](https://github.com/vtavakkoli/ClusterGlyph/issues)

</div>

---

ClusterGlyph does more than trace pixels. It tries to reconstruct the **SVG objects that most likely produced the raster image**: text becomes native `<text>`, cards become `<rect>`, round elements become `<circle>`/`<ellipse>`, thin strokes become `<line>`, smooth artwork can become cubic Bézier `<path>`, and only genuinely irregular regions remain polygons.

> **Privacy by design:** raster pixels stay in the browser. There is no ClusterGlyph image-upload backend. Tesseract.js and OCR language assets are loaded by the browser when OCR is enabled.

## v0.5 semantic reconstruction

The reconstruction pipeline now addresses the main failure mode of conventional raster tracing: anti-aliased text, icons, borders, and UI cards turning into thousands of tiny polygons.

| Capability | ClusterGlyph v0.5 approach |
|---|---|
| Source-resolution OCR | Tesseract.js analyzes the original raster instead of the downscaled tracing canvas |
| Line-level typography | OCR words are reconstructed as consistent text lines/blocks instead of independently styled words |
| Raster font fitting | Candidate browser fonts and weights are rendered to an offscreen canvas and compared with the source glyph mask |
| Width preservation | Native `<text>` uses `textLength` + `lengthAdjust="spacingAndGlyphs"` to preserve the original line width |
| Text removal before tracing | A dilated glyph mask reconstructs the local background so anti-aliased letter fragments do not become polygons |
| Anti-alias cleanup | Isolated cluster labels are merged into the local dominant neighborhood before connected-component tracing |
| Rectangle recovery | Flat cards and panels can become native `<rect>` or rounded `<rect rx>` primitives |
| Stronger circle recovery | Circularity, radial variance, and normalized ellipse error can snap hexagon/octagon-like raster contours to `<circle>` |
| Line recovery | Thin horizontal/vertical components can become native SVG `<line>` elements |
| Curve recovery | Smooth closed contours can become cubic Bézier `<path>` elements using Catmull–Rom-to-Bézier conversion |
| Semantic grouping | Reconstructed panels and their contents receive semantic group metadata and are serialized inside SVG `<g>` groups |
| Editable output | Stable IDs, text attributes, colors, geometry, groups, and polygon vertices remain editable |

## Pipeline

```text
Original raster
   │
   ├──────────────► source-resolution Tesseract.js OCR
   │                    │
   │                    ├── line/block grouping
   │                    ├── foreground/background analysis
   │                    ├── render-and-compare font fitting
   │                    ├── baseline + textLength fitting
   │                    └── native SVG <text>
   │
   ▼
Downscaled tracing raster
   │
   ├── scale OCR boxes to tracing resolution
   ├── build glyph mask
   ├── dilate anti-aliased text edges
   └── reconstruct local background
   │
   ▼
CIE Lab color clustering
   │
   ▼
Anti-alias label cleanup
   │
   ▼
Connected components
   │
   ▼
Contour analysis
   │
   ├── thin component ───────────► <line>
   ├── axis-aligned card ────────► <rect> / rounded <rect>
   ├── round fit ────────────────► <circle> / <ellipse>
   ├── smooth contour ───────────► cubic Bézier <path>
   └── irregular contour ────────► simplified <polygon> / compound <path>
   │
   ▼
Semantic grouping
   │
   ▼
Editable SVG
```

The key design principle is:

> **Do not ask only “how do I trace these pixels?” Ask “what semantic SVG object most likely produced these pixels?”**

## Text reconstruction

### OCR hierarchy

Tesseract.js blocks, paragraphs, lines, and words are retained. ClusterGlyph reconstructs one consistent SVG text object per detected line where possible. If hierarchical OCR data is unavailable, words are grouped into lines by vertical alignment.

### Font matching

Exact font identity cannot always be recovered from raster pixels. ClusterGlyph therefore evaluates common browser fonts such as Inter, Arial, Helvetica, Segoe UI, Verdana, Tahoma, Trebuchet MS, Georgia, Times New Roman, and Courier New.

For each candidate it estimates font size and weight, renders the candidate into an offscreen canvas, creates a binary glyph mask, and compares that mask with the source raster. The best candidate is retained as an editable font-family/size/weight estimate.

Even if the exact original font is unavailable, `textLength` keeps the recovered text line aligned to the source width.

### Text-aware background reconstruction

OCR boxes are scaled from the original image to the tracing raster. ClusterGlyph estimates local foreground/background colors, builds a likely glyph mask, dilates it to include anti-aliased edges, and fills those pixels with the surrounding background estimate before graphic tracing.

This prevents the same text from appearing twice as both native text and thousands of tiny glyph polygons.

## Geometry reconstruction

### Anti-alias-aware label cleanup

After Lab clustering, isolated cluster labels surrounded by a strong local majority are reassigned to that majority. This removes one-pixel fringe components caused by interpolation colors.

### Rectangles and rounded rectangles

Contours that closely occupy an axis-aligned bounding box can become native SVG `<rect>`. When the box is mostly filled but the corners are consistently inset, ClusterGlyph estimates a corner radius and emits `<rect rx="…">`.

### Circles and ellipses

Round-shape detection combines:

- normalized ellipse radial error
- polygon circularity `4πA / P²`
- radius coefficient of variation
- bounding-box aspect ratio

The combined test intentionally accepts low-sided polygons such as hexagons/octagons when they are clearly raster approximations of circles.

### Lines

Very thin, high-aspect-ratio connected components can be reconstructed as native `<line>` elements with an estimated stroke width.

### Smooth curves

After Ramer–Douglas–Peucker simplification, contours with low corner sharpness can be converted into cubic Bézier paths. Catmull–Rom control-point conversion produces compact smooth SVG geometry instead of a long series of straight segments.

## Semantic groups

Large reconstructed panels are treated as candidate containers. Shapes whose centers fall inside a panel inherit the same semantic group. SVG serialization emits `<g>` wrappers plus `data-group` and `data-role` metadata.

OCR blocks use their own `text-block-XX` groups, which makes reconstructed infographics easier to edit in SVG tools.

## Controls

| Setting | Purpose |
|---|---|
| **Color clusters** | Exact target number, 1–32, of perceptual Lab color groups |
| **Processing resolution** | Downscaled long edge used for geometry tracing; OCR uses source resolution |
| **Polygon simplification** | RDP epsilon; higher values reduce vertices |
| **Minimum region** | Filters isolated raster noise and tiny components |
| **Round-shape tolerance** | Primitive fit tolerance |
| **Detect editable text** | Runs Tesseract.js and reconstructs line-level native text |
| **OCR language** | English, German, or English + German |
| **Precision** | Decimal coordinate precision in exported SVG |

The semantic reconstruction engine also enables anti-alias cleanup, rectangle recovery, and curve fitting by default.

## Source layout

```text
.
├── index.html
├── styles.css
├── assets/
│   └── logo.svg
├── src/
│   ├── app.js
│   ├── ocr.js
│   ├── reconstruction.js
│   ├── serializer.js
│   ├── vectorizer.js
│   └── worker.js
├── tests/
│   ├── reconstruction.test.js
│   ├── text-ocr.test.js
│   └── vectorizer.test.js
├── .github/
│   └── workflows/
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
└── package.json
```

## Run locally

Requirements: a modern browser, Python 3 for the convenience static server, and Node.js 20+ for tests.

```bash
git clone https://github.com/vtavakkoli/ClusterGlyph.git
cd ClusterGlyph
npm run serve
```

Open:

```text
http://localhost:8080
```

There is no frontend build step. The browser loads the pinned Tesseract.js bundle from jsDelivr when OCR is enabled.

## Tests

```bash
npm test
```

Tests cover:

- polygon simplification
- exact color-cluster behavior
- disconnected same-color object separation
- circle and hexagon-to-circle recognition
- native rectangle reconstruction
- anti-alias cluster cleanup
- Bézier path generation
- source OCR confidence filtering
- line/block OCR grouping
- text positioning and width preservation
- XML-safe native SVG text
- semantic SVG groups
- text-mask dimension preservation

## Current limitations

- Font reconstruction is a visual estimate unless the exact font is available in the browser.
- Rotated text and rotated ellipses are not yet fully reconstructed as native rotated primitives.
- Background reconstruction is optimized for flat/illustrative graphics; complex photographic text backgrounds remain difficult.
- The render-and-compare optimization loop currently focuses on typography and primitive-model selection rather than performing a global differentiable optimization of every SVG parameter.

## Roadmap

- rotated text and oriented bounding boxes
- rotated ellipse recovery
- optional user-supplied font catalog fingerprinting
- global SVG render/difference heat map
- iterative geometry parameter refinement from the heat map
- hierarchical object/group editor
- WebAssembly acceleration for very large rasters

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

For security-related reports, follow [SECURITY.md](SECURITY.md) rather than opening a public issue.

## License

Released under the [MIT License](LICENSE).

Copyright © 2026 Vahid Tavakkoli.
