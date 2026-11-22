// Builds the "Selected work" list from src/home/projects/. One folder per
// card, and the folder needs nothing but:
//   card.json   role, title, problem, stats, finding, outcome, tags, link (see README.md)
//   images      any png/jpg/jpeg/webp; up to 3, in filename order, shown
//               flat side by side (the 2nd one is the big "key" screen)
// Drop in a new folder and it's appended below the others on the next
// refresh. Folders are ordered by name, numbers counted as numbers
// ("2 Foo" before "10 Bar"). "hidden": true keeps a card off the page.

const cardFiles = import.meta.glob("./projects/*/card.json", { eager: true, import: "default" });
const imageFiles = import.meta.glob("./projects/*/*.{png,jpg,jpeg,webp}", { eager: true, import: "default" });

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true });

// textContent only (never innerHTML), so card.json text can't inject markup.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Internal links ("library.html") stay in the tab; full URLs open a new one.
function link(className, href) {
  const a = el("a", className);
  a.href = href;
  if (/^https?:\/\//.test(href)) {
    a.target = "_blank";
    a.rel = "noopener";
  }
  return a;
}

// One shared popup for every card's Figma prototype. The iframe only loads
// when opened and is emptied on close, so nothing runs in the background.
// The prototype link must be shared as "Anyone with the link can view",
// or visitors see a Figma login wall instead.
let protoDialog;
function openPrototype(protoUrl, title) {
  if (!protoDialog) {
    protoDialog = el("dialog", "proto-dialog");
    const close = el("button", "icon-btn proto-close");
    close.type = "button";
    close.setAttribute("aria-label", "Close prototype");
    close.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    close.addEventListener("click", () => protoDialog.close());
    protoDialog.append(close, el("iframe"));
    protoDialog.addEventListener("close", () => protoDialog.querySelector("iframe").removeAttribute("src"));
    // a click on the dimmed backdrop (outside the frame) closes it too
    protoDialog.addEventListener("click", (e) => e.target === protoDialog && protoDialog.close());
    document.body.append(protoDialog);
  }
  // Figma's embed host (embed.figma.com) takes the same path as the share link.
  // theme matches the site so Figma's own bars aren't a white band; the area
  // around the screens is the prototype's background, set in Figma itself.
  const url = new URL(protoUrl);
  url.hostname = "embed.figma.com";
  url.searchParams.set("embed-host", "portfolio");
  url.searchParams.set("scaling", "scale-down"); // fit the whole phone in the frame
  url.searchParams.set("theme", document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const frame = protoDialog.querySelector("iframe");
  frame.title = `${title} prototype`;
  frame.allowFullscreen = true;
  frame.src = url.href;
  protoDialog.showModal();
}

function buildCard(folder, data) {
  const title = data.title ?? folder.split("/").pop();
  const screens = Object.keys(imageFiles)
    .filter((path) => path.startsWith(`${folder}/`))
    .sort(byName)
    .slice(0, 3)
    .map((path) => imageFiles[path]);

  const card = el("article", "project");
  const body = el("div", "project-body");
  if (data.role) body.append(el("p", "project-role", data.role));
  body.append(el("h3", "", title));
  if (data.problem) body.append(el("p", "project-problem", data.problem));
  if (data.stats?.length) {
    const stats = el("dl", "project-stats");
    data.stats.slice(0, 3).forEach(([value, label]) => {
      const stat = el("div");
      stat.append(el("dt", "", value), el("dd", "", label));
      stats.append(stat);
    });
    body.append(stats);
  }
  if (data.finding) body.append(el("p", "project-finding", data.finding));
  if (data.outcome) body.append(el("p", "project-outcome", data.outcome));
  if (data.tags?.length) body.append(el("p", "project-tags", data.tags.slice(0, 3).join(" • ")));

  // no process book yet = plain label, never a button that leads nowhere
  // a project still being worked on says so, right above its buttons
  if (data.status) body.append(el("p", "project-status", data.status));

  const actions = el("div", "project-actions");
  if (data.link) {
    const b = link("project-button", data.link);
    b.textContent = "View process book";
    actions.append(b);
  } else {
    actions.append(el("span", "project-soon", "Process book in progress"));
  }
  if (data.prototype) {
    const p = el("button", "project-button secondary", "Try prototype");
    p.type = "button";
    p.addEventListener("click", () => openPrototype(data.prototype, title));
    actions.append(p);
  }
  body.append(actions);

  // the screens open the prototype when there is one, else the process book
  let stage;
  if (data.prototype) {
    stage = el("button", "project-stage");
    stage.type = "button";
    stage.setAttribute("aria-label", `Try the ${title} prototype`);
    stage.addEventListener("click", () => openPrototype(data.prototype, title));
  } else if (data.link) {
    stage = link("project-stage", data.link);
    stage.setAttribute("aria-label", `${title} process book`);
  } else {
    stage = el("div", "project-stage");
  }
  screens.forEach((src, i) => {
    const img = el("img");
    img.src = src;
    img.alt = `${title} screen ${i + 1}`;
    img.loading = "lazy";
    stage.append(img);
  });

  // the screens and a one-line hint below them that they open the prototype
  const media = el("figure", "project-media");
  media.append(stage);
  if (data.prototype) {
    const verb = matchMedia("(hover: none)").matches ? "Tap" : "Click";
    media.append(el("figcaption", "project-caption", `${verb} the screens to try the Figma prototype`));
  }

  card.append(body, media);
  return card;
}

const projects = document.getElementById("projects");
Object.keys(cardFiles)
  .sort(byName)
  .filter((path) => !cardFiles[path].hidden)
  .forEach((path) => projects.append(buildCard(path.slice(0, path.lastIndexOf("/")), cardFiles[path])));
