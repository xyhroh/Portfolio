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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // adaptive: see section 1a
renderer.shadowMap.enabled = true;
// The shadow map is re-rendered manually (see the animate loop): the cabinet is
// static most of the time, and while a book is open the whole thing is hidden
// behind the dimming sheet anyway, so redrawing it every frame was pure cost.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById("app").appendChild(renderer.domElement);
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute("role", "application");
renderer.domElement.setAttribute(
  "aria-label",
  "Interactive 3D bookshelf. Left and right arrow keys switch shelf, up and down choose a book, Enter opens it, Escape goes back."
);
renderer.domElement.style.cursor = "grab";

// -----------------------------------------------------------------------
// 1a. MOTION SYSTEM + RENDER-ON-DEMAND
// One place for every duration/easing so the whole piece moves with a
// single, consistent rhythm (it used to mix 0.45/0.55/0.6/0.7/0.8 s with
// four different easings). T() collapses every duration to ~0 for anyone
// whose OS asks for reduced motion.
//
// The scene is only re-drawn when something actually changed (a tween is
// running, the camera is moving, a texture just arrived, the window
// resized). A still bookshelf costs ~0% GPU instead of re-rendering 60
// times a second, which is what keeps laptops cool and phones from
// throttling. Anything that changes the picture outside GSAP calls
// invalidate().
// -----------------------------------------------------------------------

const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const motion = {
  hover: 0.18,
  fade: 0.35,
  pull: 0.55,
  open: 0.9,
  close: 0.65,
  flip: 0.62,
  carousel: 0.5,
  inOut: "power3.inOut",
  out: "power3.out",
  flipEase: "power2.inOut",
  settle: "back.out(1.25)",
};
function T(seconds) {
  return reduceMotionQuery.matches ? 0.001 : seconds;
}

// GPU texture uploads are queued and done ONE PER FRAME. Uploading several
// page textures in the same frame (what happens when a book is hovered) is a
// visible hitch; spread out they're invisible.
const uploadQueue = [];
function queueUpload(texture, rec, token) {
  uploadQueue.push({ texture, rec, token });
}
function processUploadQueue() {
  while (uploadQueue.length) {
    const { texture, rec, token } = uploadQueue.shift();
    if (rec.token !== token) continue; // unloaded in the meantime
    renderer.initTexture(texture);
    invalidate();
    return;
  }
}

let framesToRender = 3;
function invalidate(frames = 2) {
  if (frames > framesToRender) framesToRender = frames;
}
document.addEventListener("visibilitychange", () => invalidate(3));

// Adaptive resolution: if the device can't hold ~40 fps while the scene is
// animating, quietly drop the render resolution a step instead of stuttering.
let pixelRatio = Math.min(window.devicePixelRatio, 1.5);
const minPixelRatio = 0.85;
let frameTimeAvg = 16;
let slowStreak = 0;
function applyPixelRatio() {
  renderer.setPixelRatio(pixelRatio);
  const { width, height } = getViewportSize();
  renderer.setSize(width, height);
  invalidate(3);
}

const maxAnisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());

// Marks the shadow map as needing a redraw for the next little while — called
// whenever something that casts a shadow starts moving.
let shadowDirtyUntil = 0;
function dirtyShadows(ms = 1200) {
  shadowDirtyUntil = Math.max(shadowDirtyUntil, performance.now() + ms);
  invalidate();
}

// phone book buttons (see syncBookList): declared up here because the shelf-info
// panel is first filled in long before the rest of the page's code has run
const bookListEl = document.getElementById("book-list");
const coarsePointer = window.matchMedia("(pointer: coarse)");
let bookListShelf = null;
let bookListReady = false; // set once the whole module has run

