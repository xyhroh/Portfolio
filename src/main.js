import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import gsap from "gsap";

// -----------------------------------------------------------------------
// 1. BASIC SCENE SETUP
// -----------------------------------------------------------------------

const scene = new THREE.Scene();
// No opaque background color — the canvas clears to fully transparent
// (see the renderer's alpha/clearColor setup below) so the hero text in
// index.html, sitting behind the canvas in stacking order, shows through
// everywhere the 3D scene doesn't draw over it. Fog still fades distant
// geometry toward white, matching the page's actual white background.
scene.fog = new THREE.Fog(0xffffff, 9, 22);

// #app isn't always the full viewport — in portrait (see style.css) it's
// a left column beside the shelf-info blurb, so the renderer/camera are
// sized off #app's own box rather than window.innerWidth/innerHeight.
// That single indirection is what makes the 3D scene correctly fit
// whatever box CSS actually gives it, on any screen shape.
const appEl = document.getElementById("app");
function getViewportSize() {
  return { width: appEl.clientWidth, height: appEl.clientHeight };
}

const camera = new THREE.PerspectiveCamera(45, getViewportSize().width / getViewportSize().height, 0.1, 100);

// antialias off + a capped pixel ratio + cheaper (non-soft) shadow
// filtering are the standard three.js levers for GPU fragment-shading
// cost — the biggest remaining cost once only one shelf renders at a
// time (see the carousel visibility toggling in section 6) is just the
// sheer fill rate of a high-DPI canvas with soft shadows, not anything
// CPU-side in the render loop.
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
renderer.setClearColor(0xffffff, 0);
renderer.setSize(getViewportSize().width, getViewportSize().height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById("app").appendChild(renderer.domElement);

// A softly lit interior used purely as a reflection/ambient source (via
// PMREM), not as a visible background — this is what keeps varnished wood
// and the metal drawer handle from looking flat/matte like an unlit
// low-poly render, without needing an external HDRI file.
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
pmremGenerator.dispose();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 1.5;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI / 1.9;
// A two-finger drag (or right-click drag on desktop) would otherwise pan
// the orbit target off the shelf entirely, with no way to get it back —
// this is a lookaround piece, not a pannable scene.
controls.enablePan = false;

// Capped to a shallow peek around dead-ahead (the camera's default
// azimuth is 0, facing +Z toward the shelf) — wide enough to feel like
// looking around the cabinet, not wide enough to swing past its side and
// into the neighboring carousel shelf.
//
// OrbitControls' own minAzimuthAngle/maxAzimuthAngle are a hard wall —
// the instant the drag reaches the limit it just stops dead. Left
// uncapped here and enforced manually instead (see clampOrbitAzimuth in
// the render loop) as a rubber band: dragging past the limit is
// increasingly resisted rather than blocked outright, and letting go
// eases the camera back to the limit instead of leaving it pinned.
const azimuthSoftLimit = Math.PI / 4;
const azimuthSpring = 0.12; // higher = snappier pull-back, lower = looser/more give

// Hemisphere light replaces a flat ambient — a neutral "ceiling" tone and
// a lighter "floor" tone (bounced light off the white backdrop) give
// surfaces gentle directional variation instead of a uniform flat fill.
// Kept close to neutral white (rather than warm amber) so the piece reads
// as lit by an overcast studio window, not a cozy fireplace — closer to
// product photography than a game scene.
const hemiLight = new THREE.HemisphereLight(0xffffff, 0xdcdcdc, 0.6);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xf7f5f1, 1.5);
keyLight.position.set(3, 5.5, 4.5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024); // halved for performance — not noticeably softer at the camera distances this scene uses
keyLight.shadow.camera.left = -3.5;
keyLight.shadow.camera.right = 3.5;
keyLight.shadow.camera.top = 4;
keyLight.shadow.camera.bottom = -3;
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 15;
keyLight.shadow.bias = -0.0015;
keyLight.shadow.radius = 3;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xe9e9e9, 0.4);
fillLight.position.set(-4, 2, 2);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xd7dee8, 0.3);
rimLight.position.set(-1, 3, -5);
scene.add(rimLight);

// -----------------------------------------------------------------------
// 1b. INTRO ROLE ROTATOR
// The word after "Hi there! I'm Javier a" (index.html) cycles through the
// lines of public/roles.txt — plain text, one role per line. Add, remove,
// or rename roles there and refresh the page; nothing here needs to change.
// -----------------------------------------------------------------------

const introRoleEl = document.getElementById("intro-role");
const introRoleSwapMs = 250; // must match the CSS transition duration on #intro-role
const introRoleHoldMs = 2200;

async function startIntroRoleRotation() {
  let roles = ["UX Strategist"]; // used only if roles.txt is missing/empty
  try {
    // BASE_URL (not a hardcoded "/") so this still resolves once deployed
    // under a subpath, e.g. GitHub Pages serving from /Portfolio/.
    const res = await fetch(`${import.meta.env.BASE_URL}roles.txt`);
    const text = await res.text();
    const parsed = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (parsed.length > 0) roles = parsed;
  } catch {
    // roles.txt missing or unreadable — fall back to the default above
  }

  let index = 0;
  introRoleEl.textContent = roles[0];
  if (roles.length <= 1) return;

  setInterval(() => {
    introRoleEl.classList.add("swapping");
    setTimeout(() => {
      index = (index + 1) % roles.length;
      introRoleEl.textContent = roles[index];
      introRoleEl.classList.remove("swapping");
    }, introRoleSwapMs);
  }, introRoleHoldMs);
}

startIntroRoleRotation();

// -----------------------------------------------------------------------
// 2. BOOKSHELF DATA
// There's more than one physical bookshelf now, arranged in a carousel
// (section 6) — each one comes from its own folder under
// src/shelves/, e.g. src/shelves/Bookshelf 1/, src/shelves/Bookshelf 2/.
// Inside each shelf folder, projects work exactly like before: every
// folder under that shelf's pages/ becomes one book —
//   src/shelves/<Shelf Name>/pages/<Your Project>/cover/   one cover PNG
//   src/shelves/<Shelf Name>/pages/<Your Project>/pages/   page images
// and every folder under that shelf's papers/ becomes one drawer paper.
// Add or rename a project/paper folder and it appears/updates on that
// shelf automatically — no code changes needed.
//
// Optionally, group a project's pages/ into numbered subfolders to get
// sticky navigation tabs, one per subfolder, e.g.:
//   pages/1 Introduction/1.png, 2.png
//   pages/2 Target Audience/1.png, 2.png
// The number controls tab order; the rest of the folder name becomes
// the tab label. Clicking a tab flips straight to that section.
// -----------------------------------------------------------------------

// Muted, desaturated tones — institutional navy/charcoal/slate rather than
// bright saturated primaries — so the shelf reads as a formal, professional
// portfolio piece instead of a row of colorful toy blocks.
const palette = [0x2f3c4c, 0x4a4038, 0x3a4a42, 0x4a3838, 0x3d3d3d, 0x39445a];

// -----------------------------------------------------------------------
// 2b. AUTO-LOADING SHELF/PROJECT/PAPER FOLDERS
// Vite's import.meta.glob scans matching files at build/dev time. A shelf
// folder that's still empty (no images dropped in yet, like a brand new
// bookshelf) has nothing for the scan to find, so it wouldn't show up on
// its own — that's why the shelf names themselves are also listed
// explicitly below. Any shelf that already has real images in it is
// picked up automatically too, so a third shelf with real content never
// needs a code change, only an entry in knownShelfNames below (or none,
// if it already has files).
// -----------------------------------------------------------------------

const knownShelfNames = ["Bookshelf 1", "Bookshelf 2"];

const pageImageModules = import.meta.glob(
  "/src/shelves/*/pages/*/pages/**/*.{png,jpg,jpeg,webp}",
  { eager: true }
);
const coverImageModules = import.meta.glob(
  "/src/shelves/*/pages/*/cover/*.{png,jpg,jpeg,webp}",
  { eager: true }
);
const paperImageModules = import.meta.glob("/src/shelves/*/papers/*/*.{png,jpg,jpeg,webp}", {
  eager: true,
});
// The header + body blurb shown on the right of the screen (see the
// #shelf-info panel in index.html) for each shelf — one info.txt per
// shelf, its first line the header and everything after that the body.
const shelfInfoModules = import.meta.glob("/src/shelves/*/info.txt", {
  eager: true,
  query: "?raw",
  import: "default",
});

function naturalCompare(pathA, pathB) {
  const numA = parseInt(pathA.match(/(\d+)(?!.*\d)/)?.[0] ?? "0", 10);
  const numB = parseInt(pathB.match(/(\d+)(?!.*\d)/)?.[0] ?? "0", 10);
  if (numA !== numB) return numA - numB;
  return pathA.localeCompare(pathB);
}

function slugify(folder) {
  return folder
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function parseShelfProjectPath(path) {
  const m = path.match(/^\/src\/shelves\/([^/]+)\/pages\/([^/]+)\//);
  return m ? { shelf: m[1], folder: m[2] } : null;
}

function parseShelfPaperPath(path) {
  const m = path.match(/^\/src\/shelves\/([^/]+)\/papers\/([^/]+)\//);
  return m ? { shelf: m[1], folder: m[2] } : null;
}

const projectFoldersByShelf = new Map(); // shelfName -> Set(projectFolder)
const paperFoldersByShelf = new Map(); // shelfName -> Set(paperFolder)

[...Object.keys(pageImageModules), ...Object.keys(coverImageModules)].forEach((path) => {
  const parsed = parseShelfProjectPath(path);
  if (!parsed) return;
  if (!projectFoldersByShelf.has(parsed.shelf)) projectFoldersByShelf.set(parsed.shelf, new Set());
  projectFoldersByShelf.get(parsed.shelf).add(parsed.folder);
});

Object.keys(paperImageModules).forEach((path) => {
  const parsed = parseShelfPaperPath(path);
  if (!parsed) return;
  if (!paperFoldersByShelf.has(parsed.shelf)) paperFoldersByShelf.set(parsed.shelf, new Set());
  paperFoldersByShelf.get(parsed.shelf).add(parsed.folder);
});

// Numeric order (Bookshelf 1, 2, 3, ... 10), not plain string order —
// a plain .sort() would put "Bookshelf 10" before "Bookshelf 2" once
// there are more than nine shelves.
const shelfNames = Array.from(
  new Set([...knownShelfNames, ...projectFoldersByShelf.keys(), ...paperFoldersByShelf.keys()])
).sort((a, b) => leadingNumber(a) - leadingNumber(b) || a.localeCompare(b));

function leadingNumber(str) {
  const match = str.match(/\d+/);
  return match ? parseInt(match[0], 10) : Number.MAX_SAFE_INTEGER;
}

// Strips a page/section filename down to its display label, e.g.
// "1 Introduction" or "1-introduction.png" -> "Introduction".
function stripLeadingNumber(str) {
  return str.replace(/^\s*\d+\s*[-.)]?\s*/, "").replace(/\.[a-z0-9]+$/i, "");
}

// Pages can sit directly in `pages/` (a plain book, no tabs) or be
// grouped into numbered subfolders like `pages/1 Introduction/`,
// `pages/2 Target Audience/` — one sticky tab per subfolder, in
// numeric order, jumping to that subfolder's first page. Loose files
// left directly in `pages/` alongside section subfolders are treated
// as untabbed front matter and placed before the first tab.
function pagesAndSectionsForFolder(shelfName, folder) {
  const prefix = `/src/shelves/${shelfName}/pages/${folder}/pages/`;
  const matches = Object.entries(pageImageModules)
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, mod]) => {
      const rest = path.slice(prefix.length).split("/");
      const section = rest.length > 1 ? rest[0] : null;
      const filename = rest[rest.length - 1];
      return { mod, section, filename };
    });

  if (matches.length === 0) {
    // no images dropped in yet — a friendly placeholder instead of an
    // empty, broken-looking book
    return {
      pages: [{ label: `Add PNGs to ${prefix}`, color: "#e7dcc9" }],
      sections: [],
    };
  }

  const byFilename = (a, b) =>
    leadingNumber(a.filename) - leadingNumber(b.filename) || a.filename.localeCompare(b.filename);

  const pages = [];
  const sections = [];

  matches
    .filter((m) => !m.section)
    .sort(byFilename)
    .forEach((m) => pages.push({ image: m.mod.default }));

  const sectionFolders = Array.from(new Set(matches.filter((m) => m.section).map((m) => m.section))).sort(
    (a, b) => leadingNumber(a) - leadingNumber(b) || a.localeCompare(b)
  );

  sectionFolders.forEach((sectionFolder) => {
    sections.push({ label: stripLeadingNumber(sectionFolder), startIndex: pages.length });
    matches
      .filter((m) => m.section === sectionFolder)
      .sort(byFilename)
      .forEach((m) => pages.push({ image: m.mod.default }));
  });

  return { pages, sections };
}

