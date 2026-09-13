# Robustthreed STL Studio

A private, browser-based SVG and image relief generator implementing the user's confirmed Tinkercad workflow. Parallel **SVG input** and **Image input** buttons feed the same queue. Images automatically become bold, smooth, downloadable SVGs before entering the unchanged maximum-quality STL engine.

## Locked geometry

- Square SVG artboard scaled to **120 × 120 mm**, preserving the original margins.
- Filled outer silhouette from **Z = 0 to 1.6 mm**.
- Original artwork raised **0.6 mm**, ending at **Z = 2.2 mm**.
- Centered in X/Y and resting on Z = 0.
- Maximum-quality adaptive vector tessellation with **0.00001 mm chord tolerance** (200× tighter than the original 0.002 mm preset).
- One fused watertight solid, exported as binary STL in millimeter coordinates.

The original white linework copy is contained within the filled backing. The engine constructs the bottom, silhouette walls, exposed recesses and raised artwork directly from canonical vector contours. They share welded boundaries and form one exterior shell with no internal faces. This avoids the tiny triangles and long processing times introduced by Boolean unions of overlapping high-resolution extrusions. The manufacturing workflow is unchanged; this engine does not reproduce Tinkercad's proprietary Quality 24 tessellation algorithm or its exact triangles.

The tolerance controls curve sampling in millimeters before Float32 mesh/STL quantization. It is not a guarantee of printer resolution. Direct SVG inputs preserve source detail without image processing or smoothing. Up to 1,750,000 sampled points and 5,000,000 triangles are allowed; conversion stops at those limits instead of silently lowering quality. SVGs have a 450-second processing limit; image tracing plus STL conversion has a 540-second limit. The higher point budget and processing time allow detailed models to use the five-million-triangle ceiling while keeping the same curve tolerance. Actual triangle counts depend on the artwork; models are not padded with unnecessary triangles. A five-million-triangle binary STL is about 250 MB, and conversion also needs memory for the geometry and validation. Available browser memory can limit large conversions.

## Input contract

Up to 20 mixed artworks per tab. SVGs may be up to 5 MB each, with black and white fully opaque fills on a square artboard; compound paths, common transforms, circles, ellipses, rectangles and polygons are supported. White fills subtract in paint order. The starter full-page white rectangle contributes no geometry.

Within an SVG, strokes, text, embedded images, gradients, masks, clipping, CSS stylesheets, unsupported effects, non-square artboards and disconnected outer silhouettes fail with preparation instructions. The geometry engine does not stretch artwork to its bounding box, add bridges, or infer missing design intent. Prepare complex SVG designs as plain filled paths.

## Image tracing

Images may be up to 30 MB, 48 megapixels and 20,000 pixels per side. The decoder supports PNG, JPEG, WebP, GIF, BMP, AVIF, HEIC/HEIF, TIFF, ICO, PSD, TGA, JPEG XL, JPEG 2000, QOI, PNM and additional raster encodings supported by the packaged ImageMagick runtime. Unsupported encodings receive an export-as-PNG instruction. The first frame, first page or flattened composite is used. Embedded EXIF orientation is applied; transparency is composited on white. Non-square images retain their aspect ratio and existing margins, with square padding added before the 120 mm workflow.

Processing stays in the Web Worker: ImageMagick decodes and prepares the raster, then Potrace fits closed cubic curves and writes minimal black filled paths. Working resolution is 2,048–4,096 pixels on the longest side; smaller originals are enlarged for tracing. Automatic mode uses contrast separation for dark artwork and edge detection for coloured artwork with few dark lines. Dark backgrounds are detected and inverted. This is deterministic vector tracing, not generative redrawing: it cannot recover detail absent from a low-resolution image or automatically interpret every photograph. Clear line art on a plain background gives the closest result to the supplied Ganesha.

The default uses **Bold borders** and **Smooth curves**. Bold expands actual filled borders by approximately 0.12 mm in total at the locked artboard scale; Extra bold uses approximately 0.24 mm. Original weight skips expansion. Curve finish, trace sensitivity and dark-artwork/photo-outline mode can be adjusted and applied to regenerate an image. These controls never change imported SVGs, the artboard dimensions, layer heights or STL tolerance. Very small gaps can close as border weight increases; use Original weight or finer details when needed.

