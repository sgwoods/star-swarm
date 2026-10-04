# `src/render/`

Everything that draws. A **subscriber**: it reads simulation state and the events
`src/sim/` emits, and paints them. It never writes back, and `src/sim/` never
imports from here — `eslint.config.js` and `tests/unit/sim-boundary.test.ts`
enforce that, which is what makes the headless tests and replays possible
(`docs/DESIGN.md` sections 5 and 9).

| File           | What it is                                                           |
| -------------- | -------------------------------------------------------------------- |
| `canvas.ts`    | The display: a 224×288 backbuffer presented at a whole-number scale  |
| `sprites.ts`   | Pack sprite data → cached bitmaps, and the helpers that draw them    |
| `text.ts`      | The original 8×8 pixel font, and one cached strip per ink colour     |
| `starfield.ts` | The scrolling background: the ROM's accumulator, reverse and twinkle |
| `effects.ts`   | One-shot animations an event plays — a fighter's death above all     |
| `scene.ts`     | Composes one frame out of the above                                  |
| `crt.ts`       | The optional scanline filter, drawn over the presented image         |

`scene.ts` draws from the rasterised sheet when it is given one and falls back to flat shapes when it
is not, which is what lets a test — or a build before the pack has loaded — draw
a frame with no art at all.

That fallback is for **no sheet**, and nothing else. A sheet that is present and
does not hold an enemy's sprite is a sheet built from a different variant than the
world being drawn — an enemy's sprite id is its own pack's and `loadPack` has
already proved it resolves — so `scene.ts` throws `SceneSheetMismatchError` there
rather than drawing a placeholder. The two conditions shared one branch once, and
the whole Deep Sea fleet drew as squares behind the ambiguity.

## Three rules the whole directory follows

**Rasterise once.** A stage draws 40 aliens plus shots and effects at 60 fps
(`docs/DESIGN.md` section 11), so anything derived from pack data — sprite
frames, tinted font strips — is built when the pack loads and handed back by
reference afterwards. `SpriteSheet.bitmap` returns the _same_ object every call;
treat what comes back as read-only.

**An event plays it, and the pack chose it.** `effects.ts` subscribes to
simulation events exactly as `src/audio/sfx.ts` does and looks each name up in
the manifest's `effects` map, so what a death looks like is a sprite id and an
offset in `packs/<name>/pack.json` — not drawing code here. The animation's
length is its sprite's own `frames` × `frameDuration`, counted in **simulation
steps**, so it plays once, ends by construction, and freezes with the rest of the
screen when the flow stops stepping the world.

**No colours live here.** The palette is pack data (`docs/DESIGN.md` section 5:
saturated arcade colours on black, one global palette per pack). A sprite that
names a colour its pack never declared is a load-time error from
`createSpriteSheet`, not a black pixel nobody notices. HUD and screen text should
take its ink from the pack palette for the same reason.

## The CRT filter sits after the blit

`crt.ts` is the player's `CRT` setting, off by default, and it is the one thing
here that draws in **device pixels** rather than on the backbuffer. A 224×288
surface has nowhere to put a scanline — at 1x a logical row is one pixel, and
darkening it erases a row of the font — and a barrel warp resamples, which puts
sprite edges between device pixels: the blur the whole-number scale exists to
prevent. So `canvas.ts` takes a `ScreenFilter` and draws it over the scaled image
inside `present()`, and with none set `present()` is the bare blit and nothing
else. `tests/e2e/crt.spec.ts` measures that on the real canvas, pixel for pixel.

The filter only darkens, as black with an alpha, so no pixel moves and no colour
lives in it. The scanline is a band at the bottom of every **logical** row, its
period the scale, so the 8×8 font is striped evenly; at 1x there is none. The
curvature is the glass rather than the picture: a vignette that is zero over the
middle of the screen, and corners rounded three logical pixels in. The overlay is
a pure function of the layout, rasterised once per layout like everything else
here.

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