function coverForFolder(shelfName, folder) {
  const prefix = `/src/shelves/${shelfName}/pages/${folder}/cover/`;
  const [, mod] =
    Object.entries(coverImageModules)
      .filter(([path]) => path.startsWith(prefix))
      .sort(([a], [b]) => naturalCompare(a, b))[0] ?? [];
  return mod ? mod.default : null;
}

function buildProjectsForShelf(shelfName) {
  const folders = Array.from(projectFoldersByShelf.get(shelfName) ?? []).sort();
  const projects = folders.map((folder, i) => ({
    title: folder,
    slug: slugify(folder),
    folder,
    color: palette[i % palette.length],
    description: "A short blurb about this project and the problem it explores.",
  }));
  projects.forEach((project) => {
    const { pages, sections } = pagesAndSectionsForFolder(shelfName, project.folder);
    project.pages = pages;
    project.sections = sections;
    project.coverImage = coverForFolder(shelfName, project.folder);
  });
  return projects;
}

function buildPapersForShelf(shelfName) {
  const folders = Array.from(paperFoldersByShelf.get(shelfName) ?? []).sort();
  return folders.map((folder) => {
    const prefix = `/src/shelves/${shelfName}/papers/${folder}/`;
    const pages = Object.entries(paperImageModules)
      .filter(([path]) => path.startsWith(prefix))
      .sort(([a], [b]) => naturalCompare(a, b))
      .map(([, mod]) => mod.default);
    return { title: folder, folder, slug: slugify(folder), pages };
  });
}

// The #shelf-info panel's header/body for a shelf — the first line of
// its info.txt is the header, everything after that (trimmed) is the
// body. No info.txt yet? A friendly placeholder pointing at where to
// add one, same spirit as the "drop images here" placeholders above.
function buildInfoForShelf(shelfName) {
  const content = shelfInfoModules[`/src/shelves/${shelfName}/info.txt`];
  if (!content) {
    return {
      header: shelfName,
      body: `Add src/shelves/${shelfName}/info.txt to customize this text — first line is the header, the rest is the body.`,
    };
  }
  const [firstLine, ...rest] = content.split("\n");
  return { header: firstLine.trim(), body: rest.join("\n").trim() };
}

const shelvesData = shelfNames.map((name) => ({
  name,
  projects: buildProjectsForShelf(name),
  papers: buildPapersForShelf(name),
  info: buildInfoForShelf(name),
}));

// -----------------------------------------------------------------------
// 3. SHARED CABINET GEOMETRY
// Every bookshelf in the carousel is built to these exact same
// dimensions — including `numberOfRows`, sized off whichever shelf has
// the most projects — so they all read as identical furniture and the
// camera framing computed once in section 7 stays correct no matter
// which one has rotated to the front.
// -----------------------------------------------------------------------

const bookWidth = 0.15; // spine thickness — kept slim, like a real hardcover, not a ream of paper
const bookHeight = 0.88; // halved — shelved books were reading too tall against the shelf
const bookDepth = 0.825; // 0.75 + 10%
const gap = 0.06;
const booksPerRow = 8; // <-- tune this to control shelf width / row count

const bookAreaHeight = bookHeight + 0.1; // tighter clearance above/below each row than before
const frameThickness = 0.2;
const shelfWidth = booksPerRow * bookWidth + (booksPerRow - 1) * gap + 0.25; // a little slack for one more book before it wraps
const numberOfRows = Math.max(2, ...shelvesData.map((s) => Math.ceil(s.projects.length / booksPerRow))); // always show at least one spare row
const outerWidth = shelfWidth + frameThickness * 2;
const outerHeight = numberOfRows * bookAreaHeight + (numberOfRows + 1) * frameThickness;
const shelfBaseY = 0; // where the bottom-most row's books sit

// The drawer (built in section 5b) is a cavity recessed inside the same
// cabinet carcass, not a separate box bolted underneath — so its extent
// has to be known here too, before the side/back panels below are sized
// to wrap around both the shelf rows and the drawer as one shell.
const drawerHeight = 0.55;
const drawerGapBelowShelf = 0.03;
const drawerCenterY = shelfBaseY - frameThickness - drawerGapBelowShelf - drawerHeight / 2;
const drawerBottomY = drawerCenterY - drawerHeight / 2;

// Procedural wood grain: a tileable color map plus a matching bump map, so
// the cabinet reads as varnished hardwood rather than a flat, low-poly
// brown box. No external texture files — both are drawn on a canvas the
// same way the spine/tab labels already are. Generated once and shared
// across every shelf instance, so every cabinet in the carousel has the
// exact same finish.
function createWoodGrainTextures(baseHex, grainHex, seed = 1) {
  const width = 512;
  const height = 512;
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = width;
  colorCanvas.height = height;
  const colorCtx = colorCanvas.getContext("2d");

  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = width;
  bumpCanvas.height = height;
  const bumpCtx = bumpCanvas.getContext("2d");

  colorCtx.fillStyle = baseHex;
  colorCtx.fillRect(0, 0, width, height);
  bumpCtx.fillStyle = "#808080";
  bumpCtx.fillRect(0, 0, width, height);

  // a simple seeded PRNG so the same "seed" always draws the same grain,
  // instead of a fresh random pattern (and a fresh flash of visual noise)
  // on every reload
  let s = seed * 9301 + 49297;
  function rand() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  }

  const grainLines = 46;
  for (let i = 0; i < grainLines; i++) {
    const y = (i / grainLines) * height + (rand() - 0.5) * 10;
    const alpha = 0.08 + rand() * 0.16;
    const lift = rand() > 0.5;

    [colorCtx, bumpCtx].forEach((ctx, ctxIndex) => {
      ctx.strokeStyle =
        ctxIndex === 0 ? grainHex : lift ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
      ctx.globalAlpha = ctxIndex === 0 ? alpha : 1;
      ctx.lineWidth = 1 + rand() * 2.5;
      ctx.beginPath();
      let x = 0;
      ctx.moveTo(x, y);
      while (x < width) {
        x += 24 + rand() * 40;
        const wobble = (rand() - 0.5) * 14;
        ctx.lineTo(x, y + wobble);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }

  // fine speckle noise on top, so it doesn't read as perfectly smooth
  // repeating streaks up close
  for (let i = 0; i < 2200; i++) {
    const x = rand() * width;
    const y = rand() * height;
    const shade = rand() * 40 - 20;
    bumpCtx.fillStyle = `rgba(${128 + shade},${128 + shade},${128 + shade},0.5)`;
    bumpCtx.fillRect(x, y, 1.5, 1.5);
  }

  const colorTexture = new THREE.CanvasTexture(colorCanvas);
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  colorTexture.wrapS = THREE.RepeatWrapping;
  colorTexture.wrapT = THREE.RepeatWrapping;
  colorTexture.repeat.set(2.5, 2.5);

  const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
  bumpTexture.wrapS = THREE.RepeatWrapping;
  bumpTexture.wrapT = THREE.RepeatWrapping;
  bumpTexture.repeat.set(2.5, 2.5);

  return { colorTexture, bumpTexture };
}

// A dark, cool-toned walnut/espresso finish (rather than a bright orange
// "toy wood") — the kind of understated furniture finish that reads as
// institutional/office-grade instead of playful.
const mainWoodGrain = createWoodGrainTextures("#3f342a", "#2a2119", 7);
const backWoodGrain = createWoodGrainTextures("#332a22", "#221b15", 13);

// MeshPhysicalMaterial with only a hair of clearcoat — enough to avoid a
// completely dead-flat matte look, but far short of the glossy "lacquered
// toy" sheen a higher clearcoat gives.
const woodMaterial = new THREE.MeshPhysicalMaterial({
  map: mainWoodGrain.colorTexture,
  bumpMap: mainWoodGrain.bumpTexture,
  bumpScale: 0.5,
  color: 0xffffff,
  roughness: 0.75,
  metalness: 0.03,
  clearcoat: 0.05,
  clearcoatRoughness: 0.7,
});
const backWoodMaterial = new THREE.MeshPhysicalMaterial({
  map: backWoodGrain.colorTexture,
  bumpMap: backWoodGrain.bumpTexture,
  bumpScale: 0.5,
  color: 0xffffff,
  roughness: 0.8,
  metalness: 0.03,
  clearcoat: 0.03,
  clearcoatRoughness: 0.75,
});

// A small chamfer, not a rounded pill edge — enough to soften the harsh
// CAD-model look of a perfectly sharp 90° edge under light, without
// reading as the puffy, toy-like rounding of a much larger radius.
function roundedBox(width, height, depth) {
  return new RoundedBoxGeometry(width, height, depth, 3, 0.008);
}

const shelfCenterY = shelfBaseY + outerHeight / 2 - frameThickness / 2;
const shelfDepth = bookDepth + 0.25;

// The cabinet's outer shell spans from the top of the shelf rows all the
// way down past the drawer cavity and a closing base board beneath it,
// so the drawer sits enclosed inside continuous side/back paneling
// instead of hanging underneath as its own exposed box.
const cabinetTopEdgeY = shelfBaseY - frameThickness + outerHeight;
const cabinetFloorY = drawerBottomY - frameThickness;
const cabinetHeight = cabinetTopEdgeY - cabinetFloorY;
const cabinetCenterY = (cabinetTopEdgeY + cabinetFloorY) / 2;

// A ground-level shadow catcher — invisible except where a shadow falls
// on it — so the cabinet and legs read as resting on a surface instead of
// floating in empty space against the flat background color. One shared
// floor under the whole carousel, not per-shelf.
const shadowCatcher = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.ShadowMaterial({ opacity: 0.18 })
);
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.position.y = cabinetFloorY - 0.22 - 0.001;
shadowCatcher.receiveShadow = true;
scene.add(shadowCatcher);

// -----------------------------------------------------------------------
// 4. TEXTURE HELPERS
// Canvas-drawing fallbacks used until real art is dropped into a
// project's folders: a spine label (folder name), and a page-content
// placeholder shown for any page slot that failed to load an image.
// -----------------------------------------------------------------------

function createSpineTexture(title, hexColor) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = `#${hexColor.toString(16).padStart(6, "0")}`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 40px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(title, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createPagePlaceholderTexture(label, hexOrCssColor) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 700;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = hexOrCssColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#3a2a17";
  ctx.font = "bold 34px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createTitlePageTexture(project) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 700;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#fdf8ef";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#3a2a17";
  ctx.font = "bold 42px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(project.title, canvas.width / 2, 140);

  ctx.font = "20px system-ui, sans-serif";
  ctx.fillStyle = "#5a4a38";
  wrapText(ctx, project.description, canvas.width / 2, 210, 400, 28);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let cursorY = y;
  for (const word of words) {
    const testLine = line + word + " ";
    if (ctx.measureText(testLine).width > maxWidth && line !== "") {
      ctx.fillText(line, x, cursorY);
      line = word + " ";
      cursorY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, cursorY);
}

const textureLoader = new THREE.TextureLoader();

// Each side of a leaf is split into a spine-side and an outer-side segment
// (see the hinge-building code below) so it can bend at the crease while
// flipping. Both segments on one side share one image, so once it's loaded
// (or placeholder'd), this slices it into left/right halves the same way
// applyCoverWrap slices a cover into its three panels.
//
// `reversed` is used for the back (verso) face of a leaf: once a leaf
// flips over onto the left-hand pile, it's mirrored, so the half that sat
// nearest the spine on the front now sits nearest the spine on the back
// too, but that's the OPPOSITE mesh segment (inner vs outer) from where
// the front's near-spine half lived. Swapping which half goes to which
// segment keeps left-to-right reading order correct once flipped.
function applyPageSide(innerMaterial, outerMaterial, page, reversed) {
  function useTexture(tex) {
    // The two mesh segments together are a fixed pageWidth x pageHeight
    // box, but a source page image rarely matches that aspect exactly
    // (a landscape slide vs. a portrait-ish page) — mapping the WHOLE
    // image onto that box regardless stretched it to fit, which is what
    // read as slightly distorted/warped text. Crop instead of stretch:
    // center-crop the source to pageWidth:pageHeight ("cover", like CSS
    // background-size: cover) before slicing that crop in half, so nothing
    // in it ever changes proportions, only how much of the edges show.
    const imageAspect = tex.image.width / tex.image.height;
    const targetAspect = pageWidth / pageHeight;
    let repeatX = 1;
    let repeatY = 1;
    let offsetX = 0;
    let offsetY = 0;
    if (imageAspect > targetAspect) {
      repeatX = targetAspect / imageAspect;
      offsetX = (1 - repeatX) / 2;
    } else {
      repeatY = imageAspect / targetAspect;
      offsetY = (1 - repeatY) / 2;
    }

    const leftHalf = tex.clone();
    leftHalf.needsUpdate = true;
    leftHalf.repeat.set(repeatX * 0.5, repeatY);
    leftHalf.offset.set(offsetX, offsetY);
    const rightHalf = tex.clone();
    rightHalf.needsUpdate = true;
    rightHalf.repeat.set(repeatX * 0.5, repeatY);
    rightHalf.offset.set(offsetX + repeatX * 0.5, offsetY);
    innerMaterial.map = reversed ? rightHalf : leftHalf;
    innerMaterial.needsUpdate = true;
    outerMaterial.map = reversed ? leftHalf : rightHalf;
    outerMaterial.needsUpdate = true;
  }

  if (!page) {
    // no image for this side (an odd page count leaves one leaf's back
    // empty) — leave it a plain blank sheet instead of loading anything
    innerMaterial.map = null;
    outerMaterial.map = null;
    innerMaterial.needsUpdate = true;
    outerMaterial.needsUpdate = true;
    return;
  }

  if (page.image) {
    textureLoader.load(
      page.image,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        useTexture(tex);
      },
      undefined,
      () => useTexture(createPagePlaceholderTexture(page.label || "?", page.color || "#e7dcc9"))
    );
  } else {
    useTexture(createPagePlaceholderTexture(page.label || "", page.color || "#e7dcc9"));
  }
}

// Applies both faces of one physical leaf: `front` (recto, visible while
// unflipped) and `back` (verso, revealed once the leaf turns over) — see
// buildLeaves() for how consecutive page images get paired into a leaf.
function applyLeafContent(innerMaterial, outerMaterial, innerBackMaterial, outerBackMaterial, leaf) {
  applyPageSide(innerMaterial, outerMaterial, leaf.front, false);
  applyPageSide(innerBackMaterial, outerBackMaterial, leaf.back, true);
}

// Pairs up a project's flat page-image list into double-sided leaves —
// each leaf shows one image on its front and the next on its back, like
// real printed pages, instead of a blank reverse side. Pairing restarts
// at the start of the untabbed front matter and at every section, so a
// tab always lands on the FRONT of a leaf rather than being buried on
// the back of the page before it.
function buildLeaves(project) {
  const bounds = [0, ...project.sections.map((s) => s.startIndex), project.pages.length];
  const leaves = [];
  const sectionLeafStart = new Array(project.sections.length).fill(0);

  for (let run = 0; run < bounds.length - 1; run++) {
    if (run >= 1) sectionLeafStart[run - 1] = leaves.length;
    const start = bounds[run];
    const end = bounds[run + 1];
    for (let i = start; i < end; i += 2) {
      leaves.push({ front: project.pages[i], back: project.pages[i + 1] ?? null });
    }
  }

  return { leaves, sectionLeafStart };
}

// A single cover PNG wraps around the book like a real dust jacket, laid
// out left-to-right as [back cover | spine | front cover], each cover
// panel as wide as the book is deep and the spine strip as wide as the
// book is thick. This slices that one image into the three faces.
function applyCoverWrap(book, imageUrl) {
  textureLoader.load(imageUrl, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;

    const totalWidth = bookDepth * 2 + bookWidth;
    const backFrac = bookDepth / totalWidth;
    const spineFrac = bookWidth / totalWidth;

    function slice(offsetFrac, widthFrac) {
      const sliced = tex.clone();
      sliced.needsUpdate = true;
      sliced.repeat.set(widthFrac, 1);
      sliced.offset.set(offsetFrac, 0);
      return sliced;
    }

    const [frontMaterial, backMaterial, , , spineMaterial] = book.material;
    frontMaterial.map = slice(backFrac + spineFrac, backFrac);
    frontMaterial.needsUpdate = true;
    backMaterial.map = slice(0, backFrac);
    backMaterial.needsUpdate = true;
    spineMaterial.map = slice(backFrac, spineFrac);
    spineMaterial.needsUpdate = true;
  });
}

