# ROBUSTTHREED ART-MODEL GENERATOR MAX

Convert images and SVG artwork into validated, high-quality STL relief models directly in your browser. This repository contains the complete editable application, pinned dependencies, tests, and GitHub Pages deployment workflow.

## Client access

Clients sign in with their own email/password account and need administrator
approval before the hosted workspace opens. The administrator can search,
approve, decline, and revoke individual accounts from the **Clients** screen.
Account data and approval permissions are enforced by Supabase; artwork stays on
the user's device. See [Client access setup](CLIENT_ACCESS_SETUP.md) for required
configuration, email delivery, administrator setup, and the limitations of
protecting a public browser-based converter.

## Five-million-triangle edition

- Up to **5,000,000 triangles** and **1,750,000 sampled curve points** per model.
- Parallel **SVG input** and **Image input**; images become bold, smooth, downloadable SVGs before entering the same STL engine.
- Fixed **0.00001 mm curve tolerance**, with no automatic quality reduction to fit a limit.
- One connected, watertight solid with checked winding, dimensions, and volume.
- Binary STL downloads and ZIP export for completed models.

The limit is a ceiling, not a target: simpler designs keep their natural triangle counts. A model near the ceiling can produce a roughly 250 MB STL and needs several GB of available browser memory. Use a desktop computer for large models. SVG conversion can run for up to 450 seconds; image tracing and conversion can run for up to 540 seconds.

## Locked manufacturing workflow

| Setting | Value |
| --- | --- |
| Square artboard | 120 × 120 mm |
| Silhouette backing | Z = 0–1.6 mm |
| Raised artwork | 0.6 mm, from Z = 1.6–2.2 mm |
| Total thickness | 2.2 mm |
| Placement | Centred in X/Y; bottom at Z = 0 |
| Curve tolerance | 0.00001 mm before Float32 STL quantization |

Original margins and proportions are preserved. Non-square images receive square padding. STL files use millimetre coordinates. Uploaded SVGs bypass image tracing and must contain compatible black/white filled paths with one connected outer silhouette.

## Use the application

1. Choose **SVG input** or **Image input**, or drop artwork into the upload area.
2. For images, compare the **Image** and **SVG** views and adjust border weight or smoothing if needed.
3. Inspect the finished model in **3D** or **Top** view.
4. Download the traced SVG, the validated STL, or a ZIP of completed STLs.

SVG files may be up to 5 MB. Images may be up to 30 MB, 48 megapixels, and 20,000 pixels per side. PNG, JPEG, WebP, GIF, BMP, AVIF, HEIC/HEIF, TIFF, ICO, PSD, TGA, JPEG XL, JPEG 2000, QOI and other supported raster formats are decoded in the browser. Animated or multi-page files use their first frame or page. Clear line art gives the best result. Up to 20 artworks fit in a tab; reloading clears the queue.

## GitHub Pages deployment

The included `.github/workflows/pages.yml` installs the pinned dependencies, checks TypeScript, builds the website, verifies the packaged SVG/image converter, and publishes only after those checks pass.

In **Settings → Pages**, select **GitHub Actions** as the publishing source. Pushes to `main` deploy automatically; the workflow can also be started manually from **Actions → Publish STL Studio**.

GitHub displays the actual live address after a successful deployment. The expected project address is `https://vedamrit01.github.io/ROBUSTTHREED_ART-MODEL_GENERATOR_MAX/`.

GitHub Pages requires an eligible plan for a private repository. Public repositories can use Pages on GitHub Free.

## Development

Use Node.js **24** and pnpm **11.19.0**:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Build and validate:

```sh
pnpm exec tsc --noEmit
pnpm build
pnpm test:pages
pnpm test:engine
pnpm preview
```

The static build is written to `dist-pages/`. Assets use relative URLs, including browser workers and WebAssembly, so deployment works under this repository's URL path. Serve the build through HTTP; do not open `index.html` with `file://`.

Optional large-model checks, each in a fresh process:

```sh
node --import tsx tests/large-mesh.test.ts
node --import tsx tests/large-mesh.test.ts --oversize
```

The near-limit test passed with **4,868,196 triangles**, a **243,409,884-byte STL**, and a single closed **112 × 112 × 2.2 mm** solid. The reference Ganesha retains **930,834 triangles** and its original dimensions and volume. Source-geometry validation was completed before this repository was prepared; the Pages workflow also verifies its own built converter.

## Privacy and components

Artwork, previews, and generated STL files stay in the visitor's browser tab. Supabase handles client authentication and approval records; it never receives artwork. No paid conversion API or server-side artwork upload is required. GitHub Pages serves the application assets.

React and Three.js provide the interface and preview. Manifold performs geometry operations; ImageMagick WASM decodes images; Potrace traces SVG curves. Third-party licence notices are retained in `public/image-tracing-notices.txt` and `vendor/`. See `ENGINE_DETAILS.md` for geometry and image-processing details. No licence has been specified for the original application code.
