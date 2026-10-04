<!-- doc:layer ideas -->

# Star Swarm — expansion ideas

> **Nothing on this page is planned, promised, or built.** It is a holding pen for
> directions the architecture leaves open, written down so they are not
> rediscovered from scratch and not mistaken for commitments. An idea that
> acquires an order and an exit check stops being an idea and moves to
> [`docs/ROADMAP.md`](ROADMAP.md); one that gets built is described in
> [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) and nowhere else.
>
> If you are reading this to find out what the game does, you are on the wrong
> page. Try [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).

---

## More content, no engine change

These need nothing under `src/` and are the cheapest things on the page. They are
ideas rather than roadmap items only because nobody has asked for them.

- **A sibling game in the same arcade lineage.** The content model is a platform,
  not this game's private format
  ([`docs/DESIGN.md`](DESIGN.md#6-configuration-system) section 6), so another
  formation shooter of the era would be another directory under `packs/` — its own
  manifest, its own `rules.json`, its own aliens, paths, stages, sprites and
  sounds, and no capture channel unless it wants one.
  [`docs/ARCHITECTURE.md`](ARCHITECTURE.md#44-where-a-second-game-plugs-in) sets
  out where that boundary runs today.
- **"Classic + Weird"** — the plan's own example of a pack that layers over
  Classic and inserts strange stages every fifth level rather than replacing the
  sequence.
- **Themed forged packs** as a recurring request: deep sea, insects, orbital
  debris. This is Milestone 4's proof repeated, so it is not really an expansion
  at all — it is the point.

## Modes and hardware

- **Boss stages.** `kind: "boss"` is a stage kind the schema already admits and no
  pack writes — [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) counts both, because a
  count is a claim about the code and this page makes none.
  What a boss stage _is_ has never been specified: a single large multi-part
  enemy, a formation with a leader, or something else.
- **Two-player alternating play**, as the cabinet had it. Two runs, two score
  registers, one field at a time. The front-end flow would grow a phase and the
  high-score table a second entry; nothing in the simulation would change, since a
  world already belongs to a run rather than to the program.
- **Gamepad support**, through the existing abstract input: a second device
  filling the same `InputFrame` the keyboard fills, which is the seam attract
  mode already uses.
- **Mobile touch controls.** Harder than it looks, and honestly: a rail shooter
  whose whole feel is a 1-and-2-pixel alternating step does not obviously survive
  a thumb.
- **A desktop wrapper** (Tauri or Electron), listed in the plan's section 12 as an
  alternative to the browser rather than a successor to it.

## Reach

- **An in-game Forge box** that calls the Claude API directly from the running
  game, behind the same validator gate as `/forge`. Deferred in the plan past
  Milestone 4 because it needs API-key handling, and that is still the blocker
  rather than the pipeline.

## Engine directions nobody has needed yet

- **A content hot-reload path in `/lab`**, so editing a JSON document redraws
  without a page load.
- **Replay sharing.** A golden replay is a seed plus an input log, so a run is
  already a short file. Somebody could trade them.