// Unlit — page/cover/paper surfaces should read as true, consistent
// color, not get multiplied by the cabinet's warm lights (which is what
// was giving pages and spines a dark, shadowed, hard-to-read tint).
const pageEdgeMaterial = new THREE.MeshBasicMaterial({ color: 0xf3e9d2 });
const paperEdgeMaterial = new THREE.MeshBasicMaterial({ color: 0xf3e9d2 });

// Brushed steel, not polished brass — a neutral gunmetal gray with
// moderate roughness reads as understated hardware, while a warm, shiny
// metal would look more like a decorative trinket. Shared by every
// shelf's drawer handle.
const drawerHandleMaterial = new THREE.MeshStandardMaterial({
  color: 0x3b3d40,
  roughness: 0.45,
  metalness: 0.75,
});

const legHeight = 0.22;
const legInset = 0.09;
const legMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.65, metalness: 0.05 });

const drawerWidth = shelfWidth;
const drawerDepth = shelfDepth;
const trayInnerWidth = shelfWidth - 0.1;
const trayInnerDepth = drawerDepth - frameThickness;
const trayWallHeight = 0.07;
const paperWidth = 0.32;
const paperDepth = 0.42;
const paperThickness = 0.006;
const paperGap = 0.06;

const drawerClosedZ = 0;
const drawerPeekZ = 0.16;
const drawerOpenZ = drawerDepth * 0.65;

// -----------------------------------------------------------------------
// 5. BOOKSHELF FACTORY
// Builds one complete, independent cabinet — boards, panels, books,
// drawer, and legs — from a { name, projects, papers } shelf record.
// Every shelf in the carousel (section 6) is one call to this function,
// so they're all built identically. Books fill each row from the left
// ("flush left"), wrapping to the next row once `booksPerRow` is reached.
// -----------------------------------------------------------------------

const bookDropOffset = 0.16;

// Each book starts lifted a touch above its resting spot on the shelf and
// falls down with a soft bounce, staggered book-to-book so they knock
// into place in sequence instead of snapping all at once. Called once per
// shelf on load, and again on whichever shelf lands at the front any time
// the carousel finishes rotating (see navigateCarousel in section 6b), so
// re-settling always reads the same way.
function dropBooksIntoPlace(books, { stagger = 0.03, delay = 0.1 } = {}) {
  books.forEach((book, i) => {
    const restY = book.userData.restPosition.y;
    book.position.y = restY + bookDropOffset;
    gsap.to(book.position, {
      y: restY,
      duration: 0.5,
      delay: delay + i * stagger,
      ease: "bounce.out",
    });
  });
}

// A quick appearance pop on the shelf's own group — it grows in from
// slightly smaller than its real size up to full scale with a snappy
// overshoot, reading as the cabinet materializing into place rather
// than a squash landing on impact. Called on spawn, and again — see
// navigateCarousel in section 6b — while the carousel's rotation is
// still finishing (not after it fully stops), so the shelf is already
// popping into view as it arrives instead of standing still first.
function dropShelfIntoPlace(group, { duration = 0.35, delay = 0 } = {}) {
  gsap.fromTo(
    group.scale,
    { x: 0.8, y: 0.8, z: 0.8 },
    { x: 1, y: 1, z: 1, duration, delay, ease: "back.out(2.2)" }
  );
}

