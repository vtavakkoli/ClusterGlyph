<div align="center">
  <img src="assets/logo.svg" width="88" height="88" alt="ClusterGlyph logo" />

# ClusterGlyph

**Geometry-aware raster-to-SVG vectorization that runs entirely in your browser.**

[![Live Demo](https://img.shields.io/badge/live-GitHub%20Pages-b8ff5a?style=flat-square&labelColor=111318)](https://vtavakkoli.github.io/ClusterGlyph/)
[![Tests](https://img.shields.io/github/actions/workflow/status/vtavakkoli/ClusterGlyph/test.yml?branch=main&style=flat-square&label=tests)](https://github.com/vtavakkoli/ClusterGlyph/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-66e7ff?style=flat-square&labelColor=111318)](LICENSE)
![Runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-929cab?style=flat-square&labelColor=111318)

[**Open the vectorizer**](https://vtavakkoli.github.io/ClusterGlyph/) · [Report a bug](https://github.com/vtavakkoli/ClusterGlyph/issues) · [Request a feature](https://github.com/vtavakkoli/ClusterGlyph/issues)

</div>

---

ClusterGlyph converts PNG, JPG, WebP, and other browser-readable raster images into compact, editable SVG geometry. You choose the exact color-cluster count, the raster is segmented in perceptual color space, and every spatially connected region becomes its own vector object before polygon simplification and geometry recovery.

> **Privacy by design:** image processing happens locally in the browser. Raster files are never uploaded to a server.

## What makes it different

| Capability | ClusterGlyph approach |
|---|---|
| Color reduction | Exact **1–32** cluster target using deterministic CIE Lab k-means |
| Object separation | Each **spatially connected component** becomes an independent SVG object |
| Editable output | Stable IDs such as `object-001`; ordinary regions export as `<polygon>` |
| Geometry cleanup | Collinear cleanup + Ramer–Douglas–Peucker simplification |
| Primitive recovery | Round regions can become native `<circle>` or `<ellipse>` |
| In-browser editing | Select, recolor, delete, and drag polygon vertices before export |
| Privacy | Fully client-side processing |
| Deployment | Static, dependency-free GitHub Pages application |

## Pipeline

```text
PNG / raster
    → perceptual color clusters
    → connected components
    → contour tracing
    → point simplification
    → circle / ellipse recovery
    → editable SVG objects
```

The web UI deliberately shows the same process in one horizontal flow:

**PNG → Color clusters → Contours → Geometry → SVG**

## Live demo

**https://vtavakkoli.github.io/ClusterGlyph/**

No account, backend, API key, or build step is required.

## Best suited for

ClusterGlyph works especially well with:

- logos and marks
- icons
- diagrams
- flat illustrations
- UI graphics
- maps and schematic graphics
- raster images with a limited number of dominant colors

Photographs can also be vectorized, but high cluster counts and fine tracing settings can produce much larger SVG files.

## Controls

| Setting | Purpose |
|---|---|
| **Color clusters** | Exact target number, from 1 to 32, of perceptual Lab-space color groups |
| **Processing resolution** | Long-edge raster resolution used for tracing |
| **Polygon simplification** | RDP epsilon; higher values reduce more vertices |
| **Minimum region** | Filters isolated raster noise and tiny components |
| **Round-shape tolerance** | Controls circle/ellipse fitting strictness |
| **Detect circles & ellipses** | Enables native SVG primitive recovery |
| **Precision** | Decimal precision used in exported coordinates |

## Architecture

```text
Raster image
   │
   ▼
Downscaled processing canvas
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
│   ├── worker.js
│   └── vectorizer.js
├── tests/
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

### 1. Perceptual color clustering

Sampled sRGB pixels are converted to CIE Lab. ClusterGlyph uses deterministic farthest-point initialization followed by k-means iterations. Centroids are learned from a capped sample for responsiveness, then all non-transparent pixels are classified.

### 2. Connected-object extraction

Color labels are only the segmentation stage. A connected-component pass then separates regions spatially, so two red objects that do not touch are exported as two independent vector objects even when both belong to the same color cluster.

### 3. Contour tracing

For each connected component, exposed raster-cell edges are emitted in a consistent orientation and chained into closed loops. Internal loops are retained so holes can be represented correctly.

### 4. Polygon optimization

Raw raster contours may contain thousands of adjacent points. ClusterGlyph first removes collinear vertices, then applies closed-polygon Ramer–Douglas–Peucker simplification.

Simple regions are serialized as editable SVG `<polygon>` elements. Regions with holes remain a single compound `<path fill-rule="evenodd">` to preserve topology.

### 5. Circle and ellipse recovery

Contours are tested against axis-aligned ellipse geometry derived from their bounding boxes. When normalized radial error is below the selected tolerance, a contour is emitted as a native `<circle>` or `<ellipse>` instead of a point-heavy polygon.

### 6. Object editing

Generated objects receive stable IDs and cluster metadata. The browser editor lets you select objects, change fill colors, delete shapes, and drag polygon vertices. Export always serializes the edited geometry.

## Run locally

Requirements: a modern browser and Python 3 for the convenience development server.

```bash
git clone https://github.com/vtavakkoli/ClusterGlyph.git
cd ClusterGlyph
npm run serve
```

Open:

```text
http://localhost:8080
```

There is no frontend build step and the production application has **zero runtime dependencies**.

## Tests

```bash
npm test
```

The test suite covers core geometry and vectorization behavior, including:

- polygon simplification
- circle recognition
- exact cluster-count behavior
- disconnected same-color object separation
- editable polygon serialization
- geometry re-serialization after edits

Tests also run automatically on pull requests and pushes to `main`.

## GitHub Pages deployment

Deployment is defined in `.github/workflows/pages.yml`.

For repository settings, configure **Settings → Pages → Build and deployment → GitHub Actions**. Pushes to `main` then deploy the static application.

## Roadmap

Good next improvements include:

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
