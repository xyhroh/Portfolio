// Build-time image optimiser.
//
// You keep dropping full-size PNG/JPG exports into src/shelves/... exactly as
// before (no code, no manual resizing). When the site is BUILT (which is what
// GitHub Actions does on every push) each of those images is resized and
// converted to WebP, and the page loads the small version instead.
//
//   page images  -> max 1024 px wide
//   covers       -> max 2000 px wide (a cover is three panels in one image)
//   paper images -> max 1400 px wide
//
// During `npm run dev` nothing is converted, so editing stays instant.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const IMAGE_RE = /\.(png|jpe?g)$/i;

function maxWidthFor(file) {
  if (file.includes("/cover/")) return 2000;
  if (file.includes("/papers/")) return 1400;
  return 1024;
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
          .webp({ quality: 82, effort: 4 })
          .toBuffer();
        this.emitFile({ type: "asset", fileName, source: output });
        done.set(file, base + fileName);
      }
      return `export default ${JSON.stringify(done.get(file))};`;
    },
  };
}
