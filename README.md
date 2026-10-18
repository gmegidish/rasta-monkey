# rasta-monkey

A web port of the iPhone game Rasta Monkey (Unity 2.5), rendered with Canvas 2D and planck.js physics.

Play: https://gmegidish.github.io/rasta-monkey/

## Layout

- `web/` — the game: `index.html`, engine (`src/engine`), ported game scripts (`src/scripts`) and exported assets (`data/`)
- `tools/` — exporters that turn the original Unity data files into `web/data`

## Run locally

```
python3 tools/serve.py   # http://127.0.0.1:8766/
```

`?scene=level3` (or `start`, `goal`, `end`) opens a scene directly.

Controls: hold the left mouse button on a side of the screen to move; hold Space (or the right button) for the second finger and release it to jump.
