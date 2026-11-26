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
// Books are addressable as /book/<slug>. In production GitHub Pages 404s that
// path and public/404.html bounces it to library.html?book=<slug>; the dev
// server has no 404.html fallback, so reloading a book link under `npm run dev`
// would simply fail. This serves library.html for those paths instead, so dev
// and the live site behave the same.
function bookRoutes() {
  return {
    name: "book-routes",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [path, query] = (req.url ?? "").split("?");
        const match = path.match(/^\/book\/([^/]+)\/?$/);
        if (match) req.url = `/library.html?book=${match[1]}${query ? `&${query}` : ""}`;
        next();
      });
    },
  };
}

export default defineConfig({
  base: "./",
  esbuild: { jsx: "automatic" },
  plugins: [optimiseImages(), bookRoutes()],
  build: {
    rollupOptions: {
      input: { main: "index.html", about: "about.html", library: "library.html" },
    },
  },
});
