# ClusterGlyph

**Geometry-aware raster-to-SVG vectorization in the browser.**

ClusterGlyph converts PNG, JPG, WebP, and other browser-readable raster images into compact, editable SVG. You choose the exact color-cluster count (1–32); each spatially connected region becomes its own stable SVG object, then polygon contours are simplified and sufficiently round contours can be recovered as native SVG `<circle>` and `<ellipse>` elements.

> **Privacy first:** image processing happens entirely in the browser. No image is uploaded to a server.

## Why ClusterGlyph?

Most lightweight raster tracers produce path-heavy SVGs. ClusterGlyph is designed around a different pipeline:

1. **Perceptual color clustering** — deterministic k-means in CIE Lab space reduces the raster to a controlled palette.
2. **Connected-object extraction** — spatially separate areas remain separate objects even when they belong to the same color cluster.
3. **Boundary tracing** — raster cell edges are chained into closed contours, including internal loops/holes.
4. **Editable polygon output** — ordinary connected regions are emitted as SVG `<polygon>` elements with stable IDs such as `object-001`. Regions with holes stay one compound object to preserve topology.
5. **Point optimization** — collinear cleanup and Ramer–Douglas–Peucker simplification reduce polygon vertices.
6. **Geometry recovery** — round contours are tested against ellipse geometry and emitted as `<circle>` or `<ellipse>` when appropriate.
7. **Built-in object editor** — select shapes, recolor/delete them, and drag polygon vertices directly in the browser before export.

## Live demo

GitHub Pages is preconfigured with `.github/workflows/pages.yml`.

After pushing to a public GitHub repository:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **GitHub Actions**.
3. Push to `main` (or run the workflow manually).

Your site will be available at:

`https://vtavakkoli.github.io/ClusterGlyph/`

## Run locally

No build step is required. Because the app uses an ES module Web Worker, serve it over HTTP rather than opening `index.html` directly:

```bash
npm run serve
```

Then open `http://localhost:8080`.

## Controls

| Setting | Purpose |
|---|---|
| Color clusters | Exact target number (1–32) of Lab-space color groups; range and numeric input stay synchronized |
| Processing resolution | Limits tracing raster size for speed |
| Polygon simplification | RDP epsilon; larger values reduce more points |
| Minimum region | Removes tiny isolated color components |
| Round-shape tolerance | Controls circle/ellipse fitting strictness |
| Detect circles & ellipses | Enables native SVG geometry recovery |
| Precision | Decimal precision in exported coordinates |

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
Connected components
   │
   ▼
Boundary edge graph → closed contours
   │
   ├── round fit ───────► <circle> / <ellipse>
   │
   └── simplify (RDP) ─► <polygon> / compound path
                          │
                          ▼
                  Object editor + SVG export
```

### Source layout

```text
.
├── index.html                 # GitHub Pages UI
├── styles.css                 # Responsive interface
├── src/
│   ├── app.js                 # Browser UI, preview, export
│   ├── worker.js              # Background vectorization worker
│   └── vectorizer.js          # Core clustering/tracing/geometry engine
├── tests/vectorizer.test.js   # Node tests for core geometry
├── assets/logo.svg
└── .github/workflows/pages.yml
```

## Algorithm notes

### Color clustering

ClusterGlyph converts sampled sRGB pixels to CIE Lab and performs deterministic farthest-point initialization followed by k-means iterations. Centroids are learned from a capped sample for responsiveness, then all non-transparent pixels are classified.

### Contour extraction

For every connected component, exposed raster-cell edges are emitted in a consistent orientation and chained into loops. This makes the tracer dependency-free and produces exact grid-aligned boundaries before simplification.

### One connected object = one editable SVG object

Cluster labels are only the color grouping stage. After clustering, ClusterGlyph performs connected-component analysis, so two red objects that do not touch each other are exported independently. Each object receives a stable `id` and `data-cluster` attribute. A simple contour is an SVG `<polygon>`; a region containing holes is kept as one compound `<path fill-rule="evenodd">` so editability does not come at the cost of broken geometry.

### Polygon optimization and editing

The raw contours can contain thousands of adjacent raster points. ClusterGlyph first removes collinear vertices, then applies a closed-polygon variant of Ramer–Douglas–Peucker simplification. After vectorization, a shape can be selected in the preview and polygon vertices can be dragged before the SVG is copied or downloaded. The UI reports the before/after point count.

### Circle and ellipse recovery

A contour is tested against an axis-aligned ellipse derived from its bounding box. When normalized radial error is below the selected tolerance, the contour is serialized as a native circle or ellipse. This typically makes icons and logos easier to edit and substantially smaller than polygon-only tracing.

## Current scope

ClusterGlyph is optimized for logos, icons, diagrams, flat illustrations, UI graphics, and images with a limited number of dominant colors. Photographs can be vectorized, but high cluster counts and fine tracing settings may produce large SVGs.

Potential next steps include Bézier fitting, rotated ellipse fitting, multi-select/object merging, insert/delete vertex tools, hierarchical color merging, edge anti-alias estimation, WebAssembly acceleration, and optional background removal.

## Development

```bash
npm test
npm run serve
```

The implementation intentionally has **zero runtime dependencies**.

## License

MIT © 2026 Vahid Tavakkoli