function buildBookshelf(shelfData) {
  const { projects, papers } = shelfData;
  const shelfGroup = new THREE.Group();

  // horizontal boards: one below each shelf row, plus one on top of the stack
  for (let i = 0; i <= numberOfRows; i++) {
    const board = new THREE.Mesh(roundedBox(outerWidth, frameThickness, shelfDepth), woodMaterial);
    board.position.y = shelfBaseY - frameThickness / 2 + i * (bookAreaHeight + frameThickness);
    board.castShadow = true;
    board.receiveShadow = true;
    shelfGroup.add(board);
  }

  // a closed base board beneath the drawer cavity, so pulling the drawer
  // out doesn't reveal an open underside
  const bottomCap = new THREE.Mesh(roundedBox(outerWidth, frameThickness, shelfDepth), woodMaterial);
  bottomCap.position.y = cabinetFloorY + frameThickness / 2;
  bottomCap.receiveShadow = true;
  shelfGroup.add(bottomCap);

  const leftPanel = new THREE.Mesh(roundedBox(frameThickness, cabinetHeight, shelfDepth), woodMaterial);
  leftPanel.position.set(-(shelfWidth / 2 + frameThickness / 2), cabinetCenterY, 0);
  leftPanel.castShadow = true;
  leftPanel.receiveShadow = true;
  shelfGroup.add(leftPanel);

  const rightPanel = leftPanel.clone();
  rightPanel.position.x = shelfWidth / 2 + frameThickness / 2;
  shelfGroup.add(rightPanel);

  const backPanel = new THREE.Mesh(roundedBox(outerWidth, cabinetHeight, frameThickness), backWoodMaterial);
  backPanel.position.set(0, cabinetCenterY, -shelfDepth / 2 - frameThickness / 2);
  backPanel.receiveShadow = true;
  shelfGroup.add(backPanel);

  // ---- books ----
  const shelfBooks = [];
  const leftEdgeX = -shelfWidth / 2 + bookWidth / 2 + 0.04;

  projects.forEach((project, i) => {
    const row = numberOfRows - 1 - Math.floor(i / booksPerRow); // fill the top row first
    const col = i % booksPerRow;

    const geometry = new RoundedBoxGeometry(bookWidth, bookHeight, bookDepth, 3, 0.006);
    // white when a cover image is coming — a material multiplies its map
    // by this color, so anything but white would tint the artwork (see
    // the identical note on the page-front material above)
    const coverFallbackColor = project.coverImage ? 0xffffff : project.color;
    // Unlit, like the open-book pages and drawer papers — a lit material
    // here would pick up the cabinet's directional lights as
    // shadow/highlight gradients across the cover art and spine title,
    // making them hard to read depending on viewing angle.
    const coverMaterialOptions = { color: coverFallbackColor };
    const frontCoverMaterial = new THREE.MeshBasicMaterial(coverMaterialOptions);
    const backCoverMaterial = new THREE.MeshBasicMaterial(coverMaterialOptions);
    // no cover art yet? fall back to an auto-labelled spine using the folder name
    const spineMaterial = project.coverImage
      ? new THREE.MeshBasicMaterial(coverMaterialOptions)
      : new THREE.MeshBasicMaterial({
          ...coverMaterialOptions,
          map: createSpineTexture(project.title, project.color),
        });

    // Face order for Box/RoundedBox geometry: [+x, -x, +y, -y, +z, -z]
    const materials = [
      frontCoverMaterial, // +x, front cover
      backCoverMaterial, // -x, back cover
      pageEdgeMaterial,
      pageEdgeMaterial,
      spineMaterial, // +z, facing the viewer
      backCoverMaterial,
    ];

    const book = new THREE.Mesh(geometry, materials);
    book.castShadow = true;
    book.receiveShadow = true;
    if (project.coverImage) {
      applyCoverWrap(book, project.coverImage);
    }

    const x = leftEdgeX + col * (bookWidth + gap);
    const y = shelfBaseY + bookHeight / 2 + row * (bookAreaHeight + frameThickness);
    const restPosition = new THREE.Vector3(x, y, 0);
    book.position.copy(restPosition);

    book.userData = {
      project,
      restPosition,
      state: "shelved", // 'shelved' -> 'out' -> (hidden while 'open' reading view is shown)
      // the group this book belongs to and always gets reattached to —
      // see openBook()/closeBook() in section 8, which reparent the book
      // onto the shared reading pivot and back while it's being read.
      // Without tracking this, a book read-and-closed while its shelf
      // wasn't at the carousel's front would come back attached directly
      // to the scene instead of its own shelf, and stop rotating with it.
      homeGroup: shelfGroup,
    };

    shelfGroup.add(book);
    shelfBooks.push(book);
  });

  // ---- drawer ----
  const drawerGroup = new THREE.Group();
  drawerGroup.position.set(0, drawerCenterY, 0); // closed: front flush with the cabinet
  shelfGroup.add(drawerGroup);

  const drawerFrontPanel = new THREE.Mesh(roundedBox(drawerWidth, drawerHeight, frameThickness), woodMaterial);
  drawerFrontPanel.position.z = drawerDepth / 2 - frameThickness / 2;
  drawerFrontPanel.castShadow = true;
  drawerFrontPanel.receiveShadow = true;
  drawerGroup.add(drawerFrontPanel);

  const drawerHandle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, drawerWidth * 0.22, 16),
    drawerHandleMaterial
  );
  drawerHandle.rotation.z = Math.PI / 2;
  drawerHandle.castShadow = true;
  drawerHandle.position.set(0, 0, drawerFrontPanel.position.z + frameThickness / 2 + 0.02);
  drawerGroup.add(drawerHandle);

  const trayFloor = new THREE.Mesh(new THREE.BoxGeometry(trayInnerWidth, 0.02, trayInnerDepth), backWoodMaterial);
  trayFloor.position.y = -drawerHeight / 2 + 0.01;
  drawerGroup.add(trayFloor);

  function addTrayWall(width, depth, x, z) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(width, trayWallHeight, depth), backWoodMaterial);
    wall.position.set(x, -drawerHeight / 2 + trayWallHeight / 2 + 0.02, z);
    drawerGroup.add(wall);
  }
  addTrayWall(trayInnerWidth, 0.03, 0, -trayInnerDepth / 2 + 0.015);
  addTrayWall(0.03, trayInnerDepth, -trayInnerWidth / 2 + 0.015, 0);
  addTrayWall(0.03, trayInnerDepth, trayInnerWidth / 2 - 0.015, 0);

  const papersPerRow = Math.max(1, Math.floor(trayInnerWidth / (paperWidth + paperGap)));
  const paperRowCount = Math.max(1, Math.ceil(papers.length / papersPerRow));
  const paperMeshes = [];

  papers.forEach((paper, i) => {
    const row = Math.floor(i / papersPerRow);
    const col = i % papersPerRow;
    const rowCount = Math.min(papersPerRow, papers.length - row * papersPerRow);
    const rowStartX = -((rowCount - 1) * (paperWidth + paperGap)) / 2;

    const topMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    textureLoader.load(paper.pages[0], (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      topMaterial.map = tex;
      topMaterial.needsUpdate = true;
    });

    // Box face order [+x,-x,+y,-y,+z,-z] — +y is the top, facing up out of the drawer
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(paperWidth, paperThickness, paperDepth), [
      paperEdgeMaterial,
      paperEdgeMaterial,
      topMaterial,
      paperEdgeMaterial,
      paperEdgeMaterial,
      paperEdgeMaterial,
    ]);
    mesh.position.set(
      rowStartX + col * (paperWidth + paperGap),
      -drawerHeight / 2 + 0.02 + paperThickness / 2,
      -((paperRowCount - 1) * (paperDepth + paperGap)) / 2 + row * (paperDepth + paperGap)
    );
    mesh.userData.paper = paper;
    drawerGroup.add(mesh);
    paperMeshes.push(mesh);
  });

  let drawerState = "closed"; // 'closed' -> 'peek' -> 'open'

  function slideDrawerTo(z, duration) {
    gsap.to(drawerGroup.position, { z, duration, ease: "power2.inOut" });
  }
  function peekDrawer() {
    if (drawerState !== "closed") return;
    drawerState = "peek";
    slideDrawerTo(drawerPeekZ, 0.35);
  }
  function unpeekDrawer() {
    if (drawerState !== "peek") return;
    drawerState = "closed";
    slideDrawerTo(drawerClosedZ, 0.35);
  }
  function openDrawer() {
    drawerState = "open";
    slideDrawerTo(drawerOpenZ, 0.6);
  }
  function closeDrawer() {
    drawerState = "closed";
    slideDrawerTo(drawerClosedZ, 0.6);
  }

  // ---- legs ----
  // Fixed to the cabinet, not the drawer group, so they stay put while
  // the drawer slides in front of them.
  [
    [-(drawerWidth / 2 - legInset), -(drawerDepth / 2 - legInset)],
    [drawerWidth / 2 - legInset, -(drawerDepth / 2 - legInset)],
    [-(drawerWidth / 2 - legInset), drawerDepth / 2 - legInset],
    [drawerWidth / 2 - legInset, drawerDepth / 2 - legInset],
  ].forEach(([x, z]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, legHeight, 16), legMaterial);
    leg.position.set(x, cabinetFloorY - legHeight / 2, z);
    leg.castShadow = true;
    leg.receiveShadow = true;
    shelfGroup.add(leg);
  });

  // ---- spawn-in ----
  // The cabinet lands with a quick squash and the books drop into place
  // right alongside it — both fire together the moment the shelf is in
  // position, rather than one after the other.
  dropShelfIntoPlace(shelfGroup);
  dropBooksIntoPlace(shelfBooks);

  return {
    name: shelfData.name,
    info: shelfData.info,
    group: shelfGroup,
    shelfBooks,
    drawerGroup,
    drawerFrontPanel,
    paperMeshes,
    getDrawerState: () => drawerState,
    peekDrawer,
    unpeekDrawer,
    openDrawer,
    closeDrawer,
  };
}

// -----------------------------------------------------------------------
// 5d. THE SHELF-INFO PANEL
// The #shelf-info header/body on the right of the screen (index.html) —
// sourced from each shelf's own info.txt (see buildInfoForShelf above)
// and swapped by the carousel setup below and by navigateCarousel()
// whenever a different shelf becomes the active one. Declared here,
// ahead of the carousel, since that setup calls it immediately.
// -----------------------------------------------------------------------

const shelfInfoPanel = document.getElementById("shelf-info");
const shelfInfoHeader = document.getElementById("shelf-info-header");
const shelfInfoBody = document.getElementById("shelf-info-body");
const shelfInfoSwapMs = 250; // must match the CSS transition on #shelf-info's header/body

function updateShelfInfoPanel({ animate = true } = {}) {
  const apply = () => {
    shelfInfoHeader.textContent = activeShelf.info.header;
    shelfInfoBody.textContent = activeShelf.info.body;
  };
  if (!animate) {
    apply();
    return;
  }
  shelfInfoPanel.classList.add("swapping");
  setTimeout(() => {
    apply();
    shelfInfoPanel.classList.remove("swapping");
  }, shelfInfoSwapMs);
}

// -----------------------------------------------------------------------
// 6. THE CAROUSEL
// Every bookshelf is rigidly attached to its own "slot," evenly spaced
// around a circle, and every slot is a child of one carouselGroup — like
// a lazy-Susan bookcase. Slot 0 sits at the carousel's own local +Z
// (angle 0); carouselGroup itself is offset backward by the radius, so
// with zero rotation, slot 0's shelf lands exactly at the world origin —
// the same spot the single shelf used to occupy — which keeps every
// camera-framing calculation in section 7 valid unchanged. Rotating
// carouselGroup swings a different slot into that same front spot.
// -----------------------------------------------------------------------

const carouselRadius = outerWidth * 0.95; // clearance so adjacent shelves don't clip as they swing past each other
const carouselGroup = new THREE.Group();
carouselGroup.position.set(0, 0, -carouselRadius);
scene.add(carouselGroup);

const stepAngle = (Math.PI * 2) / shelvesData.length;

const shelves = shelvesData.map((shelfData, i) => {
  const slot = new THREE.Group();
  slot.rotation.y = i * stepAngle;
  carouselGroup.add(slot);

  const shelf = buildBookshelf(shelfData);
  shelf.group.position.set(0, 0, carouselRadius);
  slot.add(shelf.group);

  return shelf;
});

// shelves is in numeric order (Bookshelf 1, 2, 3, ...), so the first
// one is whatever's shown by default when the page loads.
let currentShelfIndex = 0;
let activeShelf = shelves[currentShelfIndex];
let carouselRotationY = -currentShelfIndex * stepAngle;
carouselGroup.rotation.y = carouselRotationY;
updateShelfInfoPanel({ animate: false });

// -----------------------------------------------------------------------
// 6b. FLOOR ARROWS
// Two flat, rounded arrow icons resting on the floor in front of the
// shelf — click one to rotate the carousel by one slot, bringing the
// previous/next bookshelf to the front. See navigateCarousel() and the
// click/pointer-move handling in section 11 for how they're wired up.
// -----------------------------------------------------------------------

// A clean swept "swipe this way" arrow — a single tapered stroke curving
// from near the shelf out and down to a point, same flat dark ink color
// as the hero text and spine labels. Drawn once (curving down-left from
// the top right); the right-hand arrow just mirrors this canvas
// horizontally rather than needing its own separately-tuned curve.
function createRotateArrowTexture(mirror) {
  const w = 340;
  const h = 200;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  ctx.save();
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }

  ctx.strokeStyle = "#2a2c2f";
  ctx.lineWidth = 20;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const start = { x: 35, y: h - 25 };
  const control = { x: w * 0.68, y: h - 5 };
  const end = { x: w - 55, y: h - 115 };

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
  ctx.stroke();

  // arrowhead at the curve's end — a quadratic bezier's end tangent
  // points from its control point to its end point, so that gives the
  // arrowhead the correct direction of travel
  const angle = Math.atan2(end.y - control.y, end.x - control.x);
  const headLength = 34;
  const headSpread = 0.5;
  ctx.beginPath();
  ctx.moveTo(
    end.x - headLength * Math.cos(angle - headSpread),
    end.y - headLength * Math.sin(angle - headSpread)
  );
  ctx.lineTo(end.x, end.y);
  ctx.lineTo(
    end.x - headLength * Math.cos(angle + headSpread),
    end.y - headLength * Math.sin(angle + headSpread)
  );
  ctx.stroke();

  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const arrowWidth = 0.85;
