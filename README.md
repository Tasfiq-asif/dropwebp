# DropWebP

DropWebP is a private, local batch WebP converter for the browser. Drop JPG or PNG images, choose a quality level, preview estimated output size, convert locally with libwebp WebAssembly, and download individual WebP files or a ZIP.

No upload. No server processing. No tracking.

## Features

- Batch JPG, JPEG, and PNG input
- Drag-and-drop or file picker
- Local WebP encoding with `@jsquash/webp` and libwebp WebAssembly
- Quality slider with automatic estimated output size
- Per-image conversion status and output sizes
- Individual WebP download links
- ZIP download for the full batch
- Unsupported file handling
- Responsive browser UI

## Tech Stack

- Vite
- Vanilla HTML/CSS/JavaScript
- `@jsquash/webp` for libwebp WebAssembly encoding
- `jszip` for ZIP downloads

## Run Locally

```bash
npm install
npm run open
```

Or start the dev server without opening a browser:

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Privacy

DropWebP processes images in your browser. Files are not uploaded to a server by this app.

## Roadmap

- Resize controls
- Target file-size mode
- Lossless WebP option
- Before/after visual comparison
- Offline/PWA support
- GitHub Pages demo

## License

MIT
