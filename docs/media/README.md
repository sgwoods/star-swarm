# `docs/media/`

Generated pictures for PR descriptions and the quality bar's "every PR touching
visuals includes a clip or a contact sheet" (`docs/DESIGN.md` section 11).

Nothing here is hand-made, and nothing here is an input to the game — regenerate
rather than edit:

    npm run sprite-sheet     # classic-sprite-sheet.png

The clips are screen recordings of the dev build. `m2-entry-waves.gif` is one
unedited run of stage 1 with the controls untouched until the formation settles:
the five entry waves, the sway, the hand-over to the breathe, and then a few
seconds of play. It was captured by driving `npm run dev` with Playwright's
`recordVideo` at 448×576 and reducing the result:

    ffmpeg -i page.webm -vf "fps=10,scale=224:288:flags=neighbor,\
      split[s0][s1];[s0]palettegen=max_colors=16[p];[s1][p]paletteuse=dither=none" out.gif

`flags=neighbor` and `dither=none` are the two that matter: anything else
resamples or dithers the pixel art and the sprites stop being sprites. Milestone
4 owns turning this into a command (`docs/DESIGN.md` section 10).

**Note for anyone running the dev server in two checkouts at once.** Vite's
default port is shared, and `playwright.config.ts` reuses an existing server
outside CI — so a second worktree silently tests the first one's build. Set
`STAR_SWARM_PORT` to give it its own.
