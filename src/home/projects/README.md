# Selected work

One folder here = one card on the home page. Add a folder, refresh, done.
Folders are ordered by name (numbers as numbers), so start the name with
1, 2, 3... to control the order. Keep it to 3 visible cards.

Each folder holds:

- `card.json` (all fields optional except `title`):

```json
{
  "role": "UX/UI Designer · School project · 2025",
  "title": "Project name",
  "problem": "What was broken, for whom, in one line.",
  "stats": [["27", "users surveyed"], ["3", "flows redesigned"], ["5/5", "preferred it"]],
  "finding": "The single strongest finding, ideally with a number.",
  "outcome": "Optional: what improved.",
  "tags": ["UX Research", "Prototyping", "Mobile"],
  "link": "library.html?book=Folder Name",
  "hidden": true
}
```

  - `tags`: only the first 3 are shown.
  - `stats`: up to 3 `[value, label]` pairs, shown as big numbers.
  - `link`: the process book. `library.html?book=<book folder name>` opens
    that book straight away. Leave it out and the card says "Process book in
    progress" instead of showing a button. `library.html` stays in the same
    tab; a full `https://...` URL opens a new one.
  - `prototype`: a Figma prototype link (Share > Copy prototype link, with
    access set to "Anyone with the link can view"). Adds a "Try prototype"
    button, and clicking the screens opens it in a popup on the page.
  - `hidden: true` keeps the card off the page (for unfinished projects).

- Screenshots: any png/jpg/jpeg/webp in the folder. Up to 3, in filename
  order (name them 1.png, 2.png, 3.png): entry screen, key screen (shown
  biggest, in the middle), result. Shown flat with nothing laid over them,
  so export them sharp (2x, same height).