const arrowHeight = 0.5;
// Spread wider than the shelf itself and out in front of it, flanking
// the cabinet the way they do in the reference layout, rather than
// tucked in tight against the legs.
const arrowGapFromCenter = outerWidth / 2 + 0.55;
const arrowZ = shelfDepth / 2 + 0.15;
const arrowY = shadowCatcher.position.y + 0.002; // just above the shadow catcher to avoid z-fighting

function createArrowMesh(direction) {
  const geometry = new THREE.PlaneGeometry(arrowWidth, arrowHeight);
  const material = new THREE.MeshBasicMaterial({
    map: createRotateArrowTexture(direction < 0),
    transparent: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(direction * arrowGapFromCenter, arrowY, arrowZ);
  mesh.userData.direction = direction;
  scene.add(mesh);
  return mesh;
}

const prevArrow = createArrowMesh(-1);
const nextArrow = createArrowMesh(1);
const carouselArrows = [prevArrow, nextArrow];

// In portrait (see style.css), these floor-mounted 3D arrows are small
// and easy to miss-tap, so #nav-prev/#nav-next — plain always-in-the-
// same-spot DOM buttons docked to the canvas's edges — take over as the
// actual carousel controls there, and these hide rather than compete
// with them. matchMedia (not just the resize listener in section 12)
// so a device that fires "orientationchange" without a matching resize
// still gets caught.
const portraitQuery = window.matchMedia("(orientation: portrait)");
function updateArrowVisibility() {
  const portrait = portraitQuery.matches;
  carouselArrows.forEach((arrow) => {
    arrow.visible = !portrait;
  });
}
updateArrowVisibility();
portraitQuery.addEventListener("change", updateArrowVisibility);

document.getElementById("nav-prev").addEventListener("click", () => navigateCarousel(-1));
document.getElementById("nav-next").addEventListener("click", () => navigateCarousel(1));

// Pushes back any book pulled partway out and closes the drawer on a
// shelf that's about to swing away from the front, so it always cycles
// back around in a clean, closed state rather than however it was left.
function resetShelfInteractionState(shelf) {
  if (shelf.getDrawerState() !== "closed") shelf.closeDrawer();
  shelf.shelfBooks.forEach((book) => {
    if (book.userData.state === "out") pushBack(book);
  });
}

// Guards against a second arrow click landing mid-swing: overlapping
// navigateCarousel() calls would fight over the same carouselGroup
// rotation tween (and over which shelf's visibility gets turned back
// off), leaving the carousel visibly stuck at a wrong in-between angle.
let isCarouselRotating = false;

function navigateCarousel(direction) {
  // the arrows sit on the floor near the overview camera position; while
  // reading, the camera's up close to an open book and they're not a
  // meaningful thing to click, so ignore stray hits during that state
  if (readingState || paperReadingState || isCarouselRotating) return;
  isCarouselRotating = true;

  const outgoing = activeShelf;
  resetShelfInteractionState(outgoing);
  if (hoveredBook && outgoing.shelfBooks.includes(hoveredBook)) {
    hoveredBook = null;
    updatePreviewPanel();
  }

  currentShelfIndex = (currentShelfIndex + direction + shelves.length) % shelves.length;
  activeShelf = shelves[currentShelfIndex];
  carouselRotationY -= direction * stepAngle;
  updateShelfInfoPanel();

  // The incoming shelf's appearance pop fires partway through the
  // rotation's tail end rather than waiting for it to come to a full
  // stop first — it's already popping into place as it arrives, not
  // standing still and then playing.
  let hasAppeared = false;
  gsap.to(carouselGroup.rotation, {
    y: carouselRotationY,
    duration: 0.45,
    ease: "power3.out",
    onUpdate: function () {
      if (!hasAppeared && this.progress() > 0.6) {
        hasAppeared = true;
        dropShelfIntoPlace(activeShelf.group);
        dropBooksIntoPlace(activeShelf.shelfBooks);
      }
    },
    onComplete: () => {
      isCarouselRotating = false;
    },
  });
}

// -----------------------------------------------------------------------
// 7. THE OPEN-BOOK READING VIEW
// A separate 3D object, built fresh each time a book is opened. Pages
// are individually hinged at the spine (x = 0 of this group) so they
// can rotate open, one at a time, just like real pages. Shared by every
// shelf — only one book can be read at a time regardless of which
// bookshelf it came from.
// -----------------------------------------------------------------------

const pageWidth = 1.045; // 0.95 + 10%
const pageHeight = 1.485; // 1.35 + 10%
const pageThickness = 0.0018; // paper-thin — a 50-page pile should stay slim, not read as a block

// Frame the whole cabinet-plus-drawer in view regardless of how the
// shelf/book dimensions get tuned — fit both its height and width
// within the camera's FOV (at the window's current aspect) and back off
// however far the tighter of the two dimensions demands. Computed once
// from the shared cabinet geometry (section 3), so it's valid for
// whichever shelf the carousel brings to the front.
//
// The floor arrows (section 6b) sit lower than the legs AND closer to
// the camera than the shelf's own face, so perspective drops them
// further down the screen than their Y position alone would suggest —
// padding sceneBottomY past arrowY keeps them from clipping the bottom
// of the frame. They also flank the shelf wider than the cabinet itself,
// so the horizontal fit below uses their spread, not just outerWidth.
const sceneBottomY = Math.min(cabinetFloorY - legHeight, arrowY) - 0.4;
const sceneCenterY = (cabinetTopEdgeY + sceneBottomY) / 2;
const sceneHeight = cabinetTopEdgeY - sceneBottomY;

// keyLight is a directional light, so a point at height h casts its
// shadow offset horizontally by h * (light.x / light.y) from directly
// below it — the cabinet's own top edge casts the furthest-reaching
// shadow, well past outerWidth or the arrows. Without this, a narrow
// (portrait-column) camera fit the solid geometry tightly enough that
// this shadow got clipped by the edge of the frame, reading as a
// visible box drawn around the shelf. Padding by twice the offset
// covers either horizontal direction, since which side actually needs
// it depends on which way the carousel currently has the shelf turned.
const shadowOffsetX = Math.abs(cabinetTopEdgeY * (keyLight.position.x / keyLight.position.y));
const sceneWidth = Math.max(outerWidth, (arrowGapFromCenter + arrowWidth / 2) * 2) + shadowOffsetX * 2;

// An open two-page spread's rough footprint, for fitting the reading
// camera the same way the overview camera fits the cabinet below —
// pageWidth * 2 for the left+right pages either side of the spine, plus
// clearance for the section tabs (built later, in the OPEN-BOOK section)
// that stick out past the right page's edge. In portrait (see section
// 7c, SINGLE-PAGE BOOK READING), only one page shows at a time instead,
// so the reading camera fits just pageWidth there.
const spreadBookWidth = pageWidth * 2 + 0.3;
const singlePageWidth = pageWidth;
const openBookHeight = pageHeight;

const framingMargin = 1.2; // a little breathing room around the edges

// How far back the camera needs to sit to fit a `width` x `height` object
// at the camera's CURRENT aspect — the same fit-both-dimensions approach
// for both the overview (the cabinet) and the reading view (an open
// spread), so neither one just holds a distance tuned for whatever aspect
// the page happened to load at. Depends on camera.aspect, so it has to be
// re-run (see updateCameraFraming below) whenever that changes.
function fitDistance(width, height, margin) {
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  return (
    Math.max(height / 2 / Math.tan(verticalFov / 2), width / 2 / Math.tan(horizontalFov / 2)) * margin
  );
}

const readingPosition = new THREE.Vector3(0, shelfCenterY, shelfDepth / 2 + 1.4);
const overviewCameraPos = new THREE.Vector3(0, sceneCenterY, 0);
const overviewTarget = new THREE.Vector3(0, sceneCenterY, 0);
const readingCameraPos = new THREE.Vector3(readingPosition.x, readingPosition.y, 0);
const readingTarget = readingPosition.clone();

// Recomputes the two camera distances above for whatever camera.aspect
// currently is. Called once here, and again on every resize/orientation
// change (section 12) — #app isn't always the full viewport (portrait
// layout, see style.css), so this has to stay reactive, not one-time.
function updateCameraFraming() {
  overviewCameraPos.z = fitDistance(sceneWidth, sceneHeight, framingMargin);
  const readingWidth = portraitQuery.matches ? singlePageWidth : spreadBookWidth;
  readingCameraPos.z = readingPosition.z + fitDistance(readingWidth, openBookHeight, 1.15);
}
updateCameraFraming();

camera.position.copy(overviewCameraPos);
controls.target.copy(overviewTarget);

// While reading (a book spread/single page, or a paper), a one-finger
// drag has to stay free for swipe-to-flip — see the activePointers
// guard in section 11b — so rotate stays off the same as before. But
// zooming in to actually read fine print is genuinely useful, so zoom
// (scroll wheel, or a two-finger pinch) stays live instead of the whole
// of `controls` just being switched off. minDistance is pulled in much
// closer than the overview ever needs; maxDistance is capped relative
// to THIS open's own reading distance (not a flat number) since that
// distance itself depends on aspect and single-page-vs-spread mode —
// see updateCameraFraming above — so scrolling out only ever backs off
// a little from wherever the page currently sits, never drifting into
// the rest of the scene.
function enterReadingControls() {
  controls.enabled = true;
  controls.enableRotate = false;
  controls.enableZoom = true;
  controls.minDistance = 0.4;
  controls.maxDistance = readingCameraPos.z - readingTarget.z + 1.5;
}

function exitReadingControls() {
  controls.enabled = true;
  controls.enableRotate = true;
  controls.minDistance = 1.5;
  controls.maxDistance = 12;
}

const openBookGroup = new THREE.Group();
openBookGroup.position.copy(readingPosition);
openBookGroup.visible = false;
scene.add(openBookGroup);

let readingState = null; // { project, pageHinges: [], currentIndex }

// Built once per project and kept around (meshes, materials, and their
// in-flight texture loads) instead of being torn down and rebuilt on
// every open. Rebuilding from scratch — and re-kicking-off every page
// image's load — right as the opening swing starts is what was making
// the transition into a book feel laggy, especially on a book you'd
// already opened before in the same visit.
const openBookCache = new Map(); // project -> { pageHinges, zStep, leftCoverZ, tabs, leftCover }

// Kicks off building (and loading the textures for) a project's open-book
// pages without showing them yet. Call this as early as possible — e.g.
// as soon as a book is pulled partway out — so that by the time the
// reader actually clicks to open it, the pages are already built and
// their images are already loading/loaded, and the swing animation isn't
// competing with a burst of fresh image decodes.
function ensureOpenBookBuilt(project) {
  const cached = openBookCache.get(project);
  if (cached) return cached;

  const { leaves, sectionLeafStart } = buildLeaves(project);

  const zStep = pageThickness + 0.0006;
  // kept comfortably behind every page slot below so the cover never
  // renders in front of a page that's been flipped onto the left pile
  const leftCoverZ = -(leaves.length + 3) * zStep;

  // the permanent left-hand page — doesn't flip, shows title + description
  const leftCoverGeometry = new THREE.BoxGeometry(pageWidth, pageHeight, pageThickness);
  const leftCoverMaterial = new THREE.MeshBasicMaterial({
    map: createTitlePageTexture(project),
  });
  const leftCover = new THREE.Mesh(leftCoverGeometry, [
    pageEdgeMaterial,
    pageEdgeMaterial,
    pageEdgeMaterial,
    pageEdgeMaterial,
    leftCoverMaterial,
    pageEdgeMaterial,
  ]);
  leftCover.position.set(-pageWidth / 2 - 0.01, 0, leftCoverZ);

  // each leaf is a small hinge Group pivoting at x = 0 (the spine). The
  // leaf mesh itself sits offset to the right of that pivot, so rotating
  // the hinge -180° swings it over to the left. `originalZ` is where it
  // sits while unflipped (on the right); once flipped, flipNext()
  // reassigns z so the most recently flipped leaf stacks on top of the
  // left pile instead of under it.
  // Each leaf is two segments per side — an inner half hinged at the
  // spine and an outer half hinged again at the leaf's own midline — so
  // the flip can bend through a soft crease along the way instead of
  // swinging over as one rigid flat rectangle (see animateFlip below for
  // the actual bend). Leaves are double-sided: the front (recto) shows
  // while unflipped, and flipping it over reveals the back (verso)
  // instead of a blank sheet.
  const segmentWidth = pageWidth / 2;

  const pageHinges = leaves.map((leaf, index) => {
    const hinge = new THREE.Group();
    const originalZ = -index * zStep; // stack back-to-front on the right
    hinge.position.z = originalZ;
    hinge.userData.originalZ = originalZ;

    // unlit + white, not tinted — a lit material multiplied by the
    // cabinet's warm lights would push every page toward yellow
    const innerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const outerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const innerBackMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const outerBackMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    applyLeafContent(innerMaterial, outerMaterial, innerBackMaterial, outerBackMaterial, leaf);

    const innerMesh = new THREE.Mesh(new THREE.BoxGeometry(segmentWidth, pageHeight, pageThickness), [
      pageEdgeMaterial,
      pageEdgeMaterial,
      pageEdgeMaterial,
      pageEdgeMaterial,
      innerMaterial, // +z — front content, visible while unflipped
      innerBackMaterial, // -z — back content, visible once flipped over
    ]);
    innerMesh.position.x = segmentWidth / 2 + 0.01;
    hinge.add(innerMesh);

    const creaseHinge = new THREE.Group();
    creaseHinge.position.x = segmentWidth + 0.01;
    hinge.add(creaseHinge);

    const outerMesh = new THREE.Mesh(new THREE.BoxGeometry(segmentWidth, pageHeight, pageThickness), [
      pageEdgeMaterial,
      pageEdgeMaterial,
      pageEdgeMaterial,
      pageEdgeMaterial,
      outerMaterial,
      outerBackMaterial,
    ]);
    outerMesh.position.x = segmentWidth / 2;
    creaseHinge.add(outerMesh);

    hinge.userData.creaseHinge = creaseHinge;
    return hinge;
  });

  const tabs = buildTabs(project, pageHinges, sectionLeafStart);

  const built = { pageHinges, zStep, leftCoverZ, tabs, leftCover };
  openBookCache.set(project, built);
  return built;
}

// Puts a project's (built-or-cached) pages into openBookGroup, reset to
// their closed/unflipped state, ready for the opening swing to reveal.
function buildOpenBook(project) {
  while (openBookGroup.children.length) {
    openBookGroup.remove(openBookGroup.children[0]);
  }

  const built = ensureOpenBookBuilt(project);

  built.pageHinges.forEach((hinge, index) => {
    hinge.rotation.set(0, 0, 0);
    hinge.position.set(0, 0, -index * built.zStep);
    hinge.userData.creaseHinge.rotation.y = 0;
    openBookGroup.add(hinge);
  });
  openBookGroup.add(built.leftCover);

  return built;
}

// One sticky tab per section (src/main.js:2b), lined up down the
// fore-edge like real bookmark tabs. Each tab is a CHILD of the hinge for
// the page it jumps to, so it physically travels with that page: it
// pokes out past the fore-edge while its page sits in the unflipped
// right-hand stack, and disappears onto the left-hand pile along with
// the page once you've flipped past it — a real tab glued to a page,
// not a floating button overlaid on the whole book.
// Long and thin, like the little adhesive index flags students stick
// into a textbook to mark a spot — not a squarish block.
const tabWidth = 0.24;
const tabHeight = 0.05;
// Thin — kept well under zStep (the z-gap between adjacent leaves, ~0.0024)
// so a tab attached to one leaf never physically reaches into a
// neighbouring leaf's slot. At the old 0.02 it was ~8 leaves thick, which
// let it poke through nearby pages and even through other sections' tabs.
const tabThickness = 0.0016;
const tabGapY = 0.014;

function createTabTexture(label, hexColor) {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 80; // matches the tab's own width:height ratio, so the label isn't stretched
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = `#${hexColor.toString(16).padStart(6, "0")}`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 34px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildTabs(project, pageHinges, sectionLeafStart) {
  const startY = pageHeight / 2 - tabHeight / 2 - 0.1;

  const tabs = project.sections.map((section, i) => {
    const hostHinge = pageHinges[sectionLeafStart[i]];
    if (!hostHinge) return null;

    const color = palette[i % palette.length];
    const geometry = new THREE.BoxGeometry(tabWidth, tabHeight, tabThickness);

    // The printed face (+z) is what faces the camera while the tab's page
    // sits unflipped on the right. A plain, unlabelled backing (-z) is
    // what faces the camera once that page has been flipped to the left
    // pile — a real tab's back has nothing printed on it either, so once
    // you've read past a section its tab goes blank instead of still
    // showing the label (mirrored) from behind.
    // Unlit, same reasoning as the cover/page materials — a tab is read
    // at a glance while flipping, so its label can't be allowed to dim
    // into shadow depending on the light angle.
    const labelMaterial = new THREE.MeshBasicMaterial({
      map: createTabTexture(section.label, color),
    });
    const blankMaterial = new THREE.MeshBasicMaterial({ color });
    const sideMaterial = new THREE.MeshStandardMaterial({ color });

    const mesh = new THREE.Mesh(geometry, [
      sideMaterial,
      sideMaterial,
      sideMaterial,
      sideMaterial,
      labelMaterial, // +z
      blankMaterial, // -z
    ]);
    // position is relative to the host hinge's own origin, which is the
    // spine (x = 0). Sits just PAST the page's fore-edge (no overlap) so
    // the page never covers any of the tab's label — it reads as glued
    // to the page's edge rather than tucked partway under it.
    mesh.position.set(pageWidth + tabWidth / 2 + 0.02, startY - i * (tabHeight + tabGapY), 0);
    mesh.userData.startIndex = sectionLeafStart[i];
    // hover targets — the two faces that can actually be facing the
    // camera; glowing both means it lights up correctly whichever side
    // is currently showing
    mesh.userData.hoverMaterials = [labelMaterial, blankMaterial];
    hostHinge.add(mesh);
    return mesh;
  });

  return tabs.filter(Boolean);
}

function updateReadingUI() {
  const total = readingState.pageHinges.length;
  readingCounter.textContent = `${Math.min(readingState.currentIndex + 1, total)} / ${total}`;
  readingPrev.disabled = readingState.currentIndex === 0;
  readingNext.disabled = readingState.currentIndex >= total;
}

// Turns one page's hinge to `targetY` (0 = flat/unflipped, -PI = flipped
// over to the left) with a soft paper-like curl instead of a rigid swing:
// the outer half bends forward at the crease and the whole page lifts
// slightly through the middle of the turn, then both settle flat again
// at either end — closer to how Issuu (or a real page) turns than a
// perfectly stiff rotation.
function animateFlip(hinge, targetY, duration) {
  const creaseHinge = hinge.userData.creaseHinge;
  gsap.to(hinge.rotation, {
    y: targetY,
    duration,
    ease: "power2.inOut",
    onUpdate: function () {
      const bend = Math.sin(this.progress() * Math.PI);
      creaseHinge.rotation.y = bend * 0.4;
      hinge.position.y = bend * 0.025;
    },
    onComplete: () => {
      creaseHinge.rotation.y = 0;
      hinge.position.y = 0;
    },
  });
}

// Flips every page between the current position and `targetIndex` at
// once, like grabbing a bookmarked chunk of a real book and turning
// it as a single wad rather than leafing through one page at a time.
// A plain Prev/Next click is just the one-page case of this same jump.
function jumpToIndex(targetIndex) {
  if (!readingState) return;
  const { pageHinges, currentIndex, zStep, leftCoverZ } = readingState;
  const clamped = Math.max(0, Math.min(targetIndex, pageHinges.length));
  if (clamped === currentIndex) return;

  if (clamped > currentIndex) {
    for (let i = currentIndex; i < clamped; i++) {
      const hinge = pageHinges[i];
      // move it just in front of the left cover, and in front of any
      // page already flipped there, so the chunk lands stacked in order
      hinge.position.z = leftCoverZ + (i + 1) * zStep;
      animateFlip(hinge, -Math.PI, 0.7);
    }
  } else {
    for (let i = currentIndex - 1; i >= clamped; i--) {
      const hinge = pageHinges[i];
      animateFlip(hinge, 0, 0.7);
      // restore its original spot in the right-hand stack
      hinge.position.z = hinge.userData.originalZ;
    }
  }

  readingState.currentIndex = clamped;
  updateReadingUI();
}

function flipNext() {
  if (!readingState) return;
  jumpToIndex(readingState.currentIndex + 1);
}

function flipPrev() {
  if (!readingState) return;
  jumpToIndex(readingState.currentIndex - 1);
}

// -----------------------------------------------------------------------
// 7b. THE PAPER READING VIEW
// A single flat sheet shown large in front of the camera, reusing the
// same reading position/camera framing as an open book. No page-flip
// animation — papers are short references, so Prev/Next just swaps the
// texture on one plane, resized to that page's own aspect ratio.
// -----------------------------------------------------------------------

const paperViewGroup = new THREE.Group();
paperViewGroup.position.copy(readingPosition);
paperViewGroup.visible = false;
scene.add(paperViewGroup);

const paperViewMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
let paperViewMesh = null;
let paperReadingState = null; // { paper, currentIndex }

function setPaperViewTexture(imageUrl) {
  textureLoader.load(imageUrl, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    paperViewMaterial.map = tex;
    paperViewMaterial.needsUpdate = true;

    // resize the plane to the image's real aspect ratio so it never stretches
    const aspect = tex.image.width / tex.image.height;
    const maxWidth = 1.3;
    const maxHeight = 1.7;
    let w = maxWidth;
    let h = w / aspect;
    if (h > maxHeight) {
      h = maxHeight;
      w = h * aspect;
    }
    paperViewMesh.geometry.dispose();
    paperViewMesh.geometry = new THREE.PlaneGeometry(w, h);
  });
}

function updatePaperUI() {
  const total = paperReadingState.paper.pages.length;
  paperTitle.textContent = paperReadingState.paper.title;
  paperCounter.textContent = `${paperReadingState.currentIndex + 1} / ${total}`;
  paperPrev.disabled = paperReadingState.currentIndex === 0;
  paperNext.disabled = paperReadingState.currentIndex >= total - 1;
}

function openPaperView(paper) {
  paperReadingState = { paper, currentIndex: 0 };

  if (!paperViewMesh) {
    paperViewMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.7), paperViewMaterial);
    paperViewGroup.add(paperViewMesh);
  }
  setPaperViewTexture(paper.pages[0]);
  updatePaperUI();
  paperPanel.classList.add("visible");
  paperViewGroup.visible = true;

  // In portrait (see style.css), body.reading-active expands #app from
  // its usual left column to the full width — the open view needs the
  // room to be legible. refitCameraFraming() picks that new box up
  // before both the tween below (captures readingCameraPos as its end
  // value) and enterReadingControls (bases maxDistance on it).
  document.body.classList.add("reading-active");
  refitCameraFraming();
  enterReadingControls();

  gsap.to(camera.position, { ...readingCameraPos, duration: 0.8, ease: "power2.inOut" });
  gsap.to(controls.target, { ...readingTarget, duration: 0.8, ease: "power2.inOut" });
}

