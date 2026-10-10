import { defineConfig } from "vite";

// GitHub Pages serves project sites from a /<repo-name>/ subpath. A relative
// base keeps asset URLs working under any repo name (it broke once on a
// rename: the old hardcoded prefix 404ed every JS/CSS file).
//
// Two pages: index.html (home + lanyard) and library.html (the bookshelf).
// Vite only builds pages listed in `input`. The lanyard is written in JSX,
// so esbuild needs the automatic runtime (no `import React` in each file).
export default defineConfig({
  base: "./",
  esbuild: { jsx: "automatic" },
  build: {
    rollupOptions: {
      input: { main: "index.html", library: "library.html" },
    },
  },
});
