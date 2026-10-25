# Window views

What the room's window looks out on (arcade/dressing.ts, chosen in Decorate
→ Walls → Window). Each is a slice of a CC0 Poly Haven panorama (its
"tonemapped" 8K JPG): about 110° across, centred a little above the horizon,
resized to 1024 × 384, darkened (`-modulate 72,105`) to suit a dim room.
Licence: CC0, https://polyhaven.com/license.

| file | source | made by | slice (centre x, px of 8192; up from the horizon) | fetched |
|---|---|---|---|---|
| `harbour.jpg` | https://polyhaven.com/a/golden_bay | Greg Zaal | 6600; 180 | 2026-10-06 |
| `square.jpg` | https://polyhaven.com/a/hansaplatz | Greg Zaal | 1400; 200 | 2026-10-06 |
| `oldtown.jpg` | https://polyhaven.com/a/vignaioli_night | Greg Zaal, Rico Cilliers | 4096; 200 | 2026-10-06 |

```
convert <id>_8k.jpg -crop 2600x975+<cx-1300>+<2048-487-up> +repage \
  -resize 1024x384 -modulate 72,105 -quality 82 <view>.jpg
```

They replace a night street drawn in code (`nightCanvas`), which the owner
found "a bit naff" (2026-10-06). Searched: Poly Haven's HDRIs tagged night
and urban; the seaside ones (blue_lagoon_night) show mostly pavement.
