# Arrows

Drop a png in here to replace the arrows that switch between bookshelves.
The **file name** decides what it is used for:

| File name         | Used for                                          |
| ----------------- | ------------------------------------------------- |
| `arrow.png`       | both sides, mirrored on the left                  |
| `arrow-left.png`  | the left side only, used exactly as supplied      |
| `arrow-right.png` | the right side only, used exactly as supplied     |

One `arrow.png` is usually all you need. Use the left/right pair only if the
two arrows should not be mirror images of each other. `jpg`, `webp` and `svg`
work too, though png is the easiest to get a clean transparent edge from.

Each image drives **two** things: the arrow lying on the floor either side of
the cabinet, and the round button that replaces it on phones in portrait.

## Notes

- **Draw it pointing right.** The left arrow is this image flipped
  horizontally, so an arrow drawn pointing left comes out backwards.
- **Transparent background.** The floor arrow is a flat plane lying on the
  ground, so anything opaque reads as a rectangle of colour on the floor.
- **Roughly 2:1, landscape.** The floor plane is 0.85 x 0.5 units, so about
  860 x 500 px is a good size. Much larger is wasted detail at that angle,
  and the arrow is seen almost edge-on.
- **Keep it readable small.** On a phone the same art is squeezed into a
  44 px circle at 56% of its width, so fine outlines and thin strokes
  disappear. A solid, chunky shape survives both sizes.
- If this folder has no image in it, the code draws its own curved arrow,
  and the portrait buttons fall back to their ‹ › glyphs.
