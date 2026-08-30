<div align="center">
  <img src="assets/logo.svg" width="88" height="88" alt="ClusterGlyph logo" />

# ClusterGlyph

**Text-aware, geometry-aware raster-to-SVG vectorization in your browser.**

[![Live Demo](https://img.shields.io/badge/live-GitHub%20Pages-b8ff5a?style=flat-square&labelColor=111318)](https://vtavakkoli.github.io/ClusterGlyph/)
[![Tests](https://img.shields.io/github/actions/workflow/status/vtavakkoli/ClusterGlyph/test.yml?branch=main&style=flat-square&label=tests)](https://github.com/vtavakkoli/ClusterGlyph/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-66e7ff?style=flat-square&labelColor=111318)](LICENSE)
![OCR](https://img.shields.io/badge/OCR-Tesseract.js-929cab?style=flat-square&labelColor=111318)

[**Open the vectorizer**](https://vtavakkoli.github.io/ClusterGlyph/) · [Report a bug](https://github.com/vtavakkoli/ClusterGlyph/issues) · [Request a feature](https://github.com/vtavakkoli/ClusterGlyph/issues)

</div>

---

ClusterGlyph converts PNG, JPG, WebP, and other browser-readable raster images into compact, editable SVG. It now separates **text recovery** from **graphic tracing**: Tesseract.js detects words and exports them as native SVG `<text>` objects, while non-text graphics are segmented in perceptual color space and converted into editable polygons, circles, and ellipses.

> **Privacy by design:** raster pixels are processed in the browser and are not uploaded to a ClusterGlyph backend. Tesseract.js and language assets are loaded by the browser from their configured CDN sources.

## What makes it different

| Capability | ClusterGlyph approach |
|---|---|
| Text preservation | Tesseract.js OCR detects words and exports editable native SVG `<text>` instead of tracing letters as polygons |
| Text styling | Estimates text color, common font family, weight, size, and original position from the raster region |
| Color reduction | Exact **1–32** cluster target using deterministic CIE Lab k-means |
| Object separation | Each **spatially connected component** becomes an independent SVG object |
| Editable output | Stable IDs such as `object-001` and `text-001` |
| Geometry cleanup | Collinear cleanup + Ramer–Douglas–Peucker simplification |
| Primitive recovery | Round regions can become native `<circle>` or `<ellipse>` |
| In-browser editing | Select, recolor, delete, and drag polygon vertices before export |
| Privacy | Raster image processing stays client-side |
| Deployment | Static GitHub Pages application; no backend or API key required |

## Pipeline

```text
PNG / raster
    → Tesseract.js OCR ────────────────→ editable <text>
    → perceptual color clusters
    → connected components
    → contour tracing
    → point simplification
    → circle / ellipse recovery
    → editable vector geometry
    → combined semantic SVG
```

The web UI shows the same process in one horizontal flow:

**PNG → OCR + clusters → Contours → Text + geometry → SVG**

## Live demo

**https://vtavakkoli.github.io/ClusterGlyph/**

No account, backend, API key, or frontend build step is required.

## Best suited for

ClusterGlyph works especially well with:

- logos and marks
- icons with labels
- diagrams
- screenshots with flat backgrounds
- flat illustrations
- UI graphics
- maps and schematic graphics
- raster images with a limited number of dominant colors

Photographs can also be vectorized, but high cluster counts and fine tracing settings can produce much larger SVG files. OCR works best on clear, reasonably high-contrast text.

## Controls

| Setting | Purpose |
|---|---|
| **Color clusters** | Exact target number, from 1 to 32, of perceptual Lab-space color groups |
| **Processing resolution** | Long-edge raster resolution used for OCR and tracing |
| **Polygon simplification** | RDP epsilon; higher values reduce more vertices |
| **Minimum region** | Filters isolated raster noise and tiny components |
| **Round-shape tolerance** | Controls circle/ellipse fitting strictness |
| **Detect circles & ellipses** | Enables native SVG primitive recovery |
| **Detect editable text** | Runs Tesseract.js and restores detected words as SVG `<text>` elements |
| **OCR language** | English, German, or English + German in the current UI |
| **Precision** | Decimal precision used in exported coordinates |

## Text recovery

ClusterGlyph performs OCR before graphic tracing. Confident words are analyzed to recover:

- text content
- bounding-box position
- foreground color
- approximate font size
- approximate font weight
- closest match from a small set of common browser fonts

Detected text pixels are selectively suppressed from the graphic tracing raster so letters are less likely to appear twice as both polygons and native text.

### Font matching limitation

A raster image does not reliably contain enough information to recover an exact original font file. ClusterGlyph therefore compares measured word width against common browser fonts such as Arial, Helvetica, Verdana, Tahoma, Georgia, Times New Roman, and Courier New. The selected family is a **best visual estimate**, not a guaranteed font identity. SVG output remains editable so the font can be replaced later in an editor.

## Architecture

```text
Raster image
   │
   ├──────────────► Tesseract.js OCR
   │                    │
   │                    ├── confidence filtering
   │                    ├── foreground/background color estimate
   │                    ├── font family/size/weight fit
   │                    └── native SVG <text>
   │
   ▼
Downscaled processing canvas
   │
   ├── detected text pixels selectively masked
   │
   ▼
CIE Lab color clustering
   │
   ▼
Per-pixel cluster labels
   │
   ▼
Connected-component extraction
   │
   ▼
Boundary edge graph → closed contours
   │
   ├── round fit ─────────► <circle> / <ellipse>
   │
   └── simplify (RDP) ────► <polygon> / compound path
                              │
                              ▼
                Text + geometry object model
                              │
                              ▼
                       Object editor
                              │
                              ▼
                          SVG export
```

### Source layout

```text
.
├── index.html
├── styles.css
├── assets/
│   └── logo.svg
├── src/
│   ├── app.js
│   ├── ocr.js
│   ├── serializer.js
│   ├── worker.js
│   └── vectorizer.js
├── tests/
│   ├── text-ocr.test.js
│   └── vectorizer.test.js
├── .github/
│   ├── workflows/
│   │   ├── pages.yml
│   │   └── test.yml
│   └── pull_request_template.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
└── package.json
```

## Algorithm

### 1. OCR and text reconstruction

Tesseract.js recognizes words on the same downscaled canvas used for tracing. Low-confidence words are filtered. ClusterGlyph samples each word region to estimate foreground and background colors, estimates stroke density for font weight, and measures candidate browser fonts to choose a close family and size. Coordinates are then scaled back to the original raster dimensions.

### 2. Text-aware raster masking

Before color clustering, likely glyph pixels inside detected OCR boxes are replaced with an estimated local background color. This reduces duplicate letter contours while trying to preserve the surrounding graphic region.

### 3. Perceptual color clustering

Sampled sRGB pixels are converted to CIE Lab. ClusterGlyph uses deterministic farthest-point initialization followed by k-means iterations. Centroids are learned from a capped sample for responsiveness, then all non-transparent pixels are classified.

### 4. Connected-object extraction

Color labels are only the segmentation stage. A connected-component pass then separates regions spatially, so two red objects that do not touch are exported as two independent vector objects even when both belong to the same color cluster.

### 5. Contour tracing and polygon optimization

For each connected component, exposed raster-cell edges are emitted in a consistent orientation and chained into closed loops. Internal loops are retained so holes can be represented correctly.

Raw raster contours may contain thousands of adjacent points. ClusterGlyph first removes collinear vertices, then applies closed-polygon Ramer–Douglas–Peucker simplification.

Simple regions are serialized as editable SVG `<polygon>` elements. Regions with holes remain a single compound `<path fill-rule="evenodd">` to preserve topology.

### 6. Circle and ellipse recovery

Contours are tested against axis-aligned ellipse geometry derived from their bounding boxes. When normalized radial error is below the selected tolerance, a contour is emitted as a native `<circle>` or `<ellipse>` instead of a point-heavy polygon.

### 7. Semantic SVG serialization

The final object model can contain polygons, compound paths, circles, ellipses, and text. OCR objects are serialized with `x`, `y`, `font-family`, `font-size`, `font-weight`, and `fill` attributes, with XML escaping applied to recognized text.

## Run locally

Requirements: a modern browser and Python 3 for the convenience development server. Node.js 20+ is used for tests.

```bash
git clone https://github.com/vtavakkoli/ClusterGlyph.git
cd ClusterGlyph
npm run serve
```

Open:

```text
http://localhost:8080
```

There is no frontend build step. The application loads the pinned Tesseract.js browser bundle from jsDelivr when OCR is enabled; Tesseract language data may also be downloaded by the browser on first use.

## Tests

```bash
npm test
```

The test suite covers core geometry and text-aware export behavior, including:

- polygon simplification
- circle recognition
- exact cluster-count behavior
- disconnected same-color object separation
- editable polygon serialization
- OCR confidence filtering
- positioned text-object generation
- native SVG `<text>` serialization and XML escaping
- text-mask dimension preservation

Tests also run automatically on pull requests and pushes to `main`.

## GitHub Pages deployment

Deployment is defined in `.github/workflows/pages.yml`.

For repository settings, configure **Settings → Pages → Build and deployment → GitHub Actions**. Pushes to `main` then deploy the static application.

## Roadmap

Good next improvements include:

- font fingerprinting against user-provided or bundled font catalogs
- OCR line grouping and kerning/letter-spacing recovery
- rotated text support
- Bézier curve fitting
- rotated ellipse detection
- multi-select and object merging
- insert/delete vertex tools
- hierarchical color merging
- better anti-aliased edge estimation
- optional background removal
- WebAssembly acceleration for large rasters

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and pull-request expectations.

For security-related reports, please follow [SECURITY.md](SECURITY.md) rather than opening a public issue.

## License

Released under the [MIT License](LICENSE).

Copyright © 2026 Vahid Tavakkoli.
