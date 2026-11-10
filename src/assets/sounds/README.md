# Sounds

Drop an mp3 in here to replace one of the built-in sounds. The **file name**
decides which moment it plays at, so the name has to match this list exactly
(the extension does not matter, and `.wav`, `.ogg` and `.m4a` work too):

| File name       | Plays when                                      |
| --------------- | ----------------------------------------------- |
| `page-turn.mp3` | a single page turns                             |
| `riffle.mp3`    | several pages jump at once                      |
| `page-land.mp3` | the page settles onto the pile                  |
| `hover.mp3`     | a book slides out of the shelf                  |
| `cover.mp3`     | the front cover swings open                     |
| `open.mp3`      | a book opens (the low thump under the cover)    |
| `close.mp3`     | the cover shuts                                 |

Anything you leave out keeps the sound the code generates for itself, so you
can replace one sound or all six. A name that is not on the list is ignored.

## Notes

- **Keep them short.** These fire often. Under about 400 ms for `page-turn`,
  `page-land` and `hover`; up to about a second for `open` and `close`.
  A long file does not get cut off, it just overlaps the next one.
- **Trim the silence** off the front. The sounds are timed to land on a
  specific frame of the animation, and leading silence shows up as lag.
- **Normalise, don't maximise.** The built-in sounds sit at roughly a tenth
  of full scale, so a file mastered loud will be jarring next to the rest.
- `riffle.mp3` is optional. Without it, a multi-page jump uses
  `page-turn.mp3` if you supplied one, otherwise the generated riffle.
- **Opening a book never plays `page-turn.mp3`.** Opening makes two sounds:
  the cover swinging (`cover.mp3`) and a low thump under it (`open.mp3`).
  Supply neither and both stay synthesised. To have the cover make no sound
  at all, drop in a `cover.mp3` that is silent.
- The first time a sound is needed the file is downloaded, so that one
  moment is silent and every one after it plays. Nothing is downloaded at
  all until the visitor's first click or keypress, and nothing is
  downloaded if this folder is empty.
- The Sound button in the reading bar still switches everything off, and
  all sounds stay off for anyone browsing with reduced motion turned on.