function closePaperView() {
  paperPanel.classList.remove("visible");
  paperViewGroup.visible = false;
  paperReadingState = null;
  exitReadingControls();

  document.body.classList.remove("reading-active");
  refitCameraFraming();

  gsap.to(camera.position, { ...overviewCameraPos, duration: 0.8, ease: "power2.inOut" });
  gsap.to(controls.target, { ...overviewTarget, duration: 0.8, ease: "power2.inOut" });
}

function paperFlip(delta) {
  if (!paperReadingState) return;
  const next = paperReadingState.currentIndex + delta;
  if (next < 0 || next >= paperReadingState.paper.pages.length) return;
  paperReadingState.currentIndex = next;
  setPaperViewTexture(paperReadingState.paper.pages[next]);
  updatePaperUI();
}

// -----------------------------------------------------------------------
// 7c. SINGLE-PAGE BOOK READING (portrait only)
// The desktop spread below shows two facing pages at once, each one
// squeezed to illegibility on a narrow portrait screen — this is the
// same "one flat sheet, texture swapped on Prev/Next" approach the
// paper view above already uses, for a book's own pages[] instead of a
// paper's. openBook() decides which of the two this section or the
// spread section below actually gets used, based on the screen's
// current orientation at the moment a book is opened.
// -----------------------------------------------------------------------

