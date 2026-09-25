# `src/render/`

Everything that draws. A **subscriber**: it reads simulation state and the events
`src/sim/` emits, and paints them. It never writes back, and `src/sim/` never
imports from here — `eslint.config.js` and `tests/unit/sim-boundary.test.ts`
enforce that, which is what makes the headless tests and replays possible
(`docs/DESIGN.md` sections 5 and 9).

| File           | What it is                                                          |
| -------------- | ------------------------------------------------------------------- |
| `canvas.ts`    | The display: a 224×288 backbuffer presented at a whole-number scale |
| `sprites.ts`   | Pack sprite data → cached bitmaps, and the helpers that draw them   |
| `text.ts`      | The original 8×8 pixel font, and one cached strip per ink colour    |
| `starfield.ts` | The scrolling background, at the stage's scroll speed               |
| `scene.ts`     | Composes one frame out of the above                                 |

`crt.ts`, the optional scanline filter, is still to come. `scene.ts` draws the
playfield as flat shapes; the sprite set is now here for it to move onto.

## Two rules the whole directory follows

**Rasterise once.** A stage draws 40 aliens plus shots and effects at 60 fps
(`docs/DESIGN.md` section 11), so anything derived from pack data — sprite
frames, tinted font strips — is built when the pack loads and handed back by
reference afterwards. `SpriteSheet.bitmap` returns the _same_ object every call;
treat what comes back as read-only.

**No colours live here.** The palette is pack data (`docs/DESIGN.md` section 5:
saturated arcade colours on black, one global palette per pack). A sprite that
names a colour its pack never declared is a load-time error from
`createSpriteSheet`, not a black pixel nobody notices. HUD and screen text should
take its ink from the pack palette for the same reason.

## Testing without a browser

Both projects in `vitest.config.ts` run on Node, so there is no canvas in the
tests at all. That is why rasterising is split from drawing: pixels are a pure
function of pack data and can be asserted exactly, and the step that turns a
bitmap into something `drawImage` accepts is an injectable `SurfaceFactory` the
tests stub. Anything new here should keep that split.

## Looking at the art

    npm run sprite-sheet            # docs/media/classic-sprite-sheet.png

Renders a contact sheet of a pack's sprite set, palette and font _through the
real pipeline_, which is what `docs/DESIGN.md` section 11 asks a PR touching
visuals to attach.