// Short status messages for screen readers (see #sr-status in library.html)
const srStatus = document.getElementById("sr-status");
function announce(message) {
  if (srStatus) srStatus.textContent = message;
}

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
// Typed out and rubbed out by hand rather than cross-faded. The numbers are
// what a person at a keyboard actually does: backspacing is roughly twice as
// quick as typing, there is a beat of hesitation on an empty line before the
// next word starts, and every keystroke is jittered so it never falls into a
// machine's rhythm.
const introTypeMs = 85; // a keystroke
const introDeleteMs = 42; // a backspace
const introHoldFullMs = 2800; // how long a finished word is left to be read
const introHoldEmptyMs = 450; // the pause on an empty line

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
  // library.html already shows roles[0] so the hero paints without waiting for
  // this fetch; only correct it if roles.txt has since been reordered.
  if (introRoleEl.textContent.trim() !== roles[0]) introRoleEl.textContent = roles[0];
  if (roles.length <= 1) return;

  // Someone who has asked for less motion should not be made to watch a
  // cursor pecking away: swap the words outright instead.
  if (reduceMotionQuery.matches) {
    setInterval(() => {
      index = (index + 1) % roles.length;
      introRoleEl.textContent = roles[index];
    }, introHoldFullMs);
    return;
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const humanly = (ms) => wait(ms * (0.72 + Math.random() * 0.62));
  introRoleEl.classList.add("typed"); // turns the caret on

  for (;;) {
    const current = roles[index];
    await wait(introHoldFullMs);

    introRoleEl.classList.add("editing"); // a caret stops blinking while it works
    for (let i = current.length - 1; i >= 0; i--) {
      introRoleEl.textContent = current.slice(0, i);
      await humanly(introDeleteMs);
    }
    await wait(introHoldEmptyMs);

    index = (index + 1) % roles.length;
    const next = roles[index];
    for (let i = 1; i <= next.length; i++) {
      introRoleEl.textContent = next.slice(0, i);
      await humanly(introTypeMs);
    }
    introRoleEl.classList.remove("editing");
  }
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

// Which folder a book sits in decides which shelf row it lands on:
//   <Shelf>/Row 1/<Book>/   the top row
//   <Shelf>/Row 2/<Book>/   the row below it
// `pages/` is the original layout and still works, treated as Row 1, so
// nothing breaks for a shelf whose books have not been moved yet.
const rowContainers = { pages: 1, "Row 1": 1, "Row 2": 2 };

const pageImageModules = import.meta.glob(
  [
    "/src/shelves/*/pages/*/pages/**/*.{png,jpg,jpeg,webp}",
    "/src/shelves/*/Row 1/*/pages/**/*.{png,jpg,jpeg,webp}",
    "/src/shelves/*/Row 2/*/pages/**/*.{png,jpg,jpeg,webp}",
  ],
  { eager: true }
);
const coverImageModules = import.meta.glob(
  [
    "/src/shelves/*/pages/*/cover/*.{png,jpg,jpeg,webp}",
    "/src/shelves/*/Row 1/*/cover/*.{png,jpg,jpeg,webp}",
    "/src/shelves/*/Row 2/*/cover/*.{png,jpg,jpeg,webp}",
  ],
  { eager: true }
);
const paperImageModules = import.meta.glob("/src/shelves/*/papers/*/*.{png,jpg,jpeg,webp}", {
  eager: true,
});
// The left-hand page of an open book. Drop one image into a book's title/
// folder and it is used instead of the plain title-and-blurb page the code
// draws. First image wins if there is more than one.
const titleImageModules = import.meta.glob(
  [
    "/src/shelves/*/pages/*/title/*.{png,jpg,jpeg,webp}",
    "/src/shelves/*/Row 1/*/title/*.{png,jpg,jpeg,webp}",
    "/src/shelves/*/Row 2/*/title/*.{png,jpg,jpeg,webp}",
  ],
  { eager: true }
);
// Sound files. Drop an mp3 into src/assets/sounds/ named after the moment
// it belongs to and it replaces the built-in synthesised sound for that
// moment. Anything missing keeps its synthesised sound, so the folder can
// hold one file, all six, or none at all:
//   page-turn   a single page turning
//   riffle      a multi-page jump (falls back to page-turn, then synth)
//   page-land   the page settling onto the pile
//   hover       a book sliding out of the shelf
//   open        the book opening
//   close       the cover shutting
// wav, ogg and m4a work too; the extension is ignored, only the name counts.
const soundModules = import.meta.glob("/src/assets/sounds/*.{mp3,wav,ogg,m4a}", {
  eager: true,
  query: "?url",
  import: "default",
});

// The carousel arrows on the floor either side of the cabinet, and the two
// round arrow buttons that take over from them in portrait. Drop a png into
// src/assets/arrows/ to replace the drawn arrow: "arrow.png" is used on both
// sides (mirrored on the left), or name them "arrow-left.png" and
// "arrow-right.png" to give each side its own image. Transparent background,
// pointing right, roughly 2:1 landscape suits the floor arrows best.
const arrowImageModules = import.meta.glob("/src/assets/arrows/*.{png,jpg,jpeg,webp,svg}", {
  eager: true,
  query: "?url",
  import: "default",
});

// Both folders above are keyed by file NAME, not by position, so a book's
// cover-style "first image wins" rule doesn't apply: an unrecognised name is
// simply ignored rather than silently used for the wrong thing.
function assetByStem(modules, names) {
  for (const name of names) {
    for (const [path, url] of Object.entries(modules)) {
      const stem = path.split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
      if (stem === name) return url;
    }
  }
  return null;
}

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
  const m = path.match(/^\/src\/shelves\/([^/]+)\/([^/]+)\/([^/]+)\//);
  if (!m) return null;
  const row = rowContainers[m[2]];
  if (!row) return null; // papers/ and anything else is not a book
  return { shelf: m[1], container: m[2], folder: m[3], row };
}

function parseShelfPaperPath(path) {
  const m = path.match(/^\/src\/shelves\/([^/]+)\/papers\/([^/]+)\//);
  return m ? { shelf: m[1], folder: m[2] } : null;
}

const projectFoldersByShelf = new Map(); // shelfName -> Map(projectFolder -> { container, row })
const paperFoldersByShelf = new Map(); // shelfName -> Set(paperFolder)

[...Object.keys(pageImageModules), ...Object.keys(coverImageModules), ...Object.keys(titleImageModules)].forEach(
  (path) => {
    const parsed = parseShelfProjectPath(path);
    if (!parsed) return;
    if (!projectFoldersByShelf.has(parsed.shelf)) projectFoldersByShelf.set(parsed.shelf, new Map());
    // a book named the same on both rows keeps whichever row it was found in
    projectFoldersByShelf.get(parsed.shelf).set(parsed.folder, { container: parsed.container, row: parsed.row });
  }
);

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
function pagesAndSectionsForFolder(shelfName, container, folder) {
  const prefix = `/src/shelves/${shelfName}/${container}/${folder}/pages/`;
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

function coverForFolder(shelfName, container, folder) {
  const prefix = `/src/shelves/${shelfName}/${container}/${folder}/cover/`;
  const [, mod] =
    Object.entries(coverImageModules)
      .filter(([path]) => path.startsWith(prefix))
      .sort(([a], [b]) => naturalCompare(a, b))[0] ?? [];
  return mod ? mod.default : null;
}

function titleForFolder(shelfName, container, folder) {
  const prefix = `/src/shelves/${shelfName}/${container}/${folder}/title/`;
  const [, mod] =
    Object.entries(titleImageModules)
      .filter(([path]) => path.startsWith(prefix))
      .sort(([a], [b]) => naturalCompare(a, b))[0] ?? [];
  return mod ? mod.default : null;
}

function buildProjectsForShelf(shelfName) {
  // top row first, then the row below it, alphabetical within each — which is
  // also the order the chips and the up/down keys walk through
  const entries = Array.from(projectFoldersByShelf.get(shelfName) ?? new Map()).sort(
    ([aFolder, a], [bFolder, b]) => a.row - b.row || aFolder.localeCompare(bFolder)
  );
  const projects = entries.map(([folder, where], i) => ({
    title: folder,
    slug: slugify(folder),
    folder,
    container: where.container,
    row: where.row,
    color: palette[i % palette.length],
    description: "A short blurb about this project and the problem it explores.",
  }));
  projects.forEach((project) => {
    const { pages, sections } = pagesAndSectionsForFolder(shelfName, project.container, project.folder);
    project.pages = pages;
    project.sections = sections;
    project.coverImage = coverForFolder(shelfName, project.container, project.folder);
    project.titleImage = titleForFolder(shelfName, project.container, project.folder);
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
// How many rows the carcass needs: at least 2 (a top and a bottom), plus more
// only if a row has been given more books than fit across it and they wrap.
function rowsNeededFor(projects) {
  const filled = new Map();
  let deepest = 0;
  projects.forEach((project) => {
    const row = project.row ?? 1;
    const n = (filled.get(row) ?? 0) + 1;
    filled.set(row, n);
    deepest = Math.max(deepest, row - 1 + Math.floor((n - 1) / booksPerRow));
  });
  return deepest + 1;
}
const numberOfRows = Math.max(2, ...shelvesData.map((s) => rowsNeededFor(s.projects)));
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

// The strongest colour on a book's front cover, so the surfaces inside the
// book can be finished to match it the way a real hardcover's boards are.
// Sampled from the cover artwork where there is one; books without artwork
// fall back to the palette colour their spine is already drawn in.
function dominantCoverColour(image, offsetFrac, widthFrac) {
  try {
    const w = 48;
    const h = 64;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, image.width * offsetFrac, 0, image.width * widthFrac, image.height, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    // bucket near-identical shades together so one flat colour wins outright
    // instead of being split across a hundred almost-equal neighbours
    const counts = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let bestKey = -1;
    let best = 0;
    for (const [key, n] of counts) {
      if (n > best) {
        best = n;
        bestKey = key;
      }
    }
    if (bestKey < 0) return null;
    const r = ((bestKey >> 8) & 15) * 17;
    const g = ((bestKey >> 4) & 15) * 17;
    const bl = (bestKey & 15) * 17;
    return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
  } catch {
    return null; // an image the canvas will not give pixels back for
  }
}

function innerCoverColour(project) {
  return project.coverColour || project.color;
}

// The material for a book's left-hand page. With no image in the book's
// title/ folder it stays a flat panel in the book's own cover colour, like the
// inside board of a hardcover. Drop an image in that folder and it takes over
// as soon as it has loaded. The blank pixel is there from the start so that
// swap never changes the shader (see blankPixel).
function titlePageMaterial(project) {
  const material = new THREE.MeshBasicMaterial({
    color: innerCoverColour(project),
    map: blankPixel,
    toneMapped: false,
  });
  if (project.titleImage) {
    loadImageTexture(
      project.titleImage,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = maxAnisotropy;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        // Centre-crop to the page's proportions rather than stretching, the
        // same thing the scanned pages do, so any image at all can be dropped
        // in without it coming out squashed.
        const image = texture.image;
        const pageAspect = pageWidth / pageHeight;
        const imageAspect = image && image.height ? image.width / image.height : pageAspect;
        if (imageAspect > pageAspect) {
          const scale = pageAspect / imageAspect;
          texture.repeat.set(scale, 1);
          texture.offset.set((1 - scale) / 2, 0);
        } else if (imageAspect < pageAspect) {
          const scale = imageAspect / pageAspect;
          texture.repeat.set(1, scale);
          texture.offset.set(0, (1 - scale) / 2);
        }
        material.map = texture;
        material.color.set(0xffffff);
        material.needsUpdate = true;
        invalidate(2);
      },
      () => {
        /* unreadable image: the drawn title page stays */
      }
    );
  }
  return material;
}


const textureLoader = new THREE.TextureLoader();

// Page images are decoded OFF the main thread (ImageBitmap) and pushed to the
// GPU the moment they arrive (renderer.initTexture) — i.e. while the book is
// merely hovered — so nothing heavy is left to happen mid-swing when the book
// opens. Falls back to the plain TextureLoader where ImageBitmap isn't available.
const bitmapLoader = typeof createImageBitmap === "function" ? new THREE.ImageBitmapLoader() : null;
if (bitmapLoader) bitmapLoader.setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none" });

function loadImageTexture(url, onLoad, onError) {
  if (!bitmapLoader) {
    textureLoader.load(url, onLoad, undefined, onError);
    return;
  }
  bitmapLoader.load(
    url,
    (bitmap) => {
      const tex = new THREE.Texture(bitmap);
      tex.flipY = false; // the bitmap is already flipped
      tex.needsUpdate = true;
      onLoad(tex);
    },
    undefined,
    onError
  );
}

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
// Frees the GPU copy AND the decoded bitmap held in memory (dispose() alone
// leaves the bitmap around until the garbage collector gets to it, which is
// what made things stutter after reading a long book).
function disposeTexture(texture) {
  texture.dispose();
  const image = texture.image;
  if (image && typeof image.close === "function") image.close();
}

const paperTint = 0xe8e8e6; // what a page looks like before its picture has arrived
// Pages are unlit and not tone-mapped (so print colours stay true), tinted a
// whisper off pure white so the sheet reads as paper against the white site.
const pageWhite = new THREE.Color(0xf8f8f6);

// Every page material is born holding this 1x1 white pixel. A MeshBasicMaterial
// multiplies its colour by its map, so a white pixel looks like no map at all —
// but it means that when the real page image arrives later, three.js only swaps
// one texture for another instead of switching the material from "no map" to
// "has a map". That switch changes the shader's defines, which forced a brand
// new program to be COMPILED mid page-turn: a measurable stall several pages
// into a book. Starting with a map keeps the program fixed for the whole read.
const blankPixel = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
blankPixel.colorSpace = THREE.SRGBColorSpace;
blankPixel.needsUpdate = true;

// Pictures fade up out of the paper tint instead of popping in
function revealMaterial(material) {
  gsap.killTweensOf(material.color);
  if (reduceMotionQuery.matches) {
    material.color.copy(pageWhite);
    return;
  }
  material.color.set(0xdedede);
  gsap.to(material.color, { r: pageWhite.r, g: pageWhite.g, b: pageWhite.b, duration: motion.fade, ease: "power1.out" });
}

// `rec` is the leaf's bookkeeping record (see ensureOpenBookBuilt): every
// texture created for the leaf is tracked on it so unloadLeaf() can free the
// GPU memory later, and `rec.token` lets a late-arriving image notice that
// its leaf was already unloaded and throw itself away.
function applyPageSide(innerMaterial, outerMaterial, page, reversed, rec) {
  const token = rec.token;

  function useTexture(tex) {
    if (rec.token !== token) {
      disposeTexture(tex);
      return;
    }
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

    tex.anisotropy = maxAnisotropy; // clones inherit it: sharp text at a slant
    const leftHalf = tex.clone();
    leftHalf.needsUpdate = true;
    leftHalf.repeat.set(repeatX * 0.5, repeatY);
    leftHalf.offset.set(offsetX, offsetY);
    const rightHalf = tex.clone();
    rightHalf.needsUpdate = true;
    rightHalf.repeat.set(repeatX * 0.5, repeatY);
    rightHalf.offset.set(offsetX + repeatX * 0.5, offsetY);
    rec.textures.push(tex, leftHalf, rightHalf);
    queueUpload(leftHalf, rec, token); // upload soon, one per frame, not during the opening swing
    innerMaterial.map = reversed ? rightHalf : leftHalf;
    innerMaterial.needsUpdate = true;
    outerMaterial.map = reversed ? leftHalf : rightHalf;
    outerMaterial.needsUpdate = true;
    revealMaterial(innerMaterial);
    revealMaterial(outerMaterial);
    invalidate();
  }

  if (!page) {
    // no image for this side (an odd page count leaves one leaf's back
    // empty) — leave it a plain blank sheet instead of loading anything
    innerMaterial.map = blankPixel;
    outerMaterial.map = blankPixel;
    innerMaterial.color.copy(pageWhite);
    outerMaterial.color.copy(pageWhite);
    innerMaterial.needsUpdate = true;
    outerMaterial.needsUpdate = true;
    invalidate();
    return;
  }

  if (page.image) {
    loadImageTexture(
      page.image,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        useTexture(tex);
      },
      () => useTexture(createPagePlaceholderTexture(page.label || "?", page.color || "#e7dcc9"))
    );
  } else {
    useTexture(createPagePlaceholderTexture(page.label || "", page.color || "#e7dcc9"));
  }
}

// Applies both faces of one physical leaf: `front` (recto, visible while
// unflipped) and `back` (verso, revealed once the leaf turns over) — see
// buildLeaves() for how consecutive page images get paired into a leaf.
function applyLeafContent(innerMaterial, outerMaterial, innerBackMaterial, outerBackMaterial, leaf, rec) {
  applyPageSide(innerMaterial, outerMaterial, leaf.front, false, rec);
  applyPageSide(innerBackMaterial, outerBackMaterial, leaf.back, true, rec);
}

// --- lazy page loading -------------------------------------------------
// A 50-page book used to decode and upload all 50 full-size images to the
// GPU the moment you hovered it (~1 GB of texture memory). Now a leaf only
// holds its pictures while it is within LEAF_WINDOW leaves of the page being
// read; everything further away is released and re-fetched (from the browser
// cache) if you flip back to it.
const LEAF_WINDOW = 2;

function setLeafShown(hinge, shown) {
  hinge.userData.pageMeshes.forEach((m) => (m.visible = shown));
}

function loadLeaf(rec, withBack = true) {
  const [inner, outer, innerBack, outerBack] = rec.mats;
  if (!rec.frontLoaded) {
    rec.frontLoaded = true;
    applyPageSide(inner, outer, rec.leaf.front, false, rec);
  }
  if (withBack && !rec.backLoaded) {
    rec.backLoaded = true;
    applyPageSide(innerBack, outerBack, rec.leaf.back, true, rec);
  }
}

function unloadLeaf(rec) {
  if (!rec.frontLoaded && !rec.backLoaded) return;
  rec.frontLoaded = false;
  rec.backLoaded = false;
  rec.token++;
  rec.textures.forEach(disposeTexture);
  rec.textures.length = 0;
  rec.mats.forEach((m) => {
    gsap.killTweensOf(m.color);
    m.map = blankPixel; // never back to null: see blankPixel
    m.color.set(paperTint);
    m.needsUpdate = true;
  });
}

// Loads the leaves around `center` (the number of leaves already turned),
// then — after any flip in progress has landed — frees the ones outside it.
function updateLeafWindow(built, center, peek = false) {
  built.windowCenter = center;
  if (peek) {
    // just hovering a book: all that's needed is the first visible page
    if (built.pageHinges[0]) loadLeaf(built.pageHinges[0].userData.rec, false);
    return;
  }
  const lo = center - 1 - LEAF_WINDOW;
  const hi = center + LEAF_WINDOW;
  // only the pages around the one being read are drawn at all — the rest are
  // hidden behind them anyway, and a 50-page book was ~300 draw calls per frame
  built.pageHinges.forEach((hinge, i) => {
    if (i >= lo && i <= hi) setLeafShown(hinge, true);
  });
  // nearest pages first, so the ones on screen arrive first
  built.pageHinges
    .map((hinge, i) => ({ hinge, i }))
    .filter(({ i }) => i >= lo && i <= hi)
    .sort((a, b) => Math.abs(a.i - center) - Math.abs(b.i - center))
    .forEach(({ hinge }) => loadLeaf(hinge.userData.rec));
  gsap.delayedCall(1, () => {
    const c = built.windowCenter;
    built.pageHinges.forEach((hinge, i) => {
      const keep = c !== null && i >= c - 1 - LEAF_WINDOW && i <= c + LEAF_WINDOW;
      if (!keep) {
        unloadLeaf(hinge.userData.rec);
        setLeafShown(hinge, false);
      }
    });
  });
}

// Frees every page texture of a book that is no longer being read or peeked at.
function releaseBookTextures(project) {
  [openBookCache, openBookCacheSingle].forEach((cache) => {
    const built = cache.get(project);
    if (!built) return;
    built.windowCenter = null;
    gsap.delayedCall(1, () => {
      if (built.windowCenter !== null) return;
      built.pageHinges.forEach((hinge) => unloadLeaf(hinge.userData.rec));
    });
  });
}

// Pairs up a project's flat page-image list into double-sided leaves —
// each leaf shows one image on its front and the next on its back, like
// real printed pages, instead of a blank reverse side. Pairing restarts
// at the start of the untabbed front matter and at every section, so a
// tab always lands on the FRONT of a leaf rather than being buried on
// the back of the page before it.
function buildLeaves(project, single = false) {
  if (single) {
    // phone: one page at a time, so every page is its own leaf (nothing hidden on a back side)
    return { leaves: project.pages.map((page) => ({ front: page, back: null })), sectionLeafStart: [] };
  }
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
let coversPending = 0;
function coverSettled() {
  coversPending--;
  invalidate(3);
  if (coversPending <= 0) markLibraryReady();
}

function applyCoverWrap(book, imageUrl) {
  coversPending++;
  textureLoader.load(imageUrl, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAnisotropy;
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

    const project = book.userData.project;
    const sampled = dominantCoverColour(tex.image, backFrac + spineFrac, backFrac);
    if (sampled) project.coverColour = sampled;

    const [frontMaterial, backMaterial, , , spineMaterial] = book.material;
    frontMaterial.map = slice(backFrac + spineFrac, backFrac);
    frontMaterial.needsUpdate = true;
    backMaterial.map = slice(0, backFrac);
    backMaterial.needsUpdate = true;
    spineMaterial.map = slice(backFrac, spineFrac);
    spineMaterial.needsUpdate = true;
    coverSettled();
  }, undefined, coverSettled);
}

// Unlit — page/cover/paper surfaces should read as true, consistent
// color, not get multiplied by the cabinet's warm lights (which is what
// was giving pages and spines a dark, shadowed, hard-to-read tint).
const pageEdgeMaterial = new THREE.MeshBasicMaterial({ color: 0xe6e6e3, toneMapped: false });
const paperEdgeMaterial = new THREE.MeshBasicMaterial({ color: 0xe6e6e3, toneMapped: false });

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

  // Row 1 is the top row, Row 2 the one below it (see rowContainers). Books
  // beyond what fits across a row wrap onto the next row down.
  const takenPerRow = new Map();
  projects.forEach((project) => {
    const requestedRow = project.row ?? 1;
    const taken = takenPerRow.get(requestedRow) ?? 0;
    takenPerRow.set(requestedRow, taken + 1);
    const rowsFromTop = requestedRow - 1 + Math.floor(taken / booksPerRow);
    const row = Math.max(0, numberOfRows - 1 - rowsFromTop);
    const col = taken % booksPerRow;

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
    syncBookList(true);
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

// shelves is in numeric order (Bookshelf 1, 2, 3, ...), but an empty shelf
// makes a terrible first impression: the visitor lands on a bare cabinet and
// has no reason to think there is anything else behind it. So open on the
// first shelf that actually has books, falling back to the first shelf if
// none of them do.
const firstStockedShelf = shelves.findIndex((shelf) => shelf.shelfBooks.length > 0);
let currentShelfIndex = firstStockedShelf === -1 ? 0 : firstStockedShelf;
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

// A png dropped into src/assets/arrows/ replaces the arrow the code draws.
// With only "arrow.png" there, the left arrow is the same image flipped
// horizontally (repeat.x = -1), so one file is enough for both sides; a
// dedicated "arrow-left.png" is used exactly as supplied instead.
function arrowTexture(direction) {
  const side = direction < 0 ? "arrow-left" : "arrow-right";
  const sided = assetByStem(arrowImageModules, [side]);
  const shared = assetByStem(arrowImageModules, ["arrow"]);
  const url = sided || shared;
  if (!url) return createRotateArrowTexture(direction < 0);
  const texture = textureLoader.load(url, () => invalidate());
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  // The plane lies flat on the floor (rotation.x = -90 degrees), which maps
  // the image's top edge to the FAR side of the floor. Art drawn to be read
  // head-on therefore lands upside down from the camera's point of view: an
  // arrow that curves upwards on the page curves downwards on the floor.
  // Flipping V puts the top of the image nearest the viewer, as drawn.
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.y = -1;
  texture.offset.y = 1;
  if (!sided && direction < 0) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.repeat.x = -1;
    texture.offset.x = 1;
  }
  return texture;
}

function createArrowMesh(direction) {
  const geometry = new THREE.PlaneGeometry(arrowWidth, arrowHeight);
  const material = new THREE.MeshBasicMaterial({
    map: arrowTexture(direction),
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

const navPrevButton = document.getElementById("nav-prev");
const navNextButton = document.getElementById("nav-next");
navPrevButton.addEventListener("click", () => navigateCarousel(-1));
navNextButton.addEventListener("click", () => navigateCarousel(1));

// The same png drives these two buttons, so replacing the arrow art changes
// the portrait controls as well as the floor arrows. The ‹ › glyphs in
// library.html are the fallback and are hidden only once an image is found.
(function applyNavArrowImages() {
  const shared = assetByStem(arrowImageModules, ["arrow"]);
  const pairs = [
    [navPrevButton, assetByStem(arrowImageModules, ["arrow-left"]) || shared, true],
    [navNextButton, assetByStem(arrowImageModules, ["arrow-right"]) || shared, false],
  ];
  for (const [button, url, flip] of pairs) {
    if (!button || !url) continue;
    button.classList.add("has-image");
    button.style.backgroundImage = `url("${url}")`;
    // only a shared arrow.png needs mirroring; a left-specific file does not.
    // A class rather than an inline transform, so the :active press-in still
    // applies on top of it (see .nav-arrow.mirrored:active in style.css).
    if (flip && !assetByStem(arrowImageModules, ["arrow-left"])) {
      button.classList.add("mirrored");
    }
  }
})();

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

  keyboardBookIndex = -1;
  currentShelfIndex = (currentShelfIndex + direction + shelves.length) % shelves.length;
  activeShelf = shelves[currentShelfIndex];
  carouselRotationY -= direction * stepAngle;
  updateShelfInfoPanel();
  // a phone frames on the books themselves, and the incoming shelf's may be
  // on a different row — glide the camera there as the carousel turns
  if (portraitQuery.matches) {
    updateCameraFraming();
    gsap.to(camera.position, { ...overviewCameraPos, duration: T(motion.carousel), ease: motion.out, overwrite: "auto", onUpdate: invalidate });
    gsap.to(controls.target, { ...overviewTarget, duration: T(motion.carousel), ease: motion.out, overwrite: "auto", onUpdate: invalidate });
  }

  // The incoming shelf's appearance pop fires partway through the
  // rotation's tail end rather than waiting for it to come to a full
  // stop first — it's already popping into place as it arrives, not
  // standing still and then playing.
  let hasAppeared = false;
  gsap.to(carouselGroup.rotation, {
    y: carouselRotationY,
    duration: T(motion.carousel),
    ease: motion.out,
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
const spreadBookWidth = pageWidth * 2 + 0.2;
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
// On a phone the cabinet is mostly empty shelf and drawer, and the books end
// up a thumbnail in the corner of it. Measure what is actually on the shelf
// and frame that instead, with enough of the carcass left around it to still
// read as a bookshelf. Returns false when there is nothing to look at.
const bookSizeVec = new THREE.Vector3();
const bookRestVec = new THREE.Vector3();
const bookBoxTmp = new THREE.Box3();
function framePortraitOnBooks() {
  const books = activeShelf && activeShelf.shelfBooks;
  if (!books || books.length === 0) return false;

  // Measured from where each book RESTS, not from where it happens to be:
  // this runs as the carousel starts turning, when the incoming shelf's books
  // may still be mid drop-in, and a live reading framed the camera on an
  // empty row. A rest position is also free of the carousel's rotation for
  // height, since the carousel only ever turns about Y.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const book of books) {
    const rest = book.userData.restPosition;
    const home = book.userData.homeGroup;
    if (!rest || !home) return false;
    bookBoxTmp.setFromObject(book);
    bookBoxTmp.getSize(bookSizeVec);
    const y = home.localToWorld(bookRestVec.copy(rest)).y;
    minX = Math.min(minX, rest.x - bookSizeVec.x / 2);
    maxX = Math.max(maxX, rest.x + bookSizeVec.x / 2);
    minY = Math.min(minY, y - bookSizeVec.y / 2);
    maxY = Math.max(maxY, y + bookSizeVec.y / 2);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return false;

  const distance = fitDistance((maxX - minX) * 1.5, (maxY - minY) * 1.6, framingMargin);
  // Then keep the frame inside the cabinet. Books sit on one row, usually off
  // to one side, so a frame centred on them alone hangs over the carcass edge
  // and fills the gap with empty background, which just looks broken.
  const halfHeight = Math.tan((camera.fov * Math.PI) / 360) * distance;
  const halfWidth = halfHeight * camera.aspect;
  const reachX = Math.max(0, outerWidth / 2 - halfWidth);
  const lowestY = sceneBottomY + halfHeight;
  const highestY = cabinetTopEdgeY - halfHeight;
  const x = THREE.MathUtils.clamp((minX + maxX) / 2, -reachX, reachX);
  const y =
    highestY >= lowestY
      ? THREE.MathUtils.clamp((minY + maxY) / 2, lowestY, highestY)
      : (lowestY + highestY) / 2; // cabinet shorter than the frame: centre it
  overviewTarget.set(x, y, 0);
  overviewCameraPos.set(x, y, distance);
  return true;
}

function updateCameraFraming() {
  const portrait = portraitQuery.matches;
  // (no readingState check here: this runs once at start-up, before that
  // variable exists, and while a book is open the overview camera is only
  // where the view will return to anyway)
  if (portrait && framePortraitOnBooks()) {
    // framePortraitOnBooks has set the overview camera; fall through to the
    // reading numbers below, which it does not touch
  } else {
    overviewTarget.set(0, sceneCenterY, 0);
    overviewCameraPos.x = 0;
    overviewCameraPos.y = sceneCenterY;
    // phone: the floor arrows are hidden and the canvas is full width, so frame just the cabinet
    overviewCameraPos.z = fitDistance(portrait ? outerWidth * 1.15 : sceneWidth, sceneHeight, framingMargin);
  }
  const readingWidth = portrait ? singlePageWidth * 1.06 : spreadBookWidth;
  readingCameraPos.z = readingPosition.z + fitDistance(readingWidth, openBookHeight, portrait ? 1.15 : 1.03);
  // phone: look at the middle of the right-hand page (the spine sits at the screen's left edge)
  readingCameraPos.x = readingTarget.x = readingPosition.x + (portrait ? pageWidth / 2 + 0.01 : 0);
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
// Reading needs crisp small text: render the canvas at (at least) 1.75x while
// a book is open, even on a 1x monitor, which supersamples the page text.
function setReadingSharpness(on) {
  // modest bump only, and only once the opening animation has settled, so it never costs smoothness
  const target = on ? Math.min(Math.max(window.devicePixelRatio, 1.25), 1.5) : Math.min(window.devicePixelRatio, 1.5);
  if (target === pixelRatio) return;
  pixelRatio = target;
  applyPixelRatio();
}

// The reading bar is hidden with opacity and pointer-events (see .reading-ui
// in style.css), which hides it from the mouse but NOT from the keyboard: the
// five buttons stay in the tab order, so tabbing through the shelf used to
// land on five invisible controls before reaching anything real. `inert`
// takes them out of the tab order and out of the accessibility tree while
// they are faded out, and nothing else has to change.
const readingUiElements = Array.from(document.querySelectorAll(".reading-ui"));
function setReadingUiReachable(reachable) {
  for (const element of readingUiElements) element.inert = !reachable;
}
setReadingUiReachable(false);

function enterReadingControls() {
  controls.enabled = true;
  controls.enableRotate = false;
  controls.enableZoom = true;
  controls.minDistance = 0.4;
  controls.maxDistance = readingCameraPos.z - readingTarget.z + 1.5;
}

function exitReadingControls() {
  readingZoomed = false;
  controls.enablePan = false;
  controls.enabled = true;
  controls.enableRotate = true;
  controls.minDistance = 1.5;
  controls.maxDistance = 12;
}

// A big black sheet behind the open book, in front of the shelf. It fades in
// while a book opens, so the book is the only bright thing on screen.
const readingDim = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshBasicMaterial({ color: 0x0b0c0e, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
);
readingDim.visible = false;
readingDim.renderOrder = 0;
readingDim.frustumCulled = false;
const dimOpacity = 0.84;

// Everything behind the dimming sheet. Hidden outright while a book is open.
function setCabinetVisible(visible) {
  carouselGroup.visible = visible;
  shadowCatcher.visible = visible;
  // portrait hides the floor arrows anyway, so let that rule decide on the way back
  if (visible) updateArrowVisibility();
  else carouselArrows.forEach((arrow) => (arrow.visible = false));
  if (visible) dirtyShadows(400);
  invalidate(2);
}

const openBookGroup = new THREE.Group();
openBookGroup.position.copy(readingPosition);
openBookGroup.visible = false;
scene.add(openBookGroup);
readingDim.position.set(readingPosition.x, readingPosition.y, readingPosition.z - 0.35);
scene.add(readingDim);

let readingState = null; // { project, pageHinges: [], currentIndex }

// Built once per project and kept around (meshes, materials, and their
// in-flight texture loads) instead of being torn down and rebuilt on
// every open. Rebuilding from scratch — and re-kicking-off every page
// image's load — right as the opening swing starts is what was making
// the transition into a book feel laggy, especially on a book you'd
// already opened before in the same visit.
const openBookCache = new Map(); // project -> { pageHinges, zStep, leftCoverZ, tabs, leftCover }
const openBookCacheSingle = new Map(); // same, for the one-page-at-a-time phone layout

// Kicks off building (and loading the textures for) a project's open-book
// pages without showing them yet. Call this as early as possible — e.g.
// as soon as a book is pulled partway out — so that by the time the
// reader actually clicks to open it, the pages are already built and
// their images are already loading/loaded, and the swing animation isn't
// competing with a burst of fresh image decodes.
let sharedLeafGeometry = null;

// Smooth page curl. A page is two half-width boxes sitting end to end; to bend
// them as ONE continuous curve (instead of folding at the middle) every vertex
// is moved along a circular arc in the vertex shader. `bend` is the arc's
// curvature, shared by everything on the leaf, and `s0` says where this mesh
// sits along the page so both halves join up seamlessly. At bend 0 the shader
// changes nothing, so resting pages are exactly as before.
function applyLeafBend(material, bend, s0) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBend = bend;
    shader.uniforms.uS0 = { value: s0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uBend;\nuniform float uS0;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float s = position.x + uS0;
          float x1 = s;
          float z1 = 0.0;
          float nx = 0.0;
          float nz = 1.0;
          if (uBend > 0.00001) {
            float a = uBend * s;
            x1 = sin(a) / uBend;
            z1 = -(1.0 - cos(a)) / uBend;
            nx = sin(a);
            nz = cos(a);
          }
          transformed.x = x1 - uS0 + nx * position.z;
          transformed.z = z1 + nz * position.z;
        }`
      );
  };
  material.customProgramCacheKey = () => "leafbend";
  return material;
}

function ensureOpenBookBuilt(project, single = false) {
  const cache = single ? openBookCacheSingle : openBookCache;
  const cached = cache.get(project);
  if (cached) return cached;

  const { leaves, sectionLeafStart } = buildLeaves(project, single);

  const zStep = pageThickness + 0.0006;
  // kept comfortably behind every page slot below so the cover never
  // renders in front of a page that's been flipped onto the left pile
  const leftCoverZ = -(leaves.length + 3) * zStep;

  // the permanent left-hand page — doesn't flip, shows title + description
  const leftCoverGeometry = new THREE.BoxGeometry(pageWidth, pageHeight, pageThickness);
  const leftCoverMaterial = titlePageMaterial(project);
  const leftCover = new THREE.Mesh(leftCoverGeometry, [
    pageEdgeMaterial,
    pageEdgeMaterial,
    pageEdgeMaterial,
    pageEdgeMaterial,
    leftCoverMaterial,
    pageEdgeMaterial,
  ]);
  leftCover.position.set(-pageWidth / 2 - 0.01, 0, leftCoverZ);

  // the back cover: sits behind the last leaf on the right, so after the final
  // page turns there is an ending instead of an empty shelf
  const backCoverZ = -(leaves.length + 1) * (pageThickness + 0.0006);
  const backCover = new THREE.Mesh(new THREE.BoxGeometry(pageWidth, pageHeight, pageThickness), [
    pageEdgeMaterial,
    pageEdgeMaterial,
    pageEdgeMaterial,
    pageEdgeMaterial,
    // the inside of the back board, in the same cover colour as the front
    new THREE.MeshBasicMaterial({ color: innerCoverColour(project), map: blankPixel, toneMapped: false }),
    pageEdgeMaterial,
  ]);
  backCover.position.set(pageWidth / 2 + 0.01, 0, backCoverZ);

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
  // every half-page of every book is the same box, so they all share one
  // geometry (less memory, less to upload to the GPU)
  if (!sharedLeafGeometry) sharedLeafGeometry = new THREE.BoxGeometry(segmentWidth, pageHeight, pageThickness, 10, 1, 1); // 10 slices per half so the page can bend smoothly

  const pageHinges = leaves.map((leaf, index) => {
    const hinge = new THREE.Group();
    const originalZ = -index * zStep; // stack back-to-front on the right
    hinge.position.z = originalZ;
    hinge.userData.originalZ = originalZ;
    // where this leaf sits once turned onto the left-hand pile (later leaves on top)
    hinge.userData.leftZ = leftCoverZ + (index + 1) * zStep;

    // unlit + white, not tinted — a lit material multiplied by the
    // cabinet's warm lights would push every page toward yellow
    const innerMaterial = new THREE.MeshBasicMaterial({ color: paperTint, map: blankPixel, toneMapped: false });
    const outerMaterial = new THREE.MeshBasicMaterial({ color: paperTint, map: blankPixel, toneMapped: false });
    const innerBackMaterial = new THREE.MeshBasicMaterial({ color: paperTint, map: blankPixel, toneMapped: false });
    const outerBackMaterial = new THREE.MeshBasicMaterial({ color: paperTint, map: blankPixel, toneMapped: false });
    const bend = { value: 0 }; // curvature, driven by poseHinge
    hinge.userData.bend = bend;
    applyLeafBend(innerMaterial, bend, segmentWidth / 2);
    applyLeafBend(innerBackMaterial, bend, segmentWidth / 2);
    applyLeafBend(outerMaterial, bend, segmentWidth * 1.5);
    applyLeafBend(outerBackMaterial, bend, segmentWidth * 1.5);
    const innerEdge = applyLeafBend(pageEdgeMaterial.clone(), bend, segmentWidth / 2);
    const outerEdge = applyLeafBend(pageEdgeMaterial.clone(), bend, segmentWidth * 1.5);
    // textures are NOT loaded here any more — updateLeafWindow() does that
    // for just the leaves near the page being read
    hinge.userData.rec = {
      leaf,
      mats: [innerMaterial, outerMaterial, innerBackMaterial, outerBackMaterial],
      textures: [],
      token: 0,
      frontLoaded: false,
      backLoaded: false,
    };

    const innerMesh = new THREE.Mesh(sharedLeafGeometry, [
      innerEdge,
      innerEdge,
      innerEdge,
      innerEdge,
      innerMaterial, // +z — front content, visible while unflipped
      innerBackMaterial, // -z — back content, visible once flipped over
    ]);
    innerMesh.position.x = segmentWidth / 2 + 0.01;
    hinge.add(innerMesh);
    hinge.userData.pageMeshes = [innerMesh];

    const creaseHinge = new THREE.Group();
    creaseHinge.position.x = segmentWidth + 0.01;
    hinge.add(creaseHinge);

    const outerMesh = new THREE.Mesh(sharedLeafGeometry, [
      outerEdge,
      outerEdge,
      outerEdge,
      outerEdge,
      outerMaterial,
      outerBackMaterial,
    ]);
    outerMesh.position.x = segmentWidth / 2;
    creaseHinge.add(outerMesh);
    hinge.userData.pageMeshes.push(outerMesh);

    hinge.userData.creaseHinge = creaseHinge;
    return hinge;
  });

  const tabs = buildTabs(project, pageHinges, sectionLeafStart);

  const built = { pageHinges, zStep, leftCoverZ, tabs, leftCover, backCover, windowCenter: null, single };
  cache.set(project, built);
  return built;
}

// Puts a project's (built-or-cached) pages into openBookGroup, reset to
// their closed/unflipped state, ready for the opening swing to reveal.
function buildOpenBook(project, single = false) {
  while (openBookGroup.children.length) {
    openBookGroup.remove(openBookGroup.children[0]);
  }

  const built = ensureOpenBookBuilt(project, single);

  built.pageHinges.forEach((hinge, index) => {
    hinge.rotation.set(0, 0, 0);
    hinge.position.set(0, 0, -index * built.zStep);
    hinge.userData.bend.value = 0;
    setLeafShown(hinge, false); // updateLeafWindow() shows the ones around the current page
    openBookGroup.add(hinge);
  });
  if (!single) openBookGroup.add(built.leftCover); // (a phone shows only the right-hand page)
  openBookGroup.add(built.backCover);

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
  canvas.width = 1024;
  canvas.height = 213; // matches the tab's own width:height ratio, so the label isn't stretched
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = `#${hexColor.toString(16).padStart(6, "0")}`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 88px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
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
      toneMapped: false,
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
  readingNext.disabled = readingState.currentIndex >= readingState.maxIndex;
}

// Turns one page's hinge to `targetY` (0 = flat/unflipped, -PI = flipped
// over to the left) with a soft paper-like curl instead of a rigid swing:
// the outer half bends forward at the crease and the whole page lifts
// slightly through the middle of the turn, then both settle flat again
// at either end — closer to how Issuu (or a real page) turns than a
// perfectly stiff rotation.
// Sets a leaf's whole pose from its current angle: the soft crease bend, the
// slight lift, and which stack's slot it occupies. The leaf stays in its own
// slot of the stack it is leaving until it is edge-on (90 degrees, where it
// can't be seen), and only then moves to its slot in the stack it is landing
// on — switching earlier slid it behind or through its neighbours. Used by
// both the animated flips and by dragging a page by hand.
// A soft shadow the turning page casts on the page beneath it. Without it a
// turning page looks like a flat card sliding over another one; with it the
// page reads as lifted off the stack. One thin gradient plane per leaf, made
// the first time that leaf is turned.
const leafZStep = 0.0024; // pageThickness + the gap between leaves (see ensureOpenBookBuilt)
let shadowTexture = null;
let shadowGeometry = null;
function getLeafShadow(hinge) {
  let mesh = hinge.userData.shadow;
  if (mesh) return mesh;
  if (!shadowTexture) {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 4;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 128, 0);
    grad.addColorStop(0, "rgba(0,0,0,0.10)");
    grad.addColorStop(0.75, "rgba(0,0,0,0.55)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 4);
    shadowTexture = new THREE.CanvasTexture(c);
    shadowTexture.colorSpace = THREE.SRGBColorSpace;
    shadowGeometry = new THREE.PlaneGeometry(1, pageHeight);
    shadowGeometry.translate(0.5, 0, 0); // starts at the spine and grows outward
  }
  const material = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide, // a mirrored (left-hand) shadow flips its winding
    toneMapped: false,
  });
  mesh = new THREE.Mesh(shadowGeometry, material);
  mesh.visible = false;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  hinge.userData.shadow = mesh;
  return mesh;
}

function updateLeafShadow(hinge, angle) {
  const visible = angle > 0.02 && angle < Math.PI - 0.02;
  const mesh = hinge.userData.shadow;
  if (!visible) {
    if (mesh) mesh.visible = false;
    return;
  }
  const shadow = getLeafShadow(hinge);
  if (!shadow.parent && hinge.parent) hinge.parent.add(shadow);
  const c = Math.cos(angle);
  const side = c >= 0 ? 1 : -1;
  const reach = pageWidth * Math.abs(c) + 0.16 * Math.sin(angle); // a little beyond the page's own footprint, so it shows
  shadow.scale.x = side * reach;
  shadow.position.x = side * 0.01;
  const { originalZ, leftZ } = hinge.userData;
  shadow.position.z = (side > 0 ? originalZ : leftZ) - leafZStep + 0.0012; // just above the page underneath
  shadow.material.opacity = Math.sin(angle) * 0.6;
  shadow.visible = true;
}

// A sticky tab is glued to the page's edge, so it rides the curve out to the tip.
function poseTabs(hinge) {
  const k = hinge.userData.bend.value;
  const tipX = k > 1e-5 ? Math.sin(k * pageWidth) / k : pageWidth;
  const tipZ = k > 1e-5 ? -(1 - Math.cos(k * pageWidth)) / k : 0;
  const tipAngle = k * pageWidth;
  for (const child of hinge.children) {
    if (child.userData.startIndex === undefined) continue;
    if (child.userData.baseX === undefined) child.userData.baseX = child.position.x;
    child.position.x = child.userData.baseX - pageWidth + tipX;
    child.position.z = tipZ;
    child.rotation.y = -tipAngle;
  }
}

// How deep the bend shader's curl reaches, measured from the flat sheet: it
// walks an arc of curvature `bend` across the page's width, and the far edge
// ends up (1 - cos(bend * width)) / bend away from where a flat sheet would
// put it. Always on the sheet's own -z side.
function curlDepth(bendValue) {
  if (bendValue <= 0.00001) return 0;
  return (1 - Math.cos(bendValue * pageWidth)) / bendValue;
}

function poseHinge(hinge) {
  const { originalZ, leftZ } = hinge.userData;
  const angle = Math.min(Math.max(-hinge.rotation.y, 0), Math.PI);
  const bend = Math.sin((angle / Math.PI) * Math.PI);
  const curl = bend * 0.3; // the page tip ends up tilted about this many radians relative to the spine
  hinge.userData.bend.value = curl / pageWidth;
  poseTabs(hinge);
  hinge.position.y = bend * 0.025;
  hinge.position.z = (angle < Math.PI / 2 ? originalZ : leftZ) + bend * 0.012;
  updateLeafShadow(hinge, angle);
}

// `momentum` ({ speed } in px/ms) is set when the page is let go of mid-drag:
// it keeps moving the way the hand was moving (decelerating, not starting
// slow like a click-triggered turn) and a harder flick finishes sooner.
function animateFlip(hinge, targetY, duration, delay = 0, momentum = null, land = false) {
  const { originalZ, leftZ } = hinge.userData;
  // finishing a page that was already part-way turned (e.g. let go of while
  // dragging) only needs the remaining fraction of the time
  const remaining = Math.abs(targetY - hinge.rotation.y) / Math.PI;
  const speedFactor = momentum ? THREE.MathUtils.clamp(1 / (1 + momentum.speed * 0.7), 0.5, 1) : 1;
  hinge.userData.peeking = false;
  if (peekHinge === hinge) peekHinge = null;
  gsap.killTweensOf(hinge.userData.bend);
  gsap.to(hinge.rotation, {
    y: targetY,
    duration: duration * Math.max(0.3, Math.min(1, remaining)) * speedFactor,
    delay,
    ease: momentum ? "power2.out" : motion.flipEase,
    overwrite: true, // a fast second click replaces the turn in progress instead of fighting it
    onUpdate: () => poseHinge(hinge),
    onInterrupt: () => poseHinge(hinge),
    onComplete: () => {
      if (land) playPageLand(); // exactly when it touches down, not 0.3 s after the swish
      hinge.position.y = 0;
      hinge.position.z = targetY === 0 ? originalZ : leftZ;
      updateLeafShadow(hinge, targetY === 0 ? 0 : Math.PI);
      // The page lands with a small flutter instead of stopping dead. The
      // curl always bows towards the sheet's own -z, so on a page that has
      // just turned onto the LEFT pile — rotated a half turn — it bows towards
      // the reader, clear of everything. On one landing back on the RIGHT
      // stack the sheet is the right way up, so the same bow reaches about
      // 26 mm straight back, through roughly ten of the 2.4 mm page gaps
      // beneath it, and those pages flickered through the one on top. Holding
      // it forward by exactly the depth of its own curl keeps the sheet clear
      // while it settles, and the offset is gone by the time the flutter is.
      hinge.userData.bend.value = 0.05 / pageWidth;
      const landsFaceUp = targetY === 0;
      const restZ = hinge.position.z;
      if (landsFaceUp) hinge.position.z = restZ + curlDepth(hinge.userData.bend.value);
      gsap.to(hinge.userData.bend, {
        value: 0,
        duration: T(0.5),
        ease: "elastic.out(1, 0.4)",
        overwrite: true,
        onUpdate: () => {
          poseTabs(hinge);
          if (landsFaceUp) hinge.position.z = restZ + curlDepth(hinge.userData.bend.value);
        },
      });
    },
  });
}

// Flips every page between the current position and `targetIndex` at
// once, like grabbing a bookmarked chunk of a real book and turning
// it as a single wad rather than leafing through one page at a time.
// A plain Prev/Next click is just the one-page case of this same jump.
function jumpToIndex(targetIndex, force = false, momentum = null, silent = false) {
  if (!readingState || (readingState.busy && !force)) return;
  const { pageHinges, currentIndex, zStep, leftCoverZ } = readingState;
  const clamped = Math.max(0, Math.min(targetIndex, readingState.maxIndex));
  if (clamped === currentIndex) return;

  // A multi-page jump (a tab, Home/End) fans the pages over one after
  // another over ~0.3 s instead of moving as one stiff slab.
  const count = Math.abs(clamped - currentIndex);
  const step = count > 1 ? T(Math.min(0.045, 0.3 / count)) : 0;
  const duration = T(motion.flip);

  if (clamped > currentIndex) {
    for (let i = currentIndex; i < clamped; i++) {
      const hinge = pageHinges[i];
      // move it just in front of the left cover, and in front of any
      // page already flipped there, so the chunk lands stacked in order
      animateFlip(hinge, -Math.PI, duration, (i - currentIndex) * step, count === 1 ? momentum : null, count === 1 && !silent);
    }
  } else {
    for (let i = currentIndex - 1; i >= clamped; i--) {
      const hinge = pageHinges[i];
      // restore its original spot in the right-hand stack
      animateFlip(hinge, 0, duration, (currentIndex - 1 - i) * step, count === 1 ? momentum : null, count === 1 && !silent);
    }
  }

  readingState.currentIndex = clamped;
  // every page that is about to fly must be drawn while it does
  for (let i = Math.min(currentIndex, clamped); i < Math.max(currentIndex, clamped); i++) {
    setLeafShown(pageHinges[i], true);
  }
  updateLeafWindow(readingState.built, clamped);
  updateReadingUI();
  if (!silent) playFlipSound(count);
  invalidate();
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

const paperViewMaterial = new THREE.MeshBasicMaterial({ color: 0xf8f8f6, toneMapped: false });
let paperViewMesh = null;
let paperReadingState = null; // { paper, currentIndex }

function setPaperViewTexture(imageUrl) {
  textureLoader.load(imageUrl, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAnisotropy;
    const previous = paperViewMaterial.map;
    paperViewMaterial.map = tex;
    paperViewMaterial.needsUpdate = true;
    if (previous && previous !== tex) disposeTexture(previous);
    revealMaterial(paperViewMaterial);
    invalidate();

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
  setReadingUiReachable(true);
  refitCameraFraming();
  enterReadingControls();

  gsap.to(camera.position, { ...readingCameraPos, duration: T(motion.open), ease: motion.inOut });
  gsap.to(controls.target, { ...readingTarget, duration: T(motion.open), ease: motion.inOut });
  announce(`Reading ${paper.title}`);
}

function closePaperView() {
  paperPanel.classList.remove("visible");
  paperViewGroup.visible = false;
  paperReadingState = null;
  exitReadingControls();

  document.body.classList.remove("reading-active");
  setReadingUiReachable(false);
  refitCameraFraming();

  gsap.to(camera.position, { ...overviewCameraPos, duration: T(motion.close), ease: motion.inOut });
  gsap.to(controls.target, { ...overviewTarget, duration: T(motion.close), ease: motion.inOut });
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
// 8. OPENING / CLOSING A BOOK
// -----------------------------------------------------------------------

let activeShelfBook = null;

// A reusable pivot for the opening/closing swing — positioned at the
// book's own spine edge (not its centre) each time a book opens, so the
// book visibly swings open on its binding like a real cover instead of
// spinning in place like a flipped coin.
const bookOpenPivot = new THREE.Group();
scene.add(bookOpenPivot);

// Hands a book back to its own shelf group (it is parented to the scene while
// it is out being read) and puts it exactly back in its slot, as plain
// position / rotation / scale values.
function returnBookToShelf(book) {
  book.userData.homeGroup.attach(book);
  book.position.copy(book.userData.restPosition);
  book.rotation.set(0, 0, 0);
  book.scale.set(1, 1, 1);
}

// The front cover as its own hinged sheet: it shows the book's real cover
// artwork on the outside and the title page on the inside, and swings open on
// the spine to reveal the first page. It is what makes the book OPEN instead
// of just turning around.
const coverClosedZ = 0.004; // just in front of the first page
function getCoverLeaf(book, project) {
  let cover = book.userData.coverLeaf;
  if (cover) return cover;
  const hinge = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(pageWidth, pageHeight);
  // the book's own front-cover material, so the swap from the closed book to this sheet is invisible
  const outside = new THREE.Mesh(geometry, book.material[0]);
  outside.position.set(pageWidth / 2 + 0.01, 0, 0.0004);
  const insideMaterial = titlePageMaterial(project);
  const inside = new THREE.Mesh(geometry, insideMaterial);
  inside.rotation.y = Math.PI;
  inside.position.set(pageWidth / 2 + 0.01, 0, -0.0004);
  hinge.add(outside, inside);
  cover = { hinge };
  book.userData.coverLeaf = cover;
  return cover;
}

// Pose of the cover sheet from its angle: stays in front of the pages until it is
// edge-on, then sits on the left-hand pile behind every page that lands there.
function poseCoverLeaf(cover, built) {
  const hinge = cover.hinge;
  const angle = Math.min(Math.max(-hinge.rotation.y, 0), Math.PI);
  hinge.position.y = Math.sin(angle) * 0.02;
  hinge.position.z = angle < Math.PI / 2 ? coverClosedZ : built.leftCoverZ + 0.0006;
}

function openBook(book) {
  activeShelfBook = book;
  const project = book.userData.project;
  // Decided once, at the moment the book opens: a phone (portrait) shows one
  // page at a time, a landscape screen shows the two-page spread. Mid-read
  // orientation changes deliberately don't retroactively switch modes.
  const single = portraitQuery.matches;

  // Both layouts are real hinged pages (so a page can be dragged by hand on a
  // phone too); the phone layout just has one page per leaf, no tabs and no
  // left-hand page, and the camera looks at the right-hand page only.
  const built = buildOpenBook(project, single);
  const { pageHinges, zStep, leftCoverZ, tabs } = built;
  readingState = {
    mode: single ? "single" : "spread",
    project,
    built,
    pageHinges,
    currentIndex: 0,
    zStep,
    leftCoverZ,
    tabs,
    maxIndex: single ? pageHinges.length - 1 : pageHinges.length, // a phone never turns its last page away
    busy: true, // defer page turns / close until the opening animation has finished
  };
  closeRequestedWhileBusy = false; // nothing carried over from the last book
  updateLeafWindow(built, 0);
  updateReadingUI();

  readingZoomed = false;
  lastReadSide = 1;
  syncZoomButton();
  readingTitle.textContent = project.title;
  readingPanel.classList.add("visible");
  updatePreviewPanel(); // readingState is set above, so this hides the preview panel

  // The title page is carried by the cover sheet now, so the separate left-hand page stays hidden
  built.leftCover.visible = false;
  const cover = getCoverLeaf(book, project);
  cover.hinge.rotation.set(0, 0, 0);
  cover.hinge.position.set(0, 0, coverClosedZ);
  cover.hinge.visible = true; // a phone hides it once it has swung open
  openBookGroup.add(cover.hinge);
  openBookGroup.visible = false;

  document.body.classList.add("reading-active");
  setReadingUiReachable(true);
  refitCameraFraming();
  enterReadingControls();

  // One continuous move, in two beats:
  //  1. the book leaves the shelf, turns a quarter turn so its FRONT COVER faces
  //     you, and grows to page size as it comes to the middle of the screen;
  //  2. its cover swings open 180 degrees on the spine, revealing the first page.
  // The camera pushes in gradually across both.
  scene.attach(book); // keeps where it is in the world; from here on it is animated in world space
  const beat1 = T(0.55);
  const beat2 = T(0.65);
  const tl = gsap.timeline({
    onComplete: () => {
      if (readingState) readingState.busy = false;
      // an Escape or close press that arrived mid-opening is honoured here
      if (closeRequestedWhileBusy) {
        closeRequestedWhileBusy = false;
        closeBook();
        return;
      }
      setReadingSharpness(true);
      nudgeNextPage();
    },
  });
  readingDim.visible = true;
  gsap.to(readingDim.material, {
    opacity: dimOpacity,
    duration: T(0.55 + 0.65),
    ease: "sine.inOut",
    overwrite: "auto",
    onUpdate: invalidate,
    // Once the sheet is fully opaque the cabinet behind it cannot be seen, so
    // stop drawing it at all: that is most of the scene's draw calls and its
    // whole shadow pass, gone for as long as the book is open.
    onComplete: () => setCabinetVisible(false),
  });
  tl.to(
    book.position,
    {
      x: readingPosition.x + 0.01 + pageWidth / 2, // spine on the left edge of the right-hand page
      y: readingPosition.y,
      z: readingPosition.z - bookWidth / 2 + coverClosedZ, // front cover lands where the cover sheet starts
      duration: beat1,
      ease: "power2.inOut",
    },
    0
  );
  tl.to(book.rotation, { y: -Math.PI / 2, duration: beat1, ease: "power2.inOut" }, 0);
  tl.to(book.scale, { x: 1, y: pageHeight / bookHeight, z: pageWidth / bookDepth, duration: beat1, ease: "power2.inOut" }, 0);
  tl.call(() => {
    // swap the closed book for the (identical-looking) cover sheet on top of the first page
    book.visible = false;
    openBookGroup.visible = true;
  });
  tl.to(cover.hinge.rotation, {
    y: -Math.PI,
    duration: beat2,
    ease: "power2.inOut",
    onUpdate: () => poseCoverLeaf(cover, built),
    onComplete: () => {
      poseCoverLeaf(cover, built);
      // On a phone there is no left-hand page to lie over the opened front
      // cover, so it was left hanging in view down the left edge of the
      // screen, looking like a stray sheet. Nothing needs it again until the
      // book closes, and closeBook puts it back.
      if (single) cover.hinge.visible = false;
    },
  });
  playCoverSwish();

  gsap.to(camera.position, { ...readingCameraPos, duration: beat1 + beat2, ease: "sine.inOut", overwrite: "auto" });
  gsap.to(controls.target, { ...readingTarget, duration: beat1 + beat2, ease: "sine.inOut", overwrite: "auto" });
  announce(`Opened ${project.title}. Page 1 of ${project.pages.length}.`);
  playThud();
}

// Escape and the close button used to be dropped on the floor if they came in
// while the book was still opening — roughly a two second window in which the
// app looked responsive and silently ignored you, so the natural response was
// to press again and then wonder which press had worked. The request is now
// remembered and runs the moment the opening animation finishes: never lost,
// only deferred.
let closeRequestedWhileBusy = false;

function closeBook() {
  if (!readingState) return;
  if (readingState.busy) {
    closeRequestedWhileBusy = true;
    return;
  }
  closeRequestedWhileBusy = false;
  const state = readingState;
  const book = activeShelfBook;
  const built = state.built;
  state.busy = true;
  bookDrag = null;
  setCabinetVisible(true); // the book is about to fly back into it
  readingPanel.classList.remove("visible");
  exitReadingControls();
  setHoveredTab(null); // reset any tab left mid-glow/scaled from hovering
  setPagePeek(null);
  document.body.classList.remove("reading-active");
  setReadingUiReachable(false);
  refitCameraFraming();

  // The opening played backwards: pages turn back to the start (if you were
  // further in), the cover swings shut, the book becomes a solid object again
  // and goes back to its slot on the shelf.
  const cover = book.userData.coverLeaf;
  const pagesBack = state.currentIndex > 0;
  const beatPages = pagesBack ? T(0.55) : 0;
  const beatCover = T(0.5);
  const beatShelf = T(0.6);
  const restWorld = book.userData.homeGroup.localToWorld(book.userData.restPosition.clone());

  const tl = gsap.timeline({
    onComplete: () => {
      returnBookToShelf(book);
      dirtyShadows(800);
      setReadingSharpness(false);
      book.visible = true;
      book.userData.state = "shelved";
      releaseBookTextures(book.userData.project); // free the page images from GPU memory
      openBookGroup.visible = false;
      activeShelfBook = null;
      readingState = null;
      syncBookList();
      announce("Closed the book.");
    },
  });
  if (pagesBack) tl.call(() => jumpToIndex(0, true, null, true), null, 0);
  tl.to(
    cover.hinge.rotation,
    {
      y: 0,
      duration: beatCover,
      ease: "power2.inOut",
      onUpdate: () => poseCoverLeaf(cover, built),
      onComplete: () => poseCoverLeaf(cover, built),
    },
    beatPages
  );
  tl.call(() => {
    openBookGroup.visible = false;
    book.visible = true;
    playCloseSound();
  });
  tl.to(book.position, { x: restWorld.x, y: restWorld.y, z: restWorld.z, duration: beatShelf, ease: "power2.inOut" }, ">");
  tl.to(book.rotation, { y: 0, duration: beatShelf, ease: "power2.inOut" }, "<");
  tl.to(book.scale, { x: 1, y: 1, z: 1, duration: beatShelf, ease: "power2.inOut" }, "<");

  const total = beatPages + beatCover + beatShelf;
  gsap.to(readingDim.material, {
    opacity: 0,
    duration: total,
    ease: "sine.inOut",
    overwrite: "auto",
    onUpdate: invalidate,
    onComplete: () => {
      readingDim.visible = false;
    },
  });
  gsap.to(camera.position, { ...overviewCameraPos, duration: total, ease: "sine.inOut", overwrite: "auto" });
  gsap.to(controls.target, { ...overviewTarget, duration: total, ease: "sine.inOut", overwrite: "auto" });
}

// -----------------------------------------------------------------------
// 9. SHELF PULL-OUT / PUSH-BACK
// -----------------------------------------------------------------------

// Compiles the open-book shaders ahead of time. Three.js only compiles a
// material's program the first time it is actually drawn, so without this the
// first book to open pays for it in the middle of its own opening swing. Every
// book's pages are built the same way, so warming one warms them all.
let openBookWarmed = false;
function warmOpenBookShaders(built) {
  if (openBookWarmed || !built) return;
  openBookWarmed = true;
  const parked = [];
  built.pageHinges.slice(0, 2).forEach((hinge) => {
    setLeafShown(hinge, true);
    openBookGroup.add(hinge);
    parked.push(hinge);
  });
  if (built.leftCover) {
    openBookGroup.add(built.leftCover);
    parked.push(built.leftCover);
  }
  if (built.backCover) {
    openBookGroup.add(built.backCover);
    parked.push(built.backCover);
  }
  const wasVisible = openBookGroup.visible;
  openBookGroup.visible = true; // compile() only walks what is visible
  try {
    renderer.compile(scene, camera);
  } catch {
    /* warming up is best effort — never let it break opening a book */
  }
  openBookGroup.visible = wasVisible;
  parked.forEach((object) => {
    openBookGroup.remove(object);
    if (object.userData.pageMeshes) setLeafShown(object, false);
  });
}

function pullOut(book) {
  book.userData.state = "out";
  // start building this book's pages (and loading their images) the
  // moment it's pulled out, well before the reader clicks to actually
  // open it — so the swing-open animation isn't competing with a burst
  // of fresh page loads and feels immediate instead of laggy
  const builtForHover = ensureOpenBookBuilt(book.userData.project, portraitQuery.matches);
  updateLeafWindow(builtForHover, 0, true);
  warmOpenBookShaders(builtForHover);
  dirtyShadows();
  gsap.to(book.position, {
    x: book.userData.restPosition.x,
    y: book.userData.restPosition.y,
    z: book.userData.restPosition.z + 1.3,
    duration: T(motion.pull),
    ease: motion.settle, // slides out with a small, soft overshoot
  });
}

function pushBack(book) {
  book.visible = true;
  book.userData.state = "shelved";
  gsap.to(book.position, {
    x: book.userData.restPosition.x,
    y: book.userData.restPosition.y,
    z: book.userData.restPosition.z,
    duration: T(motion.pull),
    ease: motion.inOut,
  });
  gsap.to(book.rotation, { y: 0, duration: T(motion.close), ease: motion.inOut });
  // a book that was only peeked at (never opened) gives its page images back
  if (!(readingState && readingState.project === book.userData.project)) {
    releaseBookTextures(book.userData.project);
  }
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

readingPrev.addEventListener("click", flipPrev);
readingNext.addEventListener("click", flipNext);
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

// --- phone: a row of book buttons under the shelf (portrait layout, see
// style.css). Tapping the thin spines of a shelf-full of books is fiddly, so
// every book also gets a big button: tap once to pull it out, tap again to open.

// The chip strip scrolls sideways on a phone, but a row of chips that simply
// stops at the screen edge gives no sign of it. Fade the edge you can still
// scroll towards, and only that one.
function updateBookListFade() {
  if (!bookListEl) return;
  const slack = bookListEl.scrollWidth - bookListEl.clientWidth;
  const atStart = bookListEl.scrollLeft <= 2;
  const atEnd = bookListEl.scrollLeft >= slack - 2;
  bookListEl.classList.toggle("fade-start", slack > 4 && !atStart);
  bookListEl.classList.toggle("fade-end", slack > 4 && !atEnd);
}
if (bookListEl) {
  bookListEl.addEventListener("scroll", updateBookListFade, { passive: true });
  window.addEventListener("resize", updateBookListFade);
}

function syncBookList(rebuild = false) {
  if (!bookListReady || !bookListEl) return;
  requestAnimationFrame(updateBookListFade);
  const books = activeShelf.shelfBooks;
  if (rebuild || bookListShelf !== activeShelf) {
    bookListShelf = activeShelf;
    bookListEl.replaceChildren();
    books.forEach((book) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "book-chip";
      chip.addEventListener("click", () => selectBookFromList(book));
      bookListEl.appendChild(chip);
    });
  }
  [...bookListEl.children].forEach((chip, i) => {
    const book = books[i];
    const title = book.userData.project.title;
    const selected = hoveredBook === book && !readingState;
    chip.classList.toggle("selected", selected);
    chip.setAttribute("aria-pressed", String(selected));
    chip.textContent = selected ? `Open ${title} \u203A` : title;
    if (selected) chip.scrollIntoView({ inline: "nearest", block: "nearest" });
  });
}

// The single owner of "which book is currently pulled out". Three different
// things choose a book — the mouse, the keyboard and the chips — and each
// used to put the previous one back itself. Any path that cleared hoveredBook
// without doing so (or a mouse that simply left the canvas) stranded a book
// off the shelf, and a second one could then be pulled out beside it. Every
// one of them now goes through here, and the sweep below makes the rule
// "exactly one book out at a time" true by construction rather than by every
// caller remembering to tidy up.
function setHoveredBook(book, { sound = false } = {}) {
  if (hoveredBook === book) return;
  if (hoveredBook && hoveredBook.userData.state === "out") pushBack(hoveredBook);
  hoveredBook = book;
  if (hoveredBook && hoveredBook.userData.state === "shelved") {
    pullOut(hoveredBook);
    if (sound) playHoverSound();
  }
  // belt and braces: anything else still standing proud of this shelf goes
  // back, whatever left it there. The open book is exempt — it is not on the
  // shelf at all while it is being read.
  for (const other of activeShelf.shelfBooks) {
    if (other === hoveredBook) continue;
    if (other.userData.state !== "out") continue;
    if (readingState && readingState.project === other.userData.project) continue;
    pushBack(other);
  }
  updatePreviewPanel();
}

function selectBookFromList(book) {
  if (readingState || paperReadingState || isCarouselRotating) return;
  if (hoveredBook === book && book.userData.state === "out") {
    hoveredBook = null;
    keyboardBookIndex = -1;
    openBook(book);
    syncBookList();
    return;
  }
  keyboardBookIndex = activeShelf.shelfBooks.indexOf(book);
  setHoveredBook(book, { sound: true });
  announce(`${book.userData.project.title}. Tap again to open.`);
}

// A fingertip is much bigger than a book spine: if a tap misses every book, open/select the nearest one
// within a thumb's width instead of ignoring it.
const pickPoint = new THREE.Vector3();
function pickBookNear(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  let best = null;
  let bestDistance = 44;
  activeShelf.shelfBooks.forEach((book) => {
    book.getWorldPosition(pickPoint).project(camera);
    const x = rect.left + ((pickPoint.x + 1) / 2) * rect.width;
    const y = rect.top + ((1 - pickPoint.y) / 2) * rect.height;
    const distance = Math.hypot(event.clientX - x, event.clientY - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = book;
    }
  });
  return best;
}

function updatePreviewPanel() {
  syncBookList();
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

  if (readingState?.busy) return; // the book is opening or closing
  setPointerFromEvent(event);

  if (readingState && readingState.mode === "single") {
    const hits = raycaster.intersectObject(openBookGroup, true);
    if (hits.length === 0) {
      // clicked past the page entirely — treat it like closing the book
      closeBook();
      return;
    }
    // right part of the page = next, left part = previous
    const localPoint = openBookGroup.worldToLocal(hits[0].point.clone());
    if (localPoint.x >= pageWidth * 0.4) flipNext();
    else flipPrev();
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
  const tapped = hits.length > 0 ? hits[0].object : coarsePointer.matches ? pickBookNear(event) : null;
  if (tapped) {
    const book = tapped;
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

// --- dragging a page by hand (open-book spread, desktop) -----------------
// Press on a page and drag: the page edge follows the pointer, bending as it
// goes. Let go past roughly a third of the way (or with a flick) and it
// finishes turning; otherwise it settles back. A plain click still turns the
// page, and the section tabs still work as before.
let bookDrag = null;
const dragStartDistance = 6; // px before a press counts as a drag rather than a click

// Hover peek: on a mouse, the outer edge of a page lifts a touch when you
// point at it, hinting that it can be grabbed (the cursor changes too).
let peekHinge = null;
function setPagePeek(hinge, side) {
  if (hinge === peekHinge) return;
  if (peekHinge && peekHinge.userData.peeking) {
    const old = peekHinge;
    const rest = old.userData.peekRest;
    gsap.to(old.rotation, {
      y: rest,
      duration: T(0.3),
      ease: "power2.out",
      overwrite: true,
      onUpdate: () => poseHinge(old),
      onComplete: () => {
        old.userData.peeking = false;
        poseHinge(old);
      },
    });
  }
  peekHinge = null;
  if (!hinge || gsap.isTweening(hinge.rotation) || hinge.userData.peeking) return;
  peekHinge = hinge;
  hinge.userData.peeking = true;
  hinge.userData.peekRest = side > 0 ? 0 : -Math.PI;
  setLeafShown(hinge, true);
  gsap.to(hinge.rotation, {
    y: side > 0 ? -0.16 : -(Math.PI - 0.16),
    duration: T(0.3),
    ease: "power2.out",
    overwrite: true,
    onUpdate: () => poseHinge(hinge),
  });
}

// Once per visit, right after a book has opened, the next page lifts and
// settles on its own so people can see that pages are movable.
let nudgeShown = false;
function nudgeNextPage() {
  if (nudgeShown || !readingState || readingState.currentIndex !== 0) return;
  const hinge = readingState.pageHinges[0];
  if (!hinge) return;
  nudgeShown = true;
  const rest = 0;
  gsap.to(hinge.rotation, {
    y: -0.32,
    duration: T(0.45),
    ease: "power2.out",
    yoyo: true,
    repeat: 1,
    overwrite: true,
    onUpdate: () => poseHinge(hinge),
    onComplete: () => {
      hinge.rotation.y = rest;
      poseHinge(hinge);
    },
  });
}

function beginBookDrag(event) {
  if (!readingState || readingState.busy || event.button > 0) return;
  const single = readingState.mode === "single";
  setPointerFromEvent(event);
  if (readingState.tabs.length > 0 && raycaster.intersectObjects(readingState.tabs).length > 0) return;
  const hits = raycaster.intersectObject(openBookGroup, true);
  if (hits.length === 0) return;
  // spread: grab the right page to turn forward, the left page to turn back.
  // phone: there is only the right-hand page, so the drag direction decides
  // (drag left = next page, drag right = bring the previous page back).
  let side = 0;
  let hinge = null;
  if (!single) {
    side = openBookGroup.worldToLocal(hits[0].point.clone()).x >= 0 ? 1 : -1;
    hinge = readingState.pageHinges[side > 0 ? readingState.currentIndex : readingState.currentIndex - 1];
    if (!hinge) return;
  }

  // how many screen pixels one page is wide, so the page edge can track the pointer 1:1
  const rect = renderer.domElement.getBoundingClientRect();
  const toScreenX = (localX) => {
    const v = openBookGroup.localToWorld(new THREE.Vector3(localX, 0, 0)).project(camera);
    return rect.left + ((v.x + 1) / 2) * rect.width;
  };
  const pagePx = Math.abs(toScreenX(pageWidth) - toScreenX(0));
  if (pagePx < 40) return;

  bookDrag = {
    single,
    active: false,
    side,
    hinge,
    pagePx,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastT: performance.now(),
    velocity: 0,
    pointerId: event.pointerId,
  };
}

// The angle a dragged page is turned to. Spread: the page edge starts on its
// own side and moves 1:1 with the pointer. Phone, bringing a page back: the page
// starts off-screen to the left, so it is brought in faster than 1:1 or you'd
// have to drag across the whole screen before it showed up.
function dragAngle(d, dx) {
  if (d.single && d.side < 0) {
    const f = THREE.MathUtils.clamp(dx / (0.85 * d.pagePx), 0, 1);
    return Math.PI * Math.pow(1 - f, 3);
  }
  return Math.acos(THREE.MathUtils.clamp(d.side + dx / d.pagePx, -1, 1));
}

function updateBookDrag(event) {
  const d = bookDrag;
  const dx = event.clientX - d.startX;
  const dy = event.clientY - d.startY;
  if (!d.active) {
    if (Math.abs(dx) < dragStartDistance || Math.abs(dy) > Math.abs(dx) * 1.5) return;
    if (d.single) {
      const side = dx < 0 ? 1 : -1;
      const hinge = readingState.pageHinges[side > 0 ? readingState.currentIndex : readingState.currentIndex - 1];
      // nothing to turn that way (first / last page): let go of the drag, so the rest of the gesture is ignored
      if (!hinge || (side > 0 && readingState.currentIndex >= readingState.maxIndex)) {
        bookDrag = null;
        return;
      }
      d.side = side;
      d.hinge = hinge;
    } else if (d.side > 0 ? dx > 0 : dx < 0) {
      return; // dragging the wrong way for this page
    }
    d.active = true;
    gsap.killTweensOf(d.hinge.rotation);
    gsap.killTweensOf(d.hinge.userData.bend);
    d.hinge.userData.peeking = false;
    setLeafShown(d.hinge, true);
    setHoveredTab(null);
    try {
      renderer.domElement.setPointerCapture(d.pointerId);
    } catch {
      /* pointer already gone */
    }
    setCursor("grabbing");
  }
  const now = performance.now();
  const dt = Math.max(1, now - d.lastT);
  d.velocity = d.velocity * 0.6 + ((event.clientX - d.lastX) / dt) * 0.4; // px per ms, smoothed
  d.lastX = event.clientX;
  d.lastT = now;

  d.hinge.rotation.y = -dragAngle(d, dx);
  poseHinge(d.hinge);
  invalidate();
}

function endBookDrag(commitAllowed) {
  const d = bookDrag;
  bookDrag = null;
  if (!d || !d.active) return;
  suppressNextClick = true; // the click that follows a drag must not also turn the page
  try {
    renderer.domElement.releasePointerCapture(d.pointerId);
  } catch {
    /* ignore */
  }
  if (!readingState) return;

  const angle = THREE.MathUtils.clamp(-d.hinge.rotation.y, 0, Math.PI);
  const progress = d.side > 0 ? angle / Math.PI : 1 - angle / Math.PI; // how far it has travelled toward its destination
  const flick = d.velocity * d.side * -1; // positive = moving toward the destination
  // (a phone's returning page is only visible once it is past halfway, so it must get there first)
  const needed = d.single && d.side < 0 ? 0.5 : 0.3;
  const commit = commitAllowed && (progress > needed || flick > 0.5) && !(flick < -0.5);
  if (commit) {
    jumpToIndex(readingState.currentIndex + (d.side > 0 ? 1 : -1), false, { speed: Math.abs(d.velocity) });
  } else {
    animateFlip(d.hinge, d.side > 0 ? 0 : -Math.PI, T(motion.flip), 0, { speed: Math.abs(d.velocity) }, true);
  }
}

function onPointerDown(event) {
  activePointers.add(event.pointerId);
  if (!readingState && !paperReadingState && renderer.domElement.style.cursor === "grab") setCursor("grabbing");
  if (!readingState && !paperReadingState) return;
  if (activePointers.size > 1) {
    dragStart = null;
    if (bookDrag) endBookDrag(false); // a second finger (pinch-zoom) cancels the page drag
    bookDrag = null;
    return;
  }
  if (readingState) {
    beginBookDrag(event);
    return; // book pages handle their own dragging; swipe-to-flip is only for the paper view now
  }
  dragStart = { x: event.clientX, y: event.clientY };
}

function onPointerUp(event) {
  activePointers.delete(event.pointerId);
  if (renderer.domElement.style.cursor === "grabbing") setCursor(readingState || paperReadingState ? "grab" : "grab");
  if (bookDrag) {
    endBookDrag(true);
    return;
  }
  if (!dragStart) return;
  const dx = event.clientX - dragStart.x;
  const dy = event.clientY - dragStart.y;
  dragStart = null;

  if (Math.abs(dx) >= swipeThreshold && Math.abs(dx) > Math.abs(dy)) {
    if (paperReadingState) {
      if (dx < 0) paperFlip(1);
      else paperFlip(-1);
    }
    suppressNextClick = true;
  }
}

// the canvas must own touch gestures, or a phone's browser claims a sideways
// swipe for itself (scroll / back-swipe) and cancels the page drag
renderer.domElement.style.touchAction = "none";
// forget fingers that lifted outside the canvas, so a stale one can't make every later touch look like a pinch
window.addEventListener("pointerup", (e) => activePointers.delete(e.pointerId));
window.addEventListener("pointercancel", (e) => activePointers.delete(e.pointerId));
renderer.domElement.addEventListener("pointerleave", (e) => {
  if (e.pointerType !== "mouse") return; // a finger that lifts has not "left"
  setPagePeek(null);
  // Nothing is hovered once the cursor is off the canvas. Without this a book
  // stayed pulled out for good when the mouse wandered onto the text beside
  // the shelf, and the next book hovered came out alongside it.
  if (!readingState && !paperReadingState && !isCarouselRotating) {
    keyboardBookIndex = -1;
    setHoveredBook(null);
  }
});
renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("pointerup", onPointerUp);
renderer.domElement.addEventListener("pointercancel", (event) => {
  activePointers.delete(event.pointerId);
  if (bookDrag) endBookDrag(false);
});

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
  gsap.to(tab.scale, { x: 1.15, y: 1.15, duration: T(motion.hover), ease: motion.out });
  tab.userData.hoverMaterials.forEach((material) => {
    gsap.to(material.color, { r: 1.4, g: 1.4, b: 1.4, duration: T(motion.hover) });
  });
}

function unhoverTab(tab) {
  gsap.to(tab.scale, { x: 1, y: 1, duration: T(motion.hover), ease: motion.out });
  tab.userData.hoverMaterials.forEach((material) => {
    gsap.to(material.color, { r: 1, g: 1, b: 1, duration: T(motion.hover) });
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
  if (hoveredArrow) gsap.to(hoveredArrow.scale, { x: 1, y: 1, z: 1, duration: T(motion.hover), ease: motion.out });
  hoveredArrow = arrow;
  if (hoveredArrow) gsap.to(hoveredArrow.scale, { x: 1.15, y: 1.15, z: 1.15, duration: T(motion.hover), ease: motion.out });
}

// Hovering does the "pull a book partway out to see it" gesture; hovering
// off it (or a fresh pointer move landing on nothing) settles it back —
// clicking a book that's already pulled out is what opens it. The drawer
// front gets the same hover-peek treatment, independently of whichever
// book is currently hovered. All of this only ever targets the shelf
// that's currently at the front of the carousel.
let hoveredBook = null;

function setCursor(value) {
  if (renderer.domElement.style.cursor !== value) renderer.domElement.style.cursor = value;
}

function onPointerMove(event) {
  if (bookDrag) {
    updateBookDrag(event);
    return;
  }
  // the swipe-to-flip drag (pointerdown/up above) is what handles pointer
  // movement while reading — orbiting/hover-peek stay off until you close.
  // Tab hover still works, since it's not fighting the drag for meaning.
  if (readingState || paperReadingState) {
    if (dragStart) return;
    setPointerFromEvent(event);
    if (readingState && readingState.mode === "spread") {
      const tabHits = readingState.tabs.length > 0 ? raycaster.intersectObjects(readingState.tabs) : [];
      setHoveredTab(tabHits.length > 0 ? tabHits[0].object : null);
      if (tabHits.length > 0) {
        setCursor("pointer");
        setPagePeek(null);
      } else {
        // the cursor says which way a click turns the page
        const hits = raycaster.intersectObject(openBookGroup, true);
        if (hits.length === 0) {
          setCursor("zoom-out"); // click past the book = close it
          setPagePeek(null);
        } else {
          setCursor("grab"); // press and drag a page to turn it; a click turns it too
          if (event.pointerType === "mouse" && !readingState.busy) {
            const lx = openBookGroup.worldToLocal(hits[0].point.clone()).x;
            const side = lx >= 0 ? 1 : -1;
            const outer = Math.abs(lx) > pageWidth * 0.5;
            const hinge = outer ? readingState.pageHinges[side > 0 ? readingState.currentIndex : readingState.currentIndex - 1] : null;
            setPagePeek(hinge, side);
          }
        }
      }
    } else if (readingState) {
      setHoveredTab(null);
      setCursor(raycaster.intersectObject(openBookGroup, true).length === 0 ? "zoom-out" : "grab");
    } else {
      setHoveredTab(null);
      const hits = raycaster.intersectObject(paperViewMesh);
      setCursor(hits.length === 0 ? "zoom-out" : "default");
    }
    return;
  }
  setPointerFromEvent(event);

  const arrowHits = raycaster.intersectObjects(carouselArrows);
  setHoveredArrow(arrowHits.length > 0 ? arrowHits[0].object : null);

  let overDrawer = false;
  if (activeShelf.getDrawerState() !== "open") {
    const drawerHits = raycaster.intersectObject(activeShelf.drawerFrontPanel);
    overDrawer = drawerHits.length > 0;
    if (overDrawer) activeShelf.peekDrawer();
    else activeShelf.unpeekDrawer();
  } else {
    overDrawer = raycaster.intersectObject(activeShelf.drawerFrontPanel).length > 0;
    if (!overDrawer) overDrawer = raycaster.intersectObjects(activeShelf.paperMeshes).length > 0;
  }

  const hits = raycaster.intersectObjects(activeShelf.shelfBooks);
  const hovered = hits.length > 0 ? hits[0].object : null;

  setCursor(hovered || overDrawer || arrowHits.length > 0 ? "pointer" : event.buttons ? "grabbing" : "grab");

  setHoveredBook(hovered, { sound: true });
}

renderer.domElement.addEventListener("pointermove", onPointerMove);

// -----------------------------------------------------------------------
// 11d. KEYBOARD CONTROLS
// Everything the mouse does is reachable from the keyboard:
//   overview : <- / -> switch shelf, Up / Down choose a book, Enter open it,
//              Esc put it back / close the drawer
//   reading  : <- / -> (or PageUp/PageDown, Space) turn the page,
//              Home / End first / last page, Esc close
// -----------------------------------------------------------------------

let keyboardBookIndex = -1;

function keyboardPickBook(delta) {
  const books = activeShelf.shelfBooks;
  if (books.length === 0) return;
  if (keyboardBookIndex === -1) keyboardBookIndex = delta > 0 ? 0 : books.length - 1;
  else keyboardBookIndex = (keyboardBookIndex + delta + books.length) % books.length;
  setHoveredBook(books[keyboardBookIndex], { sound: true });
  announce(`${hoveredBook.userData.project.title}. Press Enter to open.`);
}

function onKeyDown(event) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  const tag = event.target.tagName;
  // let real buttons keep their own Enter/Space behaviour
  if ((tag === "BUTTON" || tag === "A") && (event.key === "Enter" || event.key === " ")) return;
  const key = event.key;

  if (readingState) {
    if (key === "ArrowRight" || key === "PageDown" || key === " ") {
      flipNext();
    } else if (key === "ArrowLeft" || key === "PageUp") {
      flipPrev();
    } else if (key === "Home") {
      jumpToIndex(0);
    } else if (key === "End") {
      jumpToIndex(readingState.maxIndex);
    } else if (key === "z" || key === "Z") {
      setReadingZoom(!readingZoomed, lastReadSide);
    } else if (key === "Escape") {
      if (readingZoomed) setReadingZoom(false);
      else closeBook();
    } else {
      return;
    }
    event.preventDefault();
    return;
  }

  if (paperReadingState) {
    if (key === "ArrowRight" || key === "PageDown") paperFlip(1);
    else if (key === "ArrowLeft" || key === "PageUp") paperFlip(-1);
    else if (key === "Escape") closePaperView();
    else return;
    event.preventDefault();
    return;
  }

  if (key === "ArrowLeft") navigateCarousel(-1);
  else if (key === "ArrowRight") navigateCarousel(1);
  else if (key === "ArrowDown") keyboardPickBook(1);
  else if (key === "ArrowUp") keyboardPickBook(-1);
  else if (key === "Enter" && hoveredBook && hoveredBook.userData.state === "out") {
    const book = hoveredBook;
    hoveredBook = null;
    keyboardBookIndex = -1;
    openBook(book);
  } else if (key === "Escape") {
    if (hoveredBook && hoveredBook.userData.state === "out") pushBack(hoveredBook);
    hoveredBook = null;
    keyboardBookIndex = -1;
    updatePreviewPanel();
    if (activeShelf.getDrawerState() === "open") activeShelf.closeDrawer();
  } else {
    return;
  }
  event.preventDefault();
}

document.addEventListener("keydown", onKeyDown);


// -----------------------------------------------------------------------
// 11d-2. ZOOM TO READ, AND THE CRISP PAGE OVERLAY
//
// Two separate problems, one section.
//
// 1. A page scan is a tall document. Fitted to a 16:9 screen the whole page
//    is visible but its body text ends up only a dozen or so pixels tall, so
//    "zoom" here means going CLOSER than the fit and letting the page run off
//    the top and bottom of the screen, with panning to move around it. That is
//    how anyone reads a PDF, and it is what the fit alone can never give.
//
// 2. Even perfectly framed, WebGL has to squeeze a 1600 px page scan into the
//    few hundred pixels the page covers, through a mipmap, with antialiasing
//    off. That is what makes the text look soft. So whenever nothing is
//    moving, the page's own image is laid over the 3D page as an ordinary
//    <img> at the browser's native resolution, which renders text as crisply
//    as any other image on the web. The instant anything moves it is pulled
//    and the real, foldable 3D page is back. The reader never sees the swap —
//    it is the same picture in the same place — they just see sharp text.
// -----------------------------------------------------------------------

const readingZoomFactor = 1.8; // how much closer than the whole-spread fit
let readingZoomed = false;

function readingFitDistance() {
  return readingCameraPos.z - readingTarget.z;
}

// side: -1 the left-hand page, 1 the right-hand page.
function setReadingZoom(on, side = 1) {
  if (!readingState) return;
  readingZoomed = on;
  const single = readingState.built.single;
  const sideSign = single ? 1 : side;
  const fit = readingFitDistance();
  const distance = on ? fit / readingZoomFactor : fit;
  const x = on ? readingPosition.x + sideSign * (0.01 + pageWidth / 2) : readingCameraPos.x;
  const duration = T(0.45);
  gsap.to(camera.position, { x, y: readingPosition.y, z: readingTarget.z + distance, duration, ease: "power2.inOut", overwrite: "auto", onUpdate: invalidate });
  gsap.to(controls.target, { x, y: readingPosition.y, z: readingTarget.z, duration, ease: "power2.inOut", overwrite: "auto", onUpdate: invalidate });
  // panning is what makes being zoomed in useful: a one-finger drag still
  // turns the page, so panning rides on right-drag and two fingers
  controls.enablePan = on;
  controls.screenSpacePanning = true;
  controls.minDistance = on ? 0.25 : 0.4;
  syncZoomButton();
  announce(on ? "Zoomed in. Drag with two fingers or the right mouse button to move around the page." : "Zoomed out to the whole page.");
}

const zoomToggle = document.getElementById("reading-zoom");
function syncZoomButton() {
  if (!zoomToggle) return;
  zoomToggle.setAttribute("aria-pressed", String(readingZoomed));
  zoomToggle.classList.toggle("on", readingZoomed);
  zoomToggle.title = readingZoomed ? "Fit the whole page (Z)" : "Zoom in to read (Z)";
}
if (zoomToggle) {
  zoomToggle.addEventListener("click", () => setReadingZoom(!readingZoomed, lastReadSide));
  syncZoomButton();
}

// Which half of the screen the reader last pointed at, so zooming goes to the
// page they were looking at rather than always the right-hand one.
let lastReadSide = 1;
renderer.domElement.addEventListener("dblclick", (event) => {
  if (!readingState || readingState.busy) return;
  lastReadSide = event.clientX < window.innerWidth / 2 ? -1 : 1;
  setReadingZoom(!readingZoomed, lastReadSide);
});

// ---- the crisp overlay

const sharpLayer = document.getElementById("sharp-pages");
const sharpLeft = document.getElementById("sharp-left");
const sharpRight = document.getElementById("sharp-right");
let sharpShown = false;
let sharpStillSince = 0;

const sharpProjected = new THREE.Vector3();
const sharpA = { x: 0, y: 0 };
const sharpB = { x: 0, y: 0 };

function projectToScreen(x, y, z, out) {
  sharpProjected.set(x, y, z).project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  out.x = rect.left + ((sharpProjected.x + 1) / 2) * rect.width;
  out.y = rect.top + ((1 - sharpProjected.y) / 2) * rect.height;
  return out;
}

// The pages are flat and square-on to the camera, so projecting two opposite
// corners gives the exact rectangle they cover on screen.
function placeSharpPage(img, page, xFrom, xTo) {
  if (!img) return;
  if (!page || !page.image) {
    img.style.display = "none";
    return;
  }
  if (img.dataset.src !== page.image) {
    img.dataset.src = page.image;
    img.src = page.image;
  }
  const z = readingPosition.z;
  projectToScreen(readingPosition.x + xFrom, readingPosition.y + pageHeight / 2, z, sharpA);
  projectToScreen(readingPosition.x + xTo, readingPosition.y - pageHeight / 2, z, sharpB);
  img.style.display = "block";
  img.style.left = `${Math.min(sharpA.x, sharpB.x)}px`;
  img.style.top = `${Math.min(sharpA.y, sharpB.y)}px`;
  img.style.width = `${Math.abs(sharpB.x - sharpA.x)}px`;
  img.style.height = `${Math.abs(sharpB.y - sharpA.y)}px`;
}

// The two page images on show right now: the front of the leaf waiting to be
// turned, and the back of the one already turned onto the left-hand pile.
function currentSharpPages() {
  const state = readingState;
  const hinges = state.pageHinges;
  const index = state.currentIndex;
  const rightHinge = hinges[index];
  const right = rightHinge ? rightHinge.userData.rec.leaf.front : null;
  let left = null;
  if (!state.built.single && index > 0) {
    const leftHinge = hinges[index - 1];
    // index 0 shows the title page, which is drawn in code, not scanned
    left = leftHinge ? leftHinge.userData.rec.leaf.back : null;
  }
  return { left, right };
}

function hideSharpPages() {
  sharpStillSince = 0;
  if (!sharpShown) return;
  sharpShown = false;
  if (sharpLayer) sharpLayer.classList.remove("visible");
}

function updateSharpPages(now, animating, moved) {
  if (!sharpLayer) return;
  const steady = readingState && !readingState.busy && !bookDrag && !peekHinge && !animating;
  if (!steady) {
    hideSharpPages();
    return;
  }
  if (!sharpStillSince) sharpStillSince = now;
  if (now - sharpStillSince < 140) return; // let the page actually settle first
  if (sharpShown && !moved) return; // nothing has changed, nothing to reposition
  const { left, right } = currentSharpPages();
  placeSharpPage(sharpLeft, left, -0.01 - pageWidth, -0.01);
  placeSharpPage(sharpRight, right, 0.01, 0.01 + pageWidth);
  if (!sharpShown) {
    sharpShown = true;
    sharpLayer.classList.add("visible");
  }
}

// a page about to be grabbed should go back to being a real 3D page at once
renderer.domElement.addEventListener("pointerdown", hideSharpPages, { passive: true });
window.addEventListener("resize", hideSharpPages);

// -----------------------------------------------------------------------
// 11e. OPTIONAL PAGE-TURN SOUND
// Synthesised with the Web Audio API (no audio files to ship or load): a
// short, filtered burst of noise per page. Off by default — the reader opts
// in with the Sound button in the reading bar, and the choice is remembered.
// -----------------------------------------------------------------------

let soundOn = true; // on unless the reader switched it off before
try {
  soundOn = localStorage.getItem("shelf-sound") !== "off";
} catch {
  /* storage blocked — keep the default */
}
// browsers only allow audio after a click / key press, so unlock it on the first one
function unlockAudio() {
  window.removeEventListener("pointerdown", unlockAudio);
  window.removeEventListener("keydown", unlockAudio);
  if (soundOn) getAudio();
}
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);
let audioCtx = null;
let noiseBuffer = null;

function getAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
    noiseBuffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.25), audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

// One short burst of filtered noise, shaped on the fly. Everything the
// paper sounds are made of is this plus a different filter and envelope.
function noiseBurst(t, { dur, type, freq, freqEnd, q = 0.7, gain, attack = 0.01, rate = 1 }) {
  const ctx = audioCtx;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = rate;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t);
  if (freqEnd) filter.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// ---- Replaceable sound files ------------------------------------------
// Any mp3 dropped into src/assets/sounds/ (see the glob in section 3)
// takes over from the synthesised sound of the same name. Files are fetched
// and decoded once, on the first play, so an empty folder costs nothing and
// a visit that never makes a sound never downloads one.
const sampleBuffers = new Map(); // slot -> AudioBuffer, or null if it won't decode
const samplePending = new Map();

function loadSample(slot, url) {
  if (samplePending.has(slot)) return samplePending.get(slot);
  const job = fetch(url)
    .then((response) => response.arrayBuffer())
    .then((bytes) => audioCtx.decodeAudioData(bytes))
    .then((decoded) => {
      sampleBuffers.set(slot, decoded);
      return decoded;
    })
    .catch(() => {
      // a corrupt or unsupported file falls back to the synthesised sound
      // rather than leaving that moment silent for the rest of the visit
      sampleBuffers.set(slot, null);
      return null;
    });
  samplePending.set(slot, job);
  return job;
}

// Returns true when a replacement file has handled this sound, false to let
// the synthesised version play. The very first call for a slot starts the
// download and returns true: that one moment is silent, and every one after
// it is the real file. Playing the synth for that first moment and the file
// for the rest would be a worse trade, because the sound would audibly
// change character a second into the visit.
function playSample(slot, { when = 0, gain = 1, vary = 0 } = {}) {
  const url = assetByStem(soundModules, [slot]);
  if (!url) return false;
  const ctx = getAudio();
  if (!ctx) return false;
  const buffer = sampleBuffers.get(slot);
  if (buffer === undefined) {
    loadSample(slot, url);
    return true;
  }
  if (buffer === null) return false;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  // the synthesised sounds all vary slightly per play so repeats don't grate;
  // a sample gets the same treatment through a small playback-rate wobble
  if (vary) source.playbackRate.value = 1 + (Math.random() * 2 - 1) * vary;
  const level = ctx.createGain();
  level.gain.value = gain;
  source.connect(level).connect(ctx.destination);
  source.start(ctx.currentTime + when);
  return true;
}

// A page turn is two sounds: the airy "fwip" of the page cutting through the
// air, and a soft papery tick when it lands on the pile. A multi-page jump
// is ONE quick riffle of ticks, never a row of separate full sounds, and
// sounds closer together than ~90 ms are dropped so nothing can pile up.
let lastFlipSoundAt = 0;
function playFlipSound(count = 1) {
  if (!soundOn || reduceMotionQuery.matches) return;
  const ctx = getAudio();
  if (!ctx) return;
  const nowMs = performance.now();
  if (nowMs - lastFlipSoundAt < 90) return;
  lastFlipSoundAt = nowMs;
  // riffle.mp3 covers the multi-page jump if it exists; without one, a
  // supplied page-turn.mp3 stands in for both
  if (count > 1 && playSample("riffle", { vary: 0.04 })) return;
  if (playSample("page-turn", { vary: 0.06 })) return;
  const t = ctx.currentTime + 0.01;
  const v = 0.85 + Math.random() * 0.3; // no two turns sound identical
  if (count <= 1) {
    // the swish: breathy mid-high noise that brightens and dies away
    noiseBurst(t, { dur: 0.34, type: "bandpass", freq: 1800 * v, freqEnd: 4200 * v, q: 0.55, gain: 0.1 * v, attack: 0.07, rate: 0.9 + Math.random() * 0.2 });
    // a hint of low "body" so it is not just hiss
    noiseBurst(t, { dur: 0.3, type: "lowpass", freq: 700, freqEnd: 350, q: 0.5, gain: 0.05 * v, attack: 0.08 });
  } else {
    // riffle: a quick flutter of ticks, fading out
    const ticks = Math.min(count, 8);
    for (let k = 0; k < ticks; k++) {
      const tk = t + k * 0.035;
      const fade = 1 - (k / ticks) * 0.6;
      noiseBurst(tk, { dur: 0.05, type: "bandpass", freq: (2200 + Math.random() * 1800) * v, q: 0.9, gain: 0.06 * fade, attack: 0.004 });
    }
    noiseBurst(t, { dur: 0.3, type: "bandpass", freq: 2000, freqEnd: 4500, q: 0.5, gain: 0.05, attack: 0.08 });
  }
}

// The front cover swinging open. This used to borrow playFlipSound, which was
// harmless while every sound was synthesised — the swish of a cover and the
// swish of a page are much the same noise — but it meant that supplying a
// page-turn.mp3 made opening a book play the page-turn sound before a single
// page had turned. The cover now has its own "cover" slot, and with no file
// supplied it falls back to the synthesised swish rather than to page-turn.
function playCoverSwish() {
  if (!soundOn || reduceMotionQuery.matches) return;
  const ctx = getAudio();
  if (!ctx) return;
  if (playSample("cover", { vary: 0.05 })) return;
  const t = ctx.currentTime + 0.01;
  const v = 0.85 + Math.random() * 0.3;
  noiseBurst(t, { dur: 0.34, type: "bandpass", freq: 1800 * v, freqEnd: 4200 * v, q: 0.55, gain: 0.1 * v, attack: 0.07, rate: 0.9 + Math.random() * 0.2 });
  noiseBurst(t, { dur: 0.3, type: "lowpass", freq: 700, freqEnd: 350, q: 0.5, gain: 0.05 * v, attack: 0.08 });
}

// Hovering a book: a soft wooden/paper "tick" as it slides out of the shelf,
// slightly different each time. Throttled so sweeping across the row stays a
// pleasant ripple of ticks rather than a buzz.
let lastHoverSoundAt = 0;
function playHoverSound() {
  if (!soundOn || reduceMotionQuery.matches) return;
  if (!audioCtx || audioCtx.state !== "running") {
    if (!audioCtx) return; // not unlocked by a click yet
    audioCtx.resume();
  }
  const nowMs = performance.now();
  if (nowMs - lastHoverSoundAt < 70) return;
  lastHoverSoundAt = nowMs;
  if (playSample("hover", { vary: 0.08 })) return;
  const ctx = audioCtx;
  const t = ctx.currentTime + 0.005;
  const v = 0.9 + Math.random() * 0.25;
  noiseBurst(t, { dur: 0.05, type: "bandpass", freq: 1900 * v, q: 1.2, gain: 0.09, attack: 0.002 });
  noiseBurst(t, { dur: 0.09, type: "lowpass", freq: 520 * v, freqEnd: 260, q: 0.8, gain: 0.1, attack: 0.003 });
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.setValueAtTime(190 * v, t);
  osc.frequency.exponentialRampToValueAtTime(95, t + 0.07);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}

// The soft papery tick of a page settling onto the pile. This used to be baked
// into playFlipSound at a fixed 0.3 s after the swish, but a page turn lasts
// anywhere from about 0.2 s (a fast flick) to 0.6 s, so the tick landed at the
// wrong moment more often than not. animateFlip now fires it on the exact frame
// the page comes to rest instead.
function playPageLand() {
  if (!soundOn || reduceMotionQuery.matches) return;
  const ctx = getAudio();
  if (!ctx) return;
  if (playSample("page-land", { vary: 0.06 })) return;
  const t = ctx.currentTime + 0.005;
  const v = 0.85 + Math.random() * 0.3;
  noiseBurst(t, { dur: 0.06, type: "bandpass", freq: 2600 * v, q: 1.1, gain: 0.07 * v, attack: 0.004 });
  noiseBurst(t, { dur: 0.08, type: "lowpass", freq: 420, q: 0.6, gain: 0.06 * v, attack: 0.004 });
}

// the book cover shutting: one soft, dull "pup" (no hiss at all)
function playCloseSound(delaySeconds = 0) {
  if (!soundOn || reduceMotionQuery.matches) return;
  const ctx = getAudio();
  if (!ctx) return;
  if (playSample("close", { when: delaySeconds })) return;
  const t = ctx.currentTime + delaySeconds;
  noiseBurst(t, { dur: 0.16, type: "lowpass", freq: 900, freqEnd: 300, q: 0.7, gain: 0.12, attack: 0.006 });
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.setValueAtTime(110, t);
  osc.frequency.exponentialRampToValueAtTime(50, t + 0.14);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.1, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.2);
}

// a soft low "thup" when a book opens
function playThud() {
  if (!soundOn || reduceMotionQuery.matches) return;
  const ctx = getAudio();
  if (!ctx) return;
  if (playSample("open", { when: 0.3 })) return;
  const t = ctx.currentTime + 0.3;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(55, t + 0.15);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.22);
}

// A small message that slides up for a few seconds and leaves again.
const toastEl = document.getElementById("toast");
let toastTimer = 0;
function showToast(message, ms = 4500) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("visible"), ms);
}

const soundToggle = document.getElementById("sound-toggle");
function syncSoundToggle() {
  soundToggle.setAttribute("aria-pressed", String(soundOn));
  soundToggle.classList.toggle("off", !soundOn);
  soundToggle.title = soundOn ? "Sound on" : "Sound off";
}
soundToggle.addEventListener("click", () => {
  soundOn = !soundOn;
  try {
    localStorage.setItem("shelf-sound", soundOn ? "on" : "off");
  } catch {
    /* ignore */
  }
  syncSoundToggle();
  if (soundOn) playFlipSound(1);
});
syncSoundToggle();

// Sound is on out of the box, which is a surprise worth warning people about
// exactly once. Shown on the first visit only, and never if they have already
// turned it off.
function maybeAnnounceSound() {
  if (!soundOn) return;
  try {
    if (localStorage.getItem("shelf-sound-notice") === "seen") return;
    localStorage.setItem("shelf-sound-notice", "seen");
  } catch {
    return; // storage blocked: better to stay quiet than nag on every visit
  }
  setTimeout(() => showToast("Sound is on. Use the speaker button in a book to mute it."), 1400);
}

// -----------------------------------------------------------------------
// 11f. LOADING STATE
// The covers are the only images fetched up front. Until they've arrived
// the page shows a small loader; then the loader fades and the scene fades
// in, instead of the shelf popping in half-textured.
// -----------------------------------------------------------------------

let libraryReady = false;
function markLibraryReady() {
  if (libraryReady) return;
  libraryReady = true;
  invalidate(3);
  document.body.classList.add("ready");
  // replay the shelf settling now that it's actually visible
  dropShelfIntoPlace(activeShelf.group);
  dropBooksIntoPlace(activeShelf.shelfBooks);
  const loader = document.getElementById("loader");
  if (loader) {
    loader.classList.add("done");
    setTimeout(() => loader.remove(), 700);
  }
  dirtyShadows(4000); // the shelf and books are still settling into place
  maybeAnnounceSound();
  // Compile the open-book shaders now, while the reader is still getting their
  // bearings, rather than during the first book's opening swing.
  const whenIdle = window.requestIdleCallback || ((fn) => setTimeout(fn, 800));
  whenIdle(() => {
    const first = activeShelf.shelfBooks[0];
    if (first) warmOpenBookShaders(ensureOpenBookBuilt(first.userData.project, portraitQuery.matches));
  });
}
bookListReady = true;
syncBookList(true);
// never leave someone staring at a loader if an image is slow or missing
setTimeout(markLibraryReady, 5000);
if (coversPending === 0) markLibraryReady();

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
  invalidate(3);
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
  if (over === 0) return false;
  orbitSpherical.theta -= over * azimuthSpring;
  camera.position.copy(controls.target).add(orbitOffset.setFromSpherical(orbitSpherical));
  return true;
}

let lastRenderAt = 0;
function animate(now) {
  requestAnimationFrame(animate);
  processUploadQueue();
  const controlsMoved = controls.update();
  if (controlsMoved) invalidate();
  if (clampOrbitAzimuth()) invalidate();
  // any running tween (page turn, hover, shelf drop, camera move, delayed call) means the picture is changing
  const animating = gsap.globalTimeline.getChildren(false, true, true).length > 0;
  if (animating) invalidate();
  // has to run even on frames that don't render: standing still is exactly when
  // the crisp page overlay is wanted
  updateSharpPages(now, animating, controlsMoved);

  if (framesToRender <= 0 || document.hidden) {
    lastRenderAt = 0;
    return;
  }
  framesToRender--;
  renderer.shadowMap.needsUpdate = !readingState && (animating || now < shadowDirtyUntil);
  renderer.render(scene, camera);

  // adaptive resolution (see section 1a): only judge back-to-back frames
  if (lastRenderAt && now - lastRenderAt < 80) {
    frameTimeAvg = frameTimeAvg * 0.9 + (now - lastRenderAt) * 0.1;
    if (frameTimeAvg > 26 && pixelRatio > minPixelRatio) {
      slowStreak++;
      if (slowStreak > 20) {
        pixelRatio = Math.max(minPixelRatio, pixelRatio - 0.25);
        slowStreak = 0;
        frameTimeAvg = 16;
        applyPixelRatio();
      }
    } else {
      slowStreak = 0;
    }
  }
  lastRenderAt = now;
}

animate(performance.now());

// read-only handle for the performance checks in the case study / DevTools
