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
  if (data.link) {
    const b = link("project-button", data.link);
    b.textContent = "View process book";
    body.append(b);
  } else {
    body.append(el("span", "project-soon", "Process book in progress"));
  }

  const stage = data.link ? link("project-stage", data.link) : el("div", "project-stage");
  if (data.link) stage.setAttribute("aria-label", `${title} process book`);
  screens.forEach((src, i) => {
    const img = el("img");
    img.src = src;
    img.alt = `${title} screen ${i + 1}`;
    img.loading = "lazy";
    stage.append(img);
  });

  card.append(body, stage);
  return card;
}

const projects = document.getElementById("projects");
Object.keys(cardFiles)
  .sort(byName)
  .filter((path) => !cardFiles[path].hidden)
  .forEach((path) => projects.append(buildCard(path.slice(0, path.lastIndexOf("/")), cardFiles[path])));
