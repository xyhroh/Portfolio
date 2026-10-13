// Builds the "Featured projects" list from src/home/projects/. One folder per
// card, and the folder needs nothing but:
//   card.json   the text, stats and links (see src/home/projects/README.md)
//   image.png   optional right-hand picture (jpg/jpeg/webp work too)
// Drop in a new folder and it's appended below the others on the next
// refresh — no code changes. Folders are ordered by name, numbers counted
// as numbers ("2 Foo" before "10 Bar"), so prefix with 1, 2, 3 to control order.

const cardFiles = import.meta.glob("./projects/*/card.json", { eager: true, import: "default" });
const imageFiles = import.meta.glob("./projects/*/image.{png,jpg,jpeg,webp}", { eager: true, import: "default" });

// textContent only (never innerHTML), so card.json text can't inject markup.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Internal links ("library.html") stay in the tab; full URLs open a new one.
function link(tag, className, href) {
  const a = el(tag, className);
  a.href = href;
  if (/^https?:\/\//.test(href)) {
    a.target = "_blank";
    a.rel = "noopener";
  }
  return a;
}

function buildCard(folder, data) {
  const imageSrc = Object.entries(imageFiles).find(([path]) => path.startsWith(`${folder}/`))?.[1];
  const buttonHref = data.button?.link;
  const imageHref = data.imageLink ?? buttonHref;

  const card = el("article", "project");
  const body = el("div", "project-body");
  if (data.status || data.tags?.length) {
    const meta = el("div", "project-meta");
    if (data.status) meta.append(el("span", "project-status", data.status));
    data.tags?.forEach((t) => meta.append(el("span", "project-tag", t)));
    body.append(meta);
  }
  body.append(el("h3", "", data.title ?? folder.split("/").pop()));
  if (data.description) body.append(el("p", "project-desc", data.description));

  if (data.feedback) {
    const box = el("div", "project-feedback");
    box.append(el("strong", "", data.feedback.label ?? "Key user feedback:"), el("p", "", data.feedback.text));
    body.append(box);
  }

  if (data.stats?.length) {
    const stats = el("div", "project-stats");
    data.stats.forEach((s) => {
      const item = el("div");
      item.append(el("strong", "", s.value), el("span", "", s.label));
      stats.append(item);
    });
    body.append(stats);
  }

  if (data.button) {
    const b = link("a", "project-button", buttonHref ?? "#");
    b.textContent = data.button.label ?? "Read case study →";
    body.append(b);
  }

  // clickable when it has somewhere to go, a plain panel otherwise
  const panel = imageHref ? link("a", "project-image", imageHref) : el("div", "project-image");
  if (imageSrc) {
    const img = el("img");
    img.src = imageSrc;
    img.alt = data.title ?? "";
    panel.append(img);
  }

  card.append(body, panel);
  return card;
}

const projects = document.getElementById("projects");
Object.keys(cardFiles)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .forEach((path) => {
    const folder = path.slice(0, path.lastIndexOf("/"));
    projects.append(buildCard(folder, cardFiles[path]));
  });