The **Image**, **SVG**, **Top** and **3D** tabs show the source, trace and finished geometry. **Download traced SVG** becomes available immediately after tracing, even if disconnected contours or excessive complexity prevent STL generation. Reimporting that SVG produces the same STL bytes. A valid single outer silhouette is still required; the generator never invents bridges or changes the old workflow to force an export.

SVG parsing and geometry run in a browser Web Worker using Manifold WASM. Three.js displays the actual exported mesh. Preview colors indicate height levels; STL has no color. Uploaded sources, geometry and downloads remain in tab memory; reloading clears them.

## Validation

Export is blocked unless the Float32 mesh has:
- one connected closed shell and two oppositely oriented faces per edge;
- positive signed volume matching the two planar layer areas;
- no duplicate or degenerate triangles;
- the locked 2.2 mm total thickness, Z = 0 bottom, and preserved 120 mm page bounds.

The supplied Walking Ganesha is the regression reference. At maximum quality its dimensions are approximately **91.977242 × 117.294655 × 2.200000 mm**, volume **9972.552982 mm³**, with **930,834 triangles** and a **46,541,784-byte** binary STL.

The restored five-million-triangle upgrade also passed a **4,868,196-triangle** curved-recess test: one watertight solid, **112 × 112 × 2.2 mm**, with a **243,409,884-byte** binary STL. The test independently checks the circular recesses' analytic volume. It took approximately 120 seconds and peaked at 3,255 MiB RSS in the Node test environment; this is a measured test result, not a browser performance guarantee. Use a desktop browser with enough available memory for models near the ceiling.

The precision tests integrate the original cubic SVG curves independently using Green's theorem and solve their extrema analytically. The exact vector-layer volume is approximately **9972.554114 mm³**. The new mesh differs by about **0.001132 mm³**, compared with **0.199795 mm³** for the previous preset. Bounds remain within 0.00003 mm of the original vector curves; thickness, page margins, nested cutouts and islands remain preserved. The older STL is a coarser approximation, so its approximate area and volume are no longer used as the accuracy target.

## Development and checks

Use the checked-in pnpm lockfile and Sites build flow.

```sh
pnpm test:engine
pnpm test:images
pnpm exec tsc --noEmit
pnpm build
node tests/packaged-worker.test.mjs
node --import tsx tests/large-mesh.test.ts
node --import tsx tests/large-mesh.test.ts --oversize
```

The geometry tests cover analytic source accuracy, deterministic bytes, nested islands, white cutouts, exterior cutouts, transforms, measured arc chord error, and intentionally rejected inputs. An optional output path passed to `tests/engine.test.ts` saves the exact Ganesha STL after all assertions pass. Image tests check actual format decoding, nested cutouts, transparency, square padding, filled border expansion, colour-outline detection, invalid images and exact SVG-to-STL round trips. The codec matrix generates and decodes PNG, JPEG, WebP, GIF, BMP, AVIF, TIFF, ICO, PSD, TGA, JPEG XL, JPEG 2000, QOI and PNM fixtures. HEIC decoding was separately checked using the upstream libheif example; HEIC encoding is not needed or supported by this application.

The packaged-worker test resolves the actual Worker constructor emitted into the client bundle, requires an HTTPS URL on the website origin, and loads that worker and its WASM with a worker-like Node harness. It exercises both SVG and image Blob inputs, lazy image-converter loading, the transferred preview and traced SVG, and an exact STL round trip. This catches internal file URLs that prevent browser startup. It is not browser UI or WebGL interaction testing.

The client imports the converter using Vite's `?worker` constructor so its public asset URL does not depend on an SSR-transformed `import.meta.url`. Startup and loading failures are reported separately from invalid SVGs and processing timeouts.

The production build retains the image decoder in the configured public client asset directory and removes only byte-identical, unused RSC/SSR copies of that WASM asset. This reduces publication upload size without altering the client converter or its geometry.

Optional WebMCP tools expose the same visible queue and export actions: `get_studio_state`, `convert_svgs`, `download_stl`, and `download_traced_svg`. They are feature-detected and removed on page unmount.

No database, object storage, application secrets or external conversion service is required.

Image tracing uses [esm-potrace-wasm](https://github.com/tomayac/esm-potrace-wasm) and [magick-wasm](https://github.com/dlemstra/magick-wasm). Their upstream licence texts and bundled image-codec notices are retained in `public/image-tracing-notices.txt`. The source and pinned dependency versions are in this private project repository.
