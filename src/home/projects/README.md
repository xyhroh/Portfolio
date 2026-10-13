# Featured projects

One folder here = one card on the home page. Add a folder, refresh, done.
Folders are ordered by name (numbers as numbers), so start the name with
1, 2, 3... to control the order. A new folder goes at the bottom.

Each folder holds:

- `card.json` — the text (all fields optional except `title`):

```json
{
  "title": "Project name",
  "status": "In Progress",
  "tags": ["Mobile App", "UX Research"],
  "description": "One or two sentences.",
  "feedback": { "label": "Key user feedback:", "text": "The grey callout box." },
  "stats": [
    { "value": "16", "label": "survey respondents" }
  ],
  "button": { "label": "Read case study →", "link": "library.html" },
  "imageLink": "https://example.com"
}
```

- `image.png` — the right-hand picture (jpg/jpeg/webp also work). Missing =
  the soft gradient placeholder.

Links: `library.html` (or any file next to it) stays in the same tab; a full
`https://...` URL opens a new tab. The image links to `button.link` unless
you set `imageLink`. Leave out `button` for a card with no button.
