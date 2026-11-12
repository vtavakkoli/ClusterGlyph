<div align="center">
  <img src="assets/logo.svg" width="88" height="88" alt="ClusterGlyph logo" />

# ClusterGlyph

**Local raster-to-SVG vectorization with editable shapes and optional experimental text recovery.**

[![Live Demo](https://img.shields.io/badge/live-GitHub%20Pages-b8ff5a?style=flat-square&labelColor=111318)](https://vtavakkoli.github.io/ClusterGlyph/)
[![Tests](https://img.shields.io/github/actions/workflow/status/vtavakkoli/ClusterGlyph/test.yml?branch=main&style=flat-square&label=tests)](https://github.com/vtavakkoli/ClusterGlyph/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-66e7ff?style=flat-square&labelColor=111318)](LICENSE)
![OCR](https://img.shields.io/badge/OCR-experimental%20%C2%B7%20opt--in-ffd296?style=flat-square&labelColor=111318)

[**Open the vectorizer**](https://vtavakkoli.github.io/ClusterGlyph/) · [Report a bug](https://github.com/vtavakkoli/ClusterGlyph/issues) · [Request a feature](https://github.com/vtavakkoli/ClusterGlyph/issues)

</div>

---

ClusterGlyph converts PNG, JPG, WebP, and other browser-readable raster images into editable SVG. By default, the entire image, including lettering, is segmented in perceptual color space and traced into editable polygons, circles, and ellipses.

Download the result as **SVG or PNG**, including all current edits. PNG supports 1×, 2×, and 4× the original image dimensions. **Transparent** is the default output background; **Original** and **Custom color** are available for both formats.

**Text detection is experimental and off by default.** Enable **Optional text recovery → Enable text detection** before vectorizing to try recovering words as native SVG `<text>` objects. Recognition, fonts, and placement are estimates and should be reviewed before exporting. The language selector is available only while text detection is enabled.

> **Privacy by design:** raster pixels are processed in the browser and are not uploaded to a ClusterGlyph backend. The default geometry workflow makes no OCR downloads. Tesseract.js and language assets are requested from their configured CDN sources only when you run vectorization with experimental text detection enabled.

## What makes it different

| Capability | ClusterGlyph approach |
|---|---|
| Experimental text recovery | Optional Tesseract.js OCR exports detected words as native SVG `<text>`; disabled by default |
| Experimental text styling | Estimates text color, common font family, weight, size, and position; review accuracy before export |
| Color reduction | Exact **1–32** cluster target using deterministic CIE Lab k-means |
| Object separation | Each **spatially connected component** becomes an independent SVG object |
| Editable output | Stable IDs such as `object-001` and `text-001` |
| Geometry cleanup | Collinear cleanup + Ramer–Douglas–Peucker simplification |
| Primitive recovery | Round regions can become native `<circle>` or `<ellipse>` |
| In-browser editing | Original, Compare, and full SVG views; select, recolor, delete, and drag polygon vertices before export |
| PNG export | Rasterizes the edited SVG at 1×, 2×, or 4× original size with the selected background |
| Background | Transparent by default; retain the original or choose a custom color without re-vectorizing |
| Edge cleanup | Small-region color merging, protected thin contours, optional curve smoothing, and tiny shared-edge overlaps |
| Privacy | Raster image processing stays client-side |
| Deployment | Static GitHub Pages application; no backend or API key required |

## Pipeline

```text
PNG / raster
    → perceptual color clusters
    → connected components
    → contour tracing
    → point simplification
    → circle / ellipse recovery
    → editable vector geometry
    → SVG export

Optional, experimental branch (only when enabled):
    raster → Tesseract.js → text masking + editable <text>
    masked raster → geometry tracing → combined SVG
```

The web UI shows the same process in one horizontal flow:

**PNG → Clusters → Contours → Shapes → SVG**

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
| **Processing resolution** | Long edge used for tracing and optional OCR; default 1600px, maximum 2400px; smaller images are not enlarged |
| **Polygon simplification** | RDP epsilon; higher values reduce more vertices |
| **Minimum region** | Merges small connected regions into neighboring colors instead of deleting pixels; 1 retains every region |
| **Smooth traced edges** | Rounds short raster steps and shallow curve segments with quadratic curves while retaining strong corners |
| **Clean color speckles** | Removes isolated, low-contrast color labels while retaining contrasting thin lines |
| **Close tiny gaps between colors** | Adds small same-color overlaps to reduce antialiasing seams between neighboring regions |
| **Output background** | Transparent, Original, or Custom color; applies immediately to both exports |
| **PNG size** | 1×, 2×, or 4× original dimensions, independent of processing resolution |
| **Round-shape tolerance** | Controls circle/ellipse fitting strictness |
| **Detect circles & ellipses** | Enables native SVG primitive recovery |
| **Enable text detection — Experimental** | Off by default; runs Tesseract.js on demand and restores detected words as SVG `<text>` elements |
| **Text language** | English, German, or English + German; disabled until text detection is enabled |
| **Precision** | Decimal precision used in exported coordinates |

## Preview and editing

Use **Original** to inspect the input, **Compare** to move the raster/SVG divider, or **SVG · edit** to see and edit the entire vector image. Both layers fit the same preview area, including when the source raster is small or downscaled.

Select objects in the preview or object selector. Click a palette swatch to select the first remaining object in that color cluster. Recolor, delete, or drag polygon vertices; **Reset edits** restores the conversion result. Object and text totals and SVG size update after edits.

**Download PNG** renders the current export SVG, so selection outlines, vertex handles, the checkerboard, and the original raster comparison are not included. PNG starts with transparency and uses the chosen output background. Exports above 32 megapixels or 16,384px on either edge are rejected with a request to use a smaller scale.

Background removal detects the dominant edge color and removes only matching regions connected to the image border. It works for colored backgrounds as well as white. Enclosed white icons, lettering, and panels remain intact. This is a border-based estimate rather than semantic object segmentation; use **Original** for images whose foreground touches most of the border. Background changes do not require another conversion.

For diagrams and small lettering, use a resolution near the source size rather than 600px. Keep **Smooth traced edges** and **Close tiny gaps between colors** enabled for cleaner lines. Turn them off for pixel-art boundaries. Color clustering produces a reduced palette, so gradients remain an approximation.

Conversion locks the input and settings until it finishes so files and results cannot overlap. Image-decoding and worker errors restore the controls for retry. If experimental OCR cannot run, tracing continues on the unmasked raster and the completion message explicitly reports geometry-only output.

## Experimental text recovery

When explicitly enabled, ClusterGlyph performs OCR before graphic tracing. Confident words are analyzed to recover:

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
   ├─ opt-in only ► Tesseract.js OCR (experimental)
   │                    │
   │                    ├── confidence filtering
   │                    ├── foreground/background color estimate
   │                    ├── font family/size/weight fit
   │                    └── native SVG <text>
   │
   ▼
Downscaled processing canvas
   │
   ├── detected text pixels selectively masked (only with successful OCR)
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
│   ├── ocr-loader.js
│   ├── png-export.js
│   ├── serializer.js
│   ├── worker.js
│   └── vectorizer.js
├── tests/
│   ├── browser/
│   │   └── smoke.mjs
│   ├── text-ocr.test.js
│   ├── ocr-loader.test.js
│   ├── png-export.test.js
│   ├── vector-quality.test.js
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

### 1. Optional experimental OCR and text reconstruction

When text detection is enabled, Tesseract.js recognizes words on the same downscaled canvas used for tracing. Low-confidence words are filtered. ClusterGlyph samples each word region to estimate foreground and background colors, estimates stroke density for font weight, and measures candidate browser fonts to choose a close family and size. Coordinates are then scaled back to the original raster dimensions. With text detection off, both OCR and text masking are skipped.

### 2. Text-aware raster masking

Before color clustering, likely glyph pixels inside detected OCR boxes are replaced with an estimated local background color. This reduces duplicate letter contours while trying to preserve the surrounding graphic region.

### 3. Perceptual color clustering

Sampled sRGB pixels are converted to CIE Lab. ClusterGlyph uses deterministic farthest-point initialization followed by k-means iterations. Centroids are learned from a capped sample for responsiveness, then all non-transparent pixels are classified.

### 4. Connected-object extraction

Color labels are only the segmentation stage. A connected-component pass then separates regions spatially, so two red objects that do not touch are exported as two independent vector objects even when both belong to the same color cluster.

Before tracing, a local label cleanup can remove low-contrast speckles. Small connected regions are merged through their adjacency graph into a nearby color, taking color distance and shared boundary length into account. They are not discarded, which avoids introducing transparent holes in opaque foregrounds. Isolated details with no opaque neighbor are kept. Palette entries retain their original cluster IDs after cleanup.

### 5. Contour tracing and polygon optimization

For each connected component, exposed raster-cell edges are emitted in a consistent orientation and chained into closed loops. Internal loops are retained so holes can be represented correctly.

Raw raster contours may contain thousands of adjacent points. ClusterGlyph first removes collinear vertices, then applies closed-polygon Ramer–Douglas–Peucker simplification.

Simplification adapts to narrow contours and checks signed area, retrying with a smaller tolerance if a line or hole would collapse. Optional quadratic rounding smooths short raster steps and shallow curves; long, sharp corners remain intact. Small same-color strokes provide overlap at shared edges to reduce antialiasing cracks. Both cleanup features can be disabled.

Sharp simple regions are serialized as editable SVG `<polygon>` elements. Smoothed regions and regions with holes use `<path fill-rule="evenodd">`. Their editable control-point rings remain in the object model.

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

There is no frontend build step. The application loads the pinned Tesseract.js browser bundle from jsDelivr only when you run vectorization with experimental OCR enabled; Tesseract language data may also be downloaded by the browser on first use. Enabling the checkbox alone does not download anything. Failed bundle downloads can be retried on a later run.

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
- lazy OCR loading, shared downloads, download errors, retries, and timeout recovery
- small-region merging without coverage holes, thin-line preservation, transparent input, and stable palette IDs
- edge-connected background removal while retaining white foreground details
- PNG scale and canvas-size limits

Tests also run automatically on pull requests and pushes to `main`. Browser checks cover PNG dimensions, current edits and alpha pixels, custom/original backgrounds, opt-in behavior, geometry export, OCR success/fallback with a deterministic recognition stub, editor interactions, input/worker errors, and responsive widths from 320px to 1440px. They verify integration behavior rather than OCR recognition accuracy. Desktop and mobile screenshots are saved as workflow artifacts.

To run the optional browser checks locally (Playwright is a test tool, not an application dependency):

```bash
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
npm run test:browser
```

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
