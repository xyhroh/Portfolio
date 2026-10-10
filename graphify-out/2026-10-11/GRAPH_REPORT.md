# Graph Report - Bookshelf-Portfolio  (2026-09-25)

## Corpus Check
- 25 files · ~482,328 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: .css 2, (none) 1)

## Summary
- 242 nodes · 341 edges · 30 communities (10 shown, 20 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e52ce7d7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- main.js
- Lanyard.jsx
- onClick
- buildBookshelf
- refitCameraFraming
- buildProjectsForShelf
- ensureOpenBookBuilt
- Portfolio Bookshelf — Starter
- dependencies
- home.js
- CLAUDE.md
- lanyard/README.md
- projects/README.md
- animate
- createArrowMesh
- createWoodGrainTextures

## God Nodes (most connected - your core abstractions)
1. `onClick()` - 15 edges
2. `buildBookshelf()` - 14 edges
3. `Portfolio Bookshelf — Starter` - 10 edges
4. `navigateCarousel()` - 9 edges
5. `openBook()` - 9 edges
6. `onPointerMove()` - 9 edges
7. `refitCameraFraming()` - 8 edges
8. `ensureOpenBookBuilt()` - 7 edges
9. `jumpToIndex()` - 6 edges
10. `openPaperView()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `How the project is organized` --references--> `navigateCarousel()`  [INFERRED]
  README.md → src/main.js
- `How the pieces fit together` --references--> `createSpineTexture()`  [INFERRED]
  README.md → src/main.js
- `How the pieces fit together` --references--> `buildBookshelf()`  [INFERRED]
  README.md → src/main.js
- `How the pieces fit together` --references--> `navigateCarousel()`  [INFERRED]
  README.md → src/main.js
- `How the pieces fit together` --references--> `buildOpenBook()`  [INFERRED]
  README.md → src/main.js

## Import Cycles
- None detected.

## Communities (30 total, 20 thin omitted)

### Community 0 - "main.js"
Cohesion: 0.03
Nodes (70): activePointers, appEl, backWoodGrain, backWoodMaterial, bookOpenPivot, camera, carouselArrows, carouselGroup (+62 more)

### Community 1 - "Lanyard.jsx"
Cohesion: 0.06
Nodes (30): devDependencies, vite, name, private, scripts, build, dev, preview (+22 more)

### Community 2 - "onClick"
Cohesion: 0.16
Nodes (19): animateFlip(), createPagePlaceholderTexture(), enterReadingControls(), flipNext(), flipPrev(), jumpToIndex(), onClick(), onPointerUp() (+11 more)

### Community 3 - "buildBookshelf"
Cohesion: 0.13
Nodes (22): How the pieces fit together, How the project is organized, buildBookshelf(), closeDrawer(), openDrawer(), peekDrawer(), slideDrawerTo(), unpeekDrawer() (+14 more)

### Community 4 - "refitCameraFraming"
Cohesion: 0.18
Nodes (12): closeBook(), closePaperView(), exitReadingControls(), fitDistance(), getViewportSize(), handleViewportResize(), hoverTab(), refitCameraFraming() (+4 more)

### Community 5 - "buildProjectsForShelf"
Cohesion: 0.18
Nodes (13): applyCoverWrap(), slice(), buildInfoForShelf(), buildPapersForShelf(), buildProjectsForShelf(), coverForFolder(), leadingNumber(), naturalCompare() (+5 more)

### Community 6 - "ensureOpenBookBuilt"
Cohesion: 0.20
Nodes (9): applyLeafContent(), applyPageSide(), buildLeaves(), buildTabs(), createTabTexture(), createTitlePageTexture(), ensureOpenBookBuilt(), pullOut() (+1 more)

### Community 7 - "Portfolio Bookshelf — Starter"
Cohesion: 0.20
Nodes (9): Adding real pages (no code editing required), Deploying for grading, Editing the intro line, Editing the per-shelf blurb, Grouping pages into sticky tabs, Known simplifications (worth knowing about, not bugs), Portfolio Bookshelf — Starter, Running it (+1 more)

### Community 8 - "dependencies"
Cohesion: 0.22
Nodes (9): dependencies, gsap, meshline, react, react-dom, @react-three/drei, @react-three/fiber, @react-three/rapier (+1 more)

### Community 9 - "home.js"
Cohesion: 0.43
Nodes (6): buildCard(), cardFiles, el(), imageFiles, link(), projects

## Knowledge Gaps
- **110 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+105 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 141 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `three` connect `Lanyard.jsx` to `main.js`?**
  _High betweenness centrality (0.183) - this node is a cross-community bridge._
- **Why does `gsap` connect `Lanyard.jsx` to `main.js`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Why does `Portfolio Bookshelf — Starter` connect `Portfolio Bookshelf — Starter` to `buildBookshelf`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `buildBookshelf()` (e.g. with `How the pieces fit together` and `closeDrawer()`) actually correct?**
  _`buildBookshelf()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `navigateCarousel()` (e.g. with `How the pieces fit together` and `How the project is organized`) actually correct?**
  _`navigateCarousel()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _110 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.02666666666666667 - nodes in this community are weakly interconnected._