# Security Policy

## Supported version

ClusterGlyph is a client-side static application. Security fixes are applied to the latest version on the `main` branch.

## Reporting a vulnerability

Please do **not** disclose a suspected vulnerability in a public GitHub issue.

Use GitHub's private vulnerability reporting feature for this repository when available. If private reporting is unavailable, contact the repository owner through the contact information on the owner's GitHub profile.

When reporting, include:

- a clear description of the issue
- affected browser/version where relevant
- reproduction steps
- potential impact
- any suggested mitigation

## Security model

ClusterGlyph is designed to process raster images locally in the browser and does not require a backend service for vectorization.

Security-sensitive changes should preserve these properties where possible:

- no raster-image upload is required
- no API key is required
- no remote code is required for the vectorization engine
- exported SVG should be generated from application-owned serialization logic rather than injecting arbitrary input markup

Third-party additions that introduce network access, executable remote content, or runtime dependencies should receive additional review.
