# `docs/media/`

Generated pictures for PR descriptions and the quality bar's "every PR touching
visuals includes a clip or a contact sheet" (`docs/DESIGN.md` section 11).

Nothing here is hand-made, and nothing here is an input to the game — regenerate
rather than edit:

    npm run sprite-sheet     # classic-sprite-sheet.png

The clips are screen recordings of the dev build.

- `m2-entry-waves.gif` — one unedited run of stage 1 with the controls untouched
  until the formation settles: the five entry waves, the sway, the hand-over to
  the breathe, and then a few seconds of play.
- `m2-dives.gif` — the same stage from the settle on, with the game fighting
  back: dives peeling off and fanning outwards, bombs, divers leaving the bottom
  and homing back into their own slots, a warden turning blue on its first hit,
  and the last few enemies turning nasty. The controls are untouched for the
  first nineteen seconds, so the clip opens on the whole fleet.
- `m2-capture.gif` — the capture mechanic end to end: a captor loops out of the
  formation, slides down and opens its tractor beam; the beam takes the fighter
  and drags it up into the captor's own captive slot; the captured fighter then
  dives _with_ its captor, is freed when the captor is shot while they are both
  attacking, spins in and docks as a second ship. Played back from the committed
  `dual-fighter` golden replay through the real simulation and the real renderer,
  so the clip is the golden — fast-forwarded to the capture and cut at the dock.
- `m2-challenge.gif` — the first challenge stage played to a perfect and the
  between-stage card that follows it: forty enemies in five groups of eight
  flying scripted convoys and **leaving without attacking**, the fighter standing
  on the exact centre of its travel with the button held and never touching a
  direction, and then "PERFECT !" over "NUMBER OF HITS 40/40", "SPECIAL BONUS
  10000" and a score of exactly 19,000 — the quality bar's own number, on screen.
  The run is _started_ on stage 3 by a temporary `?stage=` override applied only
  for the recording and not committed, because reaching a challenge stage by
  playing means surviving stages 1 and 2 now that dives and bombs have landed,
  and that is several minutes of fighting the clip does not show anyway. What
  plays from there is the ordinary game.
- `m2-attract.gif` — the front-end shell's attract mode: the two cards over the
  demo, which is the real game playing itself.
- `m2-game-over.gif` — a run ending into the game-over banner, the results screen
  and the high-score table, driven from a throwaway page that mounts the real
  flow and the real screens and drops the bombs the simulation could not yet
  drop. Enemy fire has landed since, so this one can now be recaptured from live
  play.
- `arch-gameplay.gif` — the clip `docs/ARCHITECTURE.md` opens with: one
  untouched run of stage 1 from the first frame through the entry waves, the
  sway, the hand-over to the breathe, and then auto-fire and a sweep against the
  settled formation.
- `arch-front-end.gif` — the whole front-end loop in one take, from live play:
  attract mode, start, a real game lost to three bombs, the game-over banner, the
  results card with its hit ratio, and back to attract.
- `arch-lab.gif` — the `/lab` previewer: an entry path playing, then scrubbed
  frame by frame with the readout following, then the same path mirrored, then a
  dive path flown from the slot marker.

The playfield clips were captured by driving `npm run dev` with Playwright's
`recordVideo` at 448x576 — two whole-number scales, so the canvas fills the frame
with no letterbox — and reducing the result:

    ffmpeg -i page.webm -vf "fps=10,scale=224:288:flags=neighbor,\
      split[s0][s1];[s0]palettegen=max_colors=16[p];[s1][p]paletteuse=dither=none" out.gif

`flags=neighbor` and `dither=none` are the two that matter: anything else
resamples or dithers the pixel art and the sprites stop being sprites. The
front-end clips use `max_colors=64`, because the cards put text and plate
colours on screen that the playfield alone does not.

The two `/lab` clips are the exception, because the lab is a page rather than a
playfield: they are recorded at the page size and kept there, with no `scale`
filter (`path-lab.gif` at 760x572; `arch-lab.gif` at 900x660, a viewport big
enough for the preview canvas to take a 2x scale). `arch-lab.gif` uses `fps=8`
and `max_colors=32` to keep a frame that large down to roughly the size of a
playfield clip. Milestone 4 owns turning all of this into a command
(`docs/DESIGN.md` section 10).

**Note for anyone running the dev server in two checkouts at once.** Vite's
default port is shared, and `playwright.config.ts` reuses an existing server
outside CI — so a second worktree silently tests the first one's build. Set
`STAR_SWARM_PORT` to give it its own.
