# Window views

What the room's window looks out on (arcade/dressing.ts, chosen in Decorate
→ Walls → Window; the window's other choices, blinds, frosted glass and no
window, are drawn in code). Each is a slice of a CC0 Poly Haven panorama (its
"tonemapped" 8K JPG): 180° across and 45° above and below the horizon, the
horizon on the middle row, at the source's own 4096 × 2048 (23 px a degree:
a 1080p screen 1 m from the window shows it at about 18, so a 2048-wide slice,
as they were until 2026-11-07, was magnified and read as frosted glass), and
graded for night
(the panoramas' own HDR tonemap lights a facade like day): darks set
down and mids lowered (`-level 4%,100%,0.7`), the sodium-yellow cast
taken down (`-modulate 100,70`, red 0.95, blue 1.05). The room then shows
them at `VIEW_LEVEL` (arcade/windowview.ts), each at its own distance
(`VIEW_DISTANCE_M`, measured from its storeys). It is laid on a curved backdrop
behind the window by angle (arcade/windowview.ts), so it must stay
equirectangular: crop it, never warp it. Licence: CC0,
https://polyhaven.com/license.

| file | source | made by | slice centre (x, px of 8192) | fetched |
|---|---|---|---|---|
| `harbour.jpg` | https://polyhaven.com/a/golden_bay | Greg Zaal | 6600 | 2026-10-06, re-cut 2026-11-07, foreground cut out 2026-11-07 |
| `harbour-near.webp` | the same (its foreground, `tools/window-layer.mjs`) | Greg Zaal | 6600 | 2026-11-07 |
| `square.jpg` | https://polyhaven.com/a/hansaplatz | Greg Zaal | 1400 | 2026-10-06, re-cut 2026-11-07 |
| `oldtown.jpg` | https://polyhaven.com/a/vignaioli_night | Greg Zaal, Rico Cilliers | 4096 | 2026-10-06, re-cut 2026-11-07 |
| `carpark.jpg` | https://polyhaven.com/a/rooftop_night | Greg Zaal | 5300 | 2026-11-07 |

The source is `https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/<id>.jpg`
(8192 × 4096). The roll brings the slice's centre to the middle, so a slice
across the panorama's seam (harbour's) comes out whole:

```
convert <id>.jpg -roll +<4096-cx>+0 -crop 4096x2048+2048+1024 +repage \
  -level 4%,100%,0.7 -modulate 100,70 \
  -channel R -evaluate multiply 0.95 -channel B -evaluate multiply 1.05 +channel \
  -quality 82 <view>.jpg
```

## Foreground layers

A view whose near foreground stood a few metres from the camera has it cut
onto a layer of its own (`VIEW_LAYERS`, arcade/windowview.ts), drawn on its
own cylinder at its own distance in front of the backdrop, so it moves
against the far street as a near thing does (owner's window brief,
2026-11-07, §5). Only `harbour` has one: its railing and bench,
`harbour-near.webp` (the slice's rows from 1146 down, alpha where the
railing and the pavement are), at 3.5 m. `harbour.jpg` itself was then
rewritten with the rows under the cut filled (the water above it mirrored;
the pavement's tone, blurred along the row), so the layer slid by the
parallax uncovers no second railing. Both come from the graded slice by

```
node tools/window-layer.mjs arcade/views/harbour.jpg
```

run once on a fresh cut (running it on its own output would cut the
mirrored water); it prints the `topDeg` `VIEW_LAYERS` takes. The view is
labelled Waterfront (it is a marina, not a seafront); its id stays
`harbour`, which saved looks name.

## Through the glass

The room grades every view as seen through glass (`VIEW_CONTRAST`,
`VIEW_HAZE`, `VIEW_MIP_BIAS` in arcade/windowview.ts): contrast eased, a
little haze toward the glass's colour, a mip bias for a pixel or two of
softness. The files carry none of that.

Until 2026-11-07 they were 110° × 43° slices (1024 × 384) on the glass
itself, slid each frame to fake depth; that read as a poster.

They replace a night street drawn in code (`nightCanvas`), which the owner
found "a bit naff" (2026-10-06). Searched: Poly Haven's HDRIs tagged night
and urban; the seaside ones (blue_lagoon_night) show mostly pavement.
