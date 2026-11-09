// Build-time image optimiser.
//
// You keep dropping full-size PNG/JPG exports into src/shelves/... exactly as
// before (no code, no manual resizing). When the site is BUILT (which is what
// GitHub Actions does on every push) each of those images is resized and
// converted to WebP, and the page loads the small version instead.
//
//   page images  -> max 1600 px wide
//   covers       -> max 2000 px wide (a cover is three panels in one image)
//   paper images -> max 1600 px wide
//
// Page images used to be capped at 1024 px, which was the real reason the
// deployed site looked softer than `npm run dev` (dev serves the originals
// untouched). A page scan is a document: by the time 1024 px is fitted to the
// screen and squeezed through a mipmap, body text has nothing left. 1600 px is
// about the point where that stops being the limiting factor.
//
// During `npm run dev` nothing is converted, so editing stays instant.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const IMAGE_RE = /\.(png|jpe?g)$/i;

function maxWidthFor(file) {
  if (file.includes("/cover/")) return 2000;
  if (file.includes("/papers/")) return 1600;
  return 1600;
}

// Pages are text, and text is what webp's quality setting shows first.
function qualityFor(file) {
  if (file.includes("/cover/")) return 82; // artwork: 82 is invisible
  return 88;
}

export default function optimiseImages() {
  let base = "./";
  let isBuild = false;
  const done = new Map(); // source file -> public url

  return {
    name: "optimise-shelf-images",
    enforce: "pre",
    configResolved(config) {
      base = config.base.endsWith("/") ? config.base : config.base + "/";
      isBuild = config.command === "build";
    },
    async load(id) {
      const file = id.split("?")[0].replace(/\\/g, "/");
      if (!isBuild || !file.includes("/src/shelves/") || !IMAGE_RE.test(file)) return null;

      if (!done.has(file)) {
        const input = fs.readFileSync(file);
        const hash = crypto.createHash("sha1").update(input).digest("hex").slice(0, 8);
        const name = path.basename(file).replace(IMAGE_RE, "").replace(/[^a-zA-Z0-9_-]+/g, "-");
        const fileName = `img/${name}-${hash}.webp`;
        const output = await sharp(input)
          .rotate()
          .resize({ width: maxWidthFor(file), withoutEnlargement: true })
          .webp({ quality: qualityFor(file), effort: 4 })
          .toBuffer();
        this.emitFile({ type: "asset", fileName, source: output });
        done.set(file, base + fileName);
      }
      return `export default ${JSON.stringify(done.get(file))};`;
    },
  };
}