const singlePageGroup = new THREE.Group();
singlePageGroup.position.copy(readingPosition);
singlePageGroup.visible = false;
scene.add(singlePageGroup);

const singlePageMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
let singlePageMesh = null;

// Mirrors applyPageSide's placeholder handling (section 4) — a page
// slot with no real image yet gets the same "drop PNGs here" texture
// instead of a broken/blank plane.
function setSinglePageTexture(page) {
  function applyTexture(tex) {
    singlePageMaterial.map = tex;
    singlePageMaterial.needsUpdate = true;
    // resize the plane to the image's real aspect ratio, capped to the
    // book's own page dimensions, so it never stretches or overflows them
    const aspect = tex.image.width / tex.image.height;
    let w = pageWidth;
    let h = w / aspect;
    if (h > pageHeight) {
      h = pageHeight;
      w = h * aspect;
    }
    singlePageMesh.geometry.dispose();
    singlePageMesh.geometry = new THREE.PlaneGeometry(w, h);
  }

  if (page.image) {
    textureLoader.load(
      page.image,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        applyTexture(tex);
      },
      undefined,
      () => applyTexture(createPagePlaceholderTexture(page.label || "?", page.color || "#e7dcc9"))
    );
  } else {
    applyTexture(createPagePlaceholderTexture(page.label || "", page.color || "#e7dcc9"));
  }
}

function updateSinglePageUI() {
  const total = readingState.project.pages.length;
  readingCounter.textContent = `${readingState.currentIndex + 1} / ${total}`;
  readingPrev.disabled = readingState.currentIndex === 0;
  readingNext.disabled = readingState.currentIndex >= total - 1;
}

function singlePageJumpTo(targetIndex) {
  const total = readingState.project.pages.length;
  const clamped = Math.max(0, Math.min(targetIndex, total - 1));
  if (clamped === readingState.currentIndex) return;
  readingState.currentIndex = clamped;
  setSinglePageTexture(readingState.project.pages[clamped]);
  updateSinglePageUI();
}

function singlePageNext() {
  if (!readingState) return;
  singlePageJumpTo(readingState.currentIndex + 1);
}

function singlePagePrev() {
  if (!readingState) return;
  singlePageJumpTo(readingState.currentIndex - 1);
}

// -----------------------------------------------------------------------
// 8. OPENING / CLOSING A BOOK
// -----------------------------------------------------------------------

let activeShelfBook = null;

// A reusable pivot for the opening/closing swing — positioned at the
// book's own spine edge (not its centre) each time a book opens, so the
// book visibly swings open on its binding like a real cover instead of
// spinning in place like a flipped coin.
const bookOpenPivot = new THREE.Group();
scene.add(bookOpenPivot);

function openBook(book) {
  activeShelfBook = book;
  const project = book.userData.project;
  // Decided once, at the moment the book opens — see section 7c for why
  // portrait gets a single page at a time instead of this two-page
  // spread: reading one page at a time is the point, so mid-read
  // orientation changes deliberately don't retroactively switch modes.
  const single = portraitQuery.matches;

  if (single) {
    readingState = { mode: "single", project, currentIndex: 0 };
    if (!singlePageMesh) {
      singlePageMesh = new THREE.Mesh(new THREE.PlaneGeometry(pageWidth, pageHeight), singlePageMaterial);
      singlePageGroup.add(singlePageMesh);
    }
    setSinglePageTexture(project.pages[0]);
    updateSinglePageUI();
  } else {
    const { pageHinges, zStep, leftCoverZ, tabs } = buildOpenBook(project);
    readingState = { mode: "spread", project, pageHinges, currentIndex: 0, zStep, leftCoverZ, tabs };
    updateReadingUI();
  }

  readingTitle.textContent = project.title;
  readingPanel.classList.add("visible");
  updatePreviewPanel(); // readingState is set above, so this hides the preview panel

  // Swing the book open on its own spine instead of spinning it in place:
  // put a pivot at the book's spine-side edge, reparent the book onto it
  // (attach() preserves its current world transform, so nothing jumps —
  // this book is always still shelved on the currently-active, carousel-
  // front shelf at this point, so its local position already equals its
  // world position), then animate the pivot itself toward the reading
  // position while it rotates — the book arcs open on its binding as it
  // travels, the way a real cover swings rather than sliding over then
  // spinning on the spot. Whichever view (spread or single-page) reveals
  // itself the same way, partway through this same swing.
  const hingeWorldPos = book.position.clone();
  hingeWorldPos.x += bookWidth / 2;
  bookOpenPivot.position.copy(hingeWorldPos);
  bookOpenPivot.rotation.set(0, 0, 0);
  bookOpenPivot.attach(book);

  const revealGroup = single ? singlePageGroup : openBookGroup;
  revealGroup.visible = false;
  gsap.to(bookOpenPivot.position, { ...readingPosition, duration: 0.55, ease: "power2.inOut" });
  gsap.to(bookOpenPivot.rotation, {
    y: Math.PI,
    duration: 0.55,
    ease: "power2.inOut",
    onUpdate: function () {
      if (!revealGroup.visible && this.progress() > 0.5) {
        revealGroup.visible = true;
      }
    },
    onComplete: () => {
      book.visible = false;
      // hand the book back to ITS OWN shelf group (not the scene
      // directly) so it keeps rotating along with that shelf if the
      // carousel turns later, and so closeBook()/pushBack() below can
      // animate its position/rotation in the right local space
      book.userData.homeGroup.attach(book);
    },
  });

  // See the matching comment in openPaperView — expands #app to full
  // width in portrait so the open view has room to be legible, and
  // refits readingCameraPos to that box before both the tween below
  // (captures it as its end value) and enterReadingControls (bases
  // maxDistance on it).
  document.body.classList.add("reading-active");
  refitCameraFraming();
  enterReadingControls();

  gsap.to(camera.position, { ...readingCameraPos, duration: 0.55, ease: "power2.inOut" });
  gsap.to(controls.target, { ...readingTarget, duration: 0.55, ease: "power2.inOut" });
}

function closeBook() {
  readingPanel.classList.remove("visible");
  exitReadingControls();
  setHoveredTab(null); // reset any tab left mid-glow/scaled from hovering

  // mirror the opening transition: the pages linger a moment while the
  // real book reappears (still turned away) and rotates back closed
  const revealGroup = readingState?.mode === "single" ? singlePageGroup : openBookGroup;
  gsap.delayedCall(0.15, () => {
    revealGroup.visible = false;
  });

  document.body.classList.remove("reading-active");
  refitCameraFraming();

  gsap.to(camera.position, { ...overviewCameraPos, duration: 0.8, ease: "power2.inOut" });
  gsap.to(controls.target, { ...overviewTarget, duration: 0.8, ease: "power2.inOut" });

  if (activeShelfBook) {
    // guard against closing mid-swing, while the book is still parented
    // under the opening pivot — hand it back to its own shelf group
    // first so the plain position/rotation tween below lands on the
    // right (shelf-local) values
    const homeGroup = activeShelfBook.userData.homeGroup;
    if (activeShelfBook.parent !== homeGroup) homeGroup.attach(activeShelfBook);
    pushBack(activeShelfBook);
    activeShelfBook = null;
  }
  readingState = null;
}

// -----------------------------------------------------------------------
// 9. SHELF PULL-OUT / PUSH-BACK
// -----------------------------------------------------------------------

function pullOut(book) {
  book.userData.state = "out";
  // start building this book's pages (and loading their images) the
  // moment it's pulled out, well before the reader clicks to actually
  // open it — so the swing-open animation isn't competing with a burst
  // of fresh page loads and feels immediate instead of laggy
  ensureOpenBookBuilt(book.userData.project);
  gsap.to(book.position, {
    x: book.userData.restPosition.x,
    y: book.userData.restPosition.y,
    z: book.userData.restPosition.z + 1.3,
    duration: 0.6,
    ease: "power3.out",
  });
}

function pushBack(book) {
  book.visible = true;
  book.userData.state = "shelved";
  gsap.to(book.position, {
    x: book.userData.restPosition.x,
    y: book.userData.restPosition.y,
    z: book.userData.restPosition.z,
    duration: 0.6,
    ease: "power2.inOut",
  });
  gsap.to(book.rotation, { y: 0, duration: 0.9, ease: "power2.inOut" });
}

// -----------------------------------------------------------------------
// 10. HTML CONTROLS (title bar + prev/next/close — reliable fallback
// alongside clicking the pages directly)
// -----------------------------------------------------------------------

const readingPanel = document.getElementById("reading-panel");
const readingTitle = document.getElementById("reading-title");
const readingCounter = document.getElementById("reading-counter");
const readingPrev = document.getElementById("reading-prev");
const readingNext = document.getElementById("reading-next");
const readingClose = document.getElementById("reading-close");

readingPrev.addEventListener("click", () => (readingState?.mode === "single" ? singlePagePrev() : flipPrev()));
readingNext.addEventListener("click", () => (readingState?.mode === "single" ? singlePageNext() : flipNext()));
readingClose.addEventListener("click", closeBook);

const paperPanel = document.getElementById("paper-panel");
const paperTitle = document.getElementById("paper-title");
const paperCounter = document.getElementById("paper-counter");
const paperPrev = document.getElementById("paper-prev");
const paperNext = document.getElementById("paper-next");
const paperClose = document.getElementById("paper-close");

paperPrev.addEventListener("click", () => paperFlip(-1));
paperNext.addEventListener("click", () => paperFlip(1));
paperClose.addEventListener("click", closePaperView);

// -----------------------------------------------------------------------
// 10b. THE PREVIEW PANEL
// A book's title IS its folder name under its shelf's pages/ (see
// section 2). This panel is read-only — it just shows which book is
// currently pulled partway out, while it's not yet open.
// -----------------------------------------------------------------------

const previewPanel = document.getElementById("preview-panel");
const previewTitle = document.getElementById("preview-title");

function updatePreviewPanel() {
  if (hoveredBook && !readingState) {
    previewTitle.textContent = hoveredBook.userData.project.title;
    previewPanel.classList.add("visible");
  } else {
    previewPanel.classList.remove("visible");
  }
}

