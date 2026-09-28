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
- `m2-capture-live.gif` — a capture in **live play** rather than from a replay:
  the dev build in a browser, the shipped three-fighter cabinet, stage 1, with
  bombs and bodies live. A Warden slides down and opens its beam, the beam takes
  the fighter and drags it up into the captive slot, the captured fighter parks
  at the top of the formation, and the **next fighter comes back and play carries
  on** — which is the part that was broken. Recorded unedited at 20 fps by
  grabbing the presenting canvas back down to the logical 224x288 playfield, so
  the pixels are the game's own. The companion to `m2-capture.gif`: that one is
  the golden, this one is the game.
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
- `m2-collision.gif` — the loss `enemies.collision` added: a diver flies into the
  fighter and the fighter is gone, three times over, ending in GAME OVER with the
  score still on zero — the pilot never fires, so the clip is also the evidence
  that a ram pays nothing. Played back from the committed `collision-game-over`
  golden replay through the real simulation and the real renderer, on the same
  bombs-off cabinet the golden records, so nothing on screen could have been a
  bomb. The opening 300 steps of entry choreography and the quiet stretch between
  the first and second fighter are fast-forwarded; what plays is the golden.
- `m2-attract.gif` — the front-end shell's attract mode: the two cards over the
  demo, which is the real game playing itself.
- `m2-game-over.gif` — a run ending into the game-over banner, the results screen
  and the high-score table, driven from a throwaway page that mounts the real
  flow and the real screens and drops the bombs the simulation could not yet
  drop. Enemy fire has landed since, so this one can now be recaptured from live
  play.
- `starfield-rate.gif` — the backdrop before and after it was made to match the
  reference: two 224x288 fields side by side over one timeline, stage 1, then
  stage 16, then a tractor beam, then the beam retracting. The **right** panel is
  the shipped `src/render/starfield.ts` driven exactly as `src/main.ts` drives it,
  including real `stage-started`, `capture-started` and `capture-failed` event
  values, so it is the game's own field; the left is `main`'s, and both panels are
  handed the same star positions and colours so the only difference on screen is
  the motion. Recorded from a throwaway harness rather than from play because the
  subject is the backdrop and a playfield would be in front of it. The rate
  doubles, the right-hand field moves in whole pixels, and only the right-hand one
  reverses under the beam. At `fps=20` rather than the usual 10: the dithering is
  a per-frame stutter and ten frames a second throws it away.
- `arch-gameplay.gif` — the clip `docs/ARCHITECTURE.md` opens with: one
  untouched run of stage 1 from the first frame through the entry waves, the
  sway, the hand-over to the breathe, and then auto-fire and a sweep against the
  settled formation.
- `arch-front-end.gif` — the whole front-end loop in one take, from live play:
  attract mode, start, a real game lost to three bombs, the game-over banner, the
  results card with its hit ratio, and back to attract.
- `build-stamp.png` — the build stamp on the attract screen of a dev build: the
  date and `<commit>DEV` in the top-right of the HUD band, and the same identity
  spelled out with its century under the "push start" prompt.
- `build-update-notice.png` — the same screen on a _hosted_ build after the site
  was re-published under it: `NEW BUILD` blinking in place of the commit, and
  `NEW BUILD - REFRESH` in place of the identity line. Captured by building
  `dist/`, serving it from a static server under a subpath, opening it, building
  again and letting the page's own poll find the difference — which is the hosted
  update path end to end rather than a mock of it.
- `m3-variants.gif` — the start-up selector and the settings menu: the two games
  this build offers with the cursor moving between them, Star Swarm chosen into
  attract, the settings card opened with **Esc**, the difficulty preset taken up
  through the ranks (the note under the list changing with it), the volume taken
  down, and then the `GAME` row moved across to the demonstration variant and a
  game started on it. One unedited take from live play; nothing is scripted but
  the key presses.
- `arch-lab.gif` — the `/lab` previewer: an entry path playing, then scrubbed
  frame by frame with the readout following, then the same path mirrored, then a
  dive path flown from the slot marker.

The two build-stamp stills are ordinary screenshots of the dev build at a
viewport 576 pixels tall, so the canvas takes a 2x scale, cropped to the
playfield's own 448x576 with `sips -c 576 448`. No scaling filter is involved, so
the pixels are the renderer's.

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
playfield clip. Milestone 4 owns turning all of this into a command, and what
that command would be — and what it would deliberately not do — is planned in
[`docs/ROADMAP.md`](../ROADMAP.md#capturing-gameplay-video).

**Note for anyone running the dev server in two checkouts at once.** Vite's
default port is shared, and `playwright.config.ts` reuses an existing server
outside CI — so a second worktree silently tests the first one's build. Set
`STAR_SWARM_PORT` to give it its own.
