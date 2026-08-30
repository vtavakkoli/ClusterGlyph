# Contributing to ClusterGlyph

Thanks for helping improve ClusterGlyph.

## Development setup

ClusterGlyph is a static browser application with zero runtime dependencies.

```bash
git clone https://github.com/vtavakkoli/ClusterGlyph.git
cd ClusterGlyph
npm run serve
```

Open `http://localhost:8080`.

Run the test suite with:

```bash
npm test
```

## Before opening a pull request

Please make sure that:

1. `npm test` passes.
2. Browser behavior is tested with at least one small raster image.
3. Existing SVG object IDs and editor behavior remain stable unless the change intentionally modifies them.
4. UI changes work at desktop, tablet, and mobile widths.
5. The raster-to-SVG pipeline remains fully client-side unless a proposal explicitly discusses a different architecture.
6. New behavior is documented in the README when appropriate.

## Code style

- Keep the core vectorizer dependency-free unless a dependency provides a clear, measurable benefit.
- Prefer small pure functions in `src/vectorizer.js`.
- Keep DOM/UI behavior in `src/app.js`.
- Use the Web Worker for CPU-heavy vectorization work.
- Preserve semantic and accessible HTML.
- Avoid adding network calls to the vectorization path.

## Pull requests

Keep pull requests focused. A good PR description should include:

- what changed
- why it changed
- screenshots for meaningful UI changes
- algorithm/performance implications, when relevant
- tests added or updated

## Bug reports

Please include the browser, operating system, input image characteristics, vectorization settings, expected result, and actual result. Small reproducible sample images are especially useful.

## Feature proposals

For larger algorithmic changes such as Bézier fitting, rotated ellipse recovery, WebAssembly acceleration, or new segmentation approaches, open an issue first so the design can be discussed before implementation.