// -----------------------------------------------------------------------
// 11. CLICK DETECTION
// Overview mode: click a floor arrow to rotate the carousel; click a
// shelved book (on whichever shelf is currently at the front) to pull it
// out, click it again to open it; click the drawer front to slide it
// open, then click a paper inside to read it. Clicking anywhere that
// isn't the thing you're currently interacting with backs out of it
// (closes the book, the paper, or the drawer) — a click always means
// either "do this" or "get me out of this," never a no-op.
// -----------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function setPointerFromEvent(event) {
  // Normalized against the canvas's own box, not window.innerWidth/Height
  // — #app isn't always the full viewport (portrait layout, see
  // style.css), so raycasts computed against the window would land
  // wrong wherever #app is offset or narrower than it, e.g. every arrow
  // and book click missing on the portrait layout.
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function onClick(event) {
  if (
    readingPanel.contains(event.target) ||
    paperPanel.contains(event.target) ||
    previewPanel.contains(event.target)
  )
    return;

  // a swipe drag (see the pointerdown/move/up handlers below) already
  // flipped the page or the paper on release — don't also treat the
  // click that follows it as a second, separate flip
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  setPointerFromEvent(event);

  if (readingState && readingState.mode === "single") {
    const hits = raycaster.intersectObject(singlePageMesh);
    if (hits.length === 0) {
      // clicked past the page entirely — treat it like closing the book
      closeBook();
      return;
    }
    // did the ray land left or right of the page's own centerline?
    const localPoint = singlePageGroup.worldToLocal(hits[0].point.clone());
    if (localPoint.x >= 0) singlePageNext();
    else singlePagePrev();
    return;
  }

  if (readingState) {
    if (readingState.tabs.length > 0) {
      const tabHits = raycaster.intersectObjects(readingState.tabs);
      if (tabHits.length > 0) {
        jumpToIndex(tabHits[0].object.userData.startIndex);
        return;
      }
    }

    const hits = raycaster.intersectObject(openBookGroup, true);
    if (hits.length === 0) {
      // clicked past the book entirely — treat it like closing the book
      closeBook();
      return;
    }
    // did the ray land left of the spine, or right of it?
    const localPoint = openBookGroup.worldToLocal(hits[0].point.clone());
    if (localPoint.x >= 0) flipNext();
    else flipPrev();
    return;
  }

  if (paperReadingState) {
    const hits = raycaster.intersectObject(paperViewMesh);
    if (hits.length === 0) closePaperView();
    return;
  }

  const arrowHits = raycaster.intersectObjects(carouselArrows);
  if (arrowHits.length > 0) {
    navigateCarousel(arrowHits[0].object.userData.direction);
    return;
  }

  if (activeShelf.getDrawerState() === "open") {
    const paperHits = raycaster.intersectObjects(activeShelf.paperMeshes);
    if (paperHits.length > 0) {
      openPaperView(paperHits[0].object.userData.paper);
      return;
    }
  }

  const drawerHits = raycaster.intersectObject(activeShelf.drawerFrontPanel);
  if (drawerHits.length > 0) {
    if (activeShelf.getDrawerState() === "open") activeShelf.closeDrawer();
    else activeShelf.openDrawer();
    return;
  }

  const hits = raycaster.intersectObjects(activeShelf.shelfBooks);
  if (hits.length > 0) {
    const book = hits[0].object;
    if (book.userData.state === "shelved") {
      pullOut(book);
    } else if (book.userData.state === "out") {
      openBook(book);
    }
    return;
  }

  // clicked on truly empty space — if the drawer was open, that counts
  // as "click outside" and closes it
  if (activeShelf.getDrawerState() === "open") activeShelf.closeDrawer();
}

renderer.domElement.addEventListener("click", onClick);

// -----------------------------------------------------------------------
// 11b. SWIPE-TO-FLIP
// While a book or paper is open, OrbitControls' rotate is disabled (see
// enterReadingControls) so a one-finger drag on the page is free to mean
// "turn the page" instead of "orbit the camera" — dragging left/right
// past a small threshold flips forward/back, same as a real swipe on a
// phone book-reader app. A plain click (no real movement) still falls
// through to onClick()'s left/right-of-spine tap-to-flip.
//
// Zoom stays live during reading (see enterReadingControls), which on
// touch means a two-finger pinch — activePointers is what keeps THAT
// from also being read as a swipe: a second finger joining cancels the
// in-progress drag rather than letting its eventual pointerup measure a
// (usually large, accidental) dx from whichever finger happened to
// land second.
// -----------------------------------------------------------------------

let dragStart = null;
let suppressNextClick = false;
const swipeThreshold = 40;
const activePointers = new Set();

function onPointerDown(event) {
  activePointers.add(event.pointerId);
  if (!readingState && !paperReadingState) return;
  if (activePointers.size > 1) {
    dragStart = null;
    return;
  }
  dragStart = { x: event.clientX, y: event.clientY };
}

function onPointerUp(event) {
  activePointers.delete(event.pointerId);
  if (!dragStart) return;
  const dx = event.clientX - dragStart.x;
  const dy = event.clientY - dragStart.y;
  dragStart = null;

  if (Math.abs(dx) >= swipeThreshold && Math.abs(dx) > Math.abs(dy)) {
    if (readingState?.mode === "single") {
      if (dx < 0) singlePageNext();
      else singlePagePrev();
    } else if (readingState) {
      if (dx < 0) flipNext();
      else flipPrev();
    } else if (paperReadingState) {
      if (dx < 0) paperFlip(1);
      else paperFlip(-1);
    }
    suppressNextClick = true;
  }
}

renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("pointerup", onPointerUp);
renderer.domElement.addEventListener("pointercancel", (event) => activePointers.delete(event.pointerId));

// -----------------------------------------------------------------------
// 11c. TAB HOVER + ARROW HOVER
// A little light-up-and-grow feedback so a section tab or a carousel
// arrow reads as clickable, same idea as a hover state on any UI button.
// -----------------------------------------------------------------------

let hoveredTab = null;

// The label/blank materials are unlit MeshBasicMaterial (see buildTabs),
// so the hover "glow" brightens their own .color toward white instead of
// an emissive property those materials no longer have.
function hoverTab(tab) {
  gsap.to(tab.scale, { x: 1.15, y: 1.15, duration: 0.18, ease: "power2.out" });
  tab.userData.hoverMaterials.forEach((material) => {
    gsap.to(material.color, { r: 1.4, g: 1.4, b: 1.4, duration: 0.18 });
  });
}

function unhoverTab(tab) {
  gsap.to(tab.scale, { x: 1, y: 1, duration: 0.18, ease: "power2.out" });
  tab.userData.hoverMaterials.forEach((material) => {
    gsap.to(material.color, { r: 1, g: 1, b: 1, duration: 0.18 });
  });
}

function setHoveredTab(tab) {
  if (tab === hoveredTab) return;
  if (hoveredTab) unhoverTab(hoveredTab);
  hoveredTab = tab;
  if (hoveredTab) hoverTab(hoveredTab);
}

let hoveredArrow = null;

function setHoveredArrow(arrow) {
  if (arrow === hoveredArrow) return;
  if (hoveredArrow) gsap.to(hoveredArrow.scale, { x: 1, y: 1, z: 1, duration: 0.15, ease: "power2.out" });
  hoveredArrow = arrow;
  if (hoveredArrow) gsap.to(hoveredArrow.scale, { x: 1.15, y: 1.15, z: 1.15, duration: 0.15, ease: "power2.out" });
}

// Hovering does the "pull a book partway out to see it" gesture; hovering
// off it (or a fresh pointer move landing on nothing) settles it back —
// clicking a book that's already pulled out is what opens it. The drawer
// front gets the same hover-peek treatment, independently of whichever
// book is currently hovered. All of this only ever targets the shelf
// that's currently at the front of the carousel.
let hoveredBook = null;

function onPointerMove(event) {
  // the swipe-to-flip drag (pointerdown/up above) is what handles pointer
  // movement while reading — orbiting/hover-peek stay off until you close.
  // Tab hover still works, since it's not fighting the drag for meaning.
  if (readingState || paperReadingState) {
    if (readingState && readingState.mode === "spread" && readingState.tabs.length > 0 && !dragStart) {
      setPointerFromEvent(event);
      const tabHits = raycaster.intersectObjects(readingState.tabs);
      setHoveredTab(tabHits.length > 0 ? tabHits[0].object : null);
    } else {
      setHoveredTab(null);
    }
    return;
  }
  setPointerFromEvent(event);

  const arrowHits = raycaster.intersectObjects(carouselArrows);
  setHoveredArrow(arrowHits.length > 0 ? arrowHits[0].object : null);

  if (activeShelf.getDrawerState() !== "open") {
    const drawerHits = raycaster.intersectObject(activeShelf.drawerFrontPanel);
    if (drawerHits.length > 0) activeShelf.peekDrawer();
    else activeShelf.unpeekDrawer();
  }

  const hits = raycaster.intersectObjects(activeShelf.shelfBooks);
  const hovered = hits.length > 0 ? hits[0].object : null;

  if (hovered !== hoveredBook) {
    if (hoveredBook && hoveredBook.userData.state === "out") {
      pushBack(hoveredBook);
    }
    hoveredBook = hovered;
    if (hoveredBook && hoveredBook.userData.state === "shelved") {
      pullOut(hoveredBook);
    }
    updatePreviewPanel();
  }
}

renderer.domElement.addEventListener("pointermove", onPointerMove);

// -----------------------------------------------------------------------
// 12. RESIZE HANDLING + RENDER LOOP
// -----------------------------------------------------------------------

// Re-fits the renderer/camera/framing distances to #app's current box.
// Deliberately doesn't touch camera.position/controls.target itself —
// section 8/8b's openBook/closePaperView etc. call this right after
// toggling body.reading-active (whose CSS resizes #app instantly, with
// nothing else to tell three.js that happened) and then run their own
// gsap tween toward the now-correct readingCameraPos, exactly as they
// already did before portrait layout existed. Calling this first just
// makes sure that tween is animating toward the right distance instead
// of whatever #app's previous box implied.
function refitCameraFraming() {
  const { width, height } = getViewportSize();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  updateCameraFraming();
}

// The plain resize/orientation-change case: no tween is already running
// toward either framing, so this snaps straight to whichever applies.
function handleViewportResize() {
  refitCameraFraming();
  updateArrowVisibility();
  if (readingState || paperReadingState) {
    camera.position.copy(readingCameraPos);
    controls.target.copy(readingTarget);
  } else {
    camera.position.copy(overviewCameraPos);
    controls.target.copy(overviewTarget);
  }
}

window.addEventListener("resize", handleViewportResize);

// Rubber-bands the camera's horizontal orbit back toward azimuthSoftLimit
// once it's exceeded, instead of OrbitControls' hard instant clamp — see
// the azimuthSoftLimit/azimuthSpring comment near the controls setup.
// Spherical.setFromVector3 uses the same theta convention OrbitControls
// itself clamps on, so this reads as the identical "how far around" angle.
const orbitOffset = new THREE.Vector3();
const orbitSpherical = new THREE.Spherical();
function clampOrbitAzimuth() {
  orbitOffset.copy(camera.position).sub(controls.target);
  orbitSpherical.setFromVector3(orbitOffset);
  const clamped = THREE.MathUtils.clamp(orbitSpherical.theta, -azimuthSoftLimit, azimuthSoftLimit);
  const over = orbitSpherical.theta - clamped;
  if (over === 0) return;
  orbitSpherical.theta -= over * azimuthSpring;
  camera.position.copy(controls.target).add(orbitOffset.setFromSpherical(orbitSpherical));
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  clampOrbitAzimuth();
  renderer.render(scene, camera);
}

animate();
