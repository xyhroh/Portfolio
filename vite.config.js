import { defineConfig } from "vite";
import optimiseImages from "./vite-plugins/optimise-images.js";

// GitHub Pages serves project sites from a /<repo-name>/ subpath. A relative
// base keeps asset URLs working under any repo name (it broke once on a
// rename: the old hardcoded prefix 404ed every JS/CSS file).
//
// Three pages: index.html (home + lanyard), about.html and library.html (the
// bookshelf). Vite only builds pages listed in `input`: a page missing here
// is left out of dist/ and 404s on the live site. The lanyard is written in JSX,
// so esbuild needs the automatic runtime (no `import React` in each file).
export default defineConfig({
  base: "./",
  esbuild: { jsx: "automatic" },
  plugins: [optimiseImages()],
  build: {
    rollupOptions: {
      input: { main: "index.html", about: "about.html", library: "library.html" },
    },
  },
});
