# Room textures

Photographed, physically based texture sets for the arcade room's surfaces
(arcade/roomtextures.ts). Every one is **CC0** (public domain), so nothing is
owed and no credit is required, but the makers are named here anyway. The
files are the sources' own 1K JPGs, unchanged, except where noted.

| folder | source | made by | licence | fetched |
|---|---|---|---|---|
| `synthetic_wood/` | Poly Haven `synthetic_wood` — https://polyhaven.com/a/synthetic_wood (2000 mm) | Charlotte Baglioni (photography), Dario Barresi (processing) | CC0 — https://polyhaven.com/license | 2026-10-05 |
| `white_planks_clean/` | Poly Haven `white_planks_clean` — https://polyhaven.com/a/white_planks_clean (1800 mm) | Rob Tuytel | CC0 — https://polyhaven.com/license | 2026-10-05 |
| `white_stucco/` | Poly Haven `white_stucco` — https://polyhaven.com/a/white_stucco (1998 mm) | Amal Kumar | CC0 — https://polyhaven.com/license | 2026-10-05 |
| `Carpet016/` | ambientCG `Carpet016` — https://ambientcg.com/view?id=Carpet016 (no size given) | ambientCG (Lennart Demes) | CC0 — https://docs.ambientcg.com/license/ | 2026-10-05 |
| `Fabric026/` | ambientCG `Fabric026` — https://ambientcg.com/view?id=Fabric026 (no size given) | ambientCG (Lennart Demes) | CC0 — https://docs.ambientcg.com/license/ | 2026-10-05 |
| `Carpet005/` | ambientCG `Carpet005` — https://ambientcg.com/view?id=Carpet005 (no size given) | ambientCG (Lennart Demes) | CC0 — https://docs.ambientcg.com/license/ | 2026-10-05 |
| `Carpet006/` | ambientCG `Carpet006` — https://ambientcg.com/view?id=Carpet006 (no size given) | ambientCG (Lennart Demes) | CC0 — https://docs.ambientcg.com/license/ | 2026-10-05 |
| `Metal027/` | ambientCG `Metal027` — https://ambientcg.com/view?id=Metal027 (black powder-coated metal; no size given) | ambientCG (Lennart Demes) | CC0 — https://docs.ambientcg.com/license/ | 2026-10-06 |
| `black_oak_veneer/` | Poly Haven `black_oak_veneer` — https://polyhaven.com/a/black_oak_veneer (1000 mm; the default cabinet's skin, arcade/cabinet-default.ts) | Jenelle van Heerden | CC0 — https://polyhaven.com/license | 2026-10-07 |
| `wood_floor/` | Poly Haven `wood_floor` — https://polyhaven.com/a/wood_floor (1700 mm; the Polished boards floor) | Dimitrios Savva | CC0 — https://polyhaven.com/license | 2026-11-01 |
| `old_linoleum_flooring_01/` | Poly Haven `old_linoleum_flooring_01` — https://polyhaven.com/a/old_linoleum_flooring_01 (1990 mm; the Lino floor) | Charlotte Baglioni | CC0 — https://polyhaven.com/license | 2026-11-01 |
| `floor_tiles_06/` | Poly Haven `floor_tiles_06` — https://polyhaven.com/a/floor_tiles_06 (3000 mm; the Tile floor) | Rob Tuytel | CC0 — https://polyhaven.com/license | 2026-11-01 |
| `Wallpaper001A/` | ambientCG `Wallpaper001A` — https://ambientcg.com/view?id=Wallpaper001A (no size given) | ambientCG (Lennart Demes) | CC0 — https://docs.ambientcg.com/license/ | 2026-10-05 |
| `red_brick/` | Poly Haven `red_brick` — https://polyhaven.com/a/red_brick (stated 1400 mm; drawn at 1500 mm, see below) | Poly Haven (see the asset page) | CC0 — https://polyhaven.com/license | 2026-11-07 |
| `yellow_brick/` | Poly Haven `yellow_brick` — https://polyhaven.com/a/yellow_brick (stated 2000 mm; drawn at 1950 mm; the yellow stock brick) | Poly Haven (see the asset page) | CC0 — https://polyhaven.com/license | 2026-11-07 |
| `painted_brick/` | Poly Haven `painted_brick` — https://polyhaven.com/a/painted_brick (stated 1800 mm; drawn at 830 mm) | Poly Haven (see the asset page) | CC0 — https://polyhaven.com/license | 2026-11-07 |
| `wooden_panels/` | Poly Haven `wooden_panels` — https://polyhaven.com/a/wooden_panels (2100 mm; full-height panelling) | Poly Haven (see the asset page) | CC0 — https://polyhaven.com/license | 2026-11-07 |
| `glazed_tiles/`, `mirror_tiles/`, `laminate/`, `flock/` | drawn by `tools/room-assets.mjs` (no CC0 set exists for these; owner, 2026-11-07, "generate in code") | this repo | the repo's own | 2026-11-07 |
| `SurfaceImperfections003/` | ambientCG `SurfaceImperfections003` — https://ambientcg.com/view?id=SurfaceImperfections003 (its `Opacity` map only: wiped smears; the window glass's smudge, arcade/windowglass.ts) | ambientCG (Lennart Demes) | CC0 — https://docs.ambientcg.com/license/ | 2026-11-07 |
| `Bricks005/` | ambientCG `Bricks005` — https://ambientcg.com/view?id=Bricks005 (red brick, about 1.2 m a tile by its courses; its `Color` map only, at 512 px: the window opening's outside face, arcade/dressing.ts `VIEW_EXTERIOR`) | ambientCG (Lennart Demes) | CC0 — https://docs.ambientcg.com/license/ | 2026-11-07 |
| `Plaster001/` | ambientCG `Plaster001` — https://ambientcg.com/view?id=Plaster001 (outdoor render; its `Color` map only, at 512 px, as above) | ambientCG (Lennart Demes) | CC0 — https://docs.ambientcg.com/license/ | 2026-11-07 |

The Poly Haven maps used are `diff` (colour), `nor_gl` (OpenGL normal) and
`arm` (R ambient occlusion, G roughness, B metal). From ambientCG: `Color`,
`NormalGL` and `Roughness`, re-saved as JPEG at quality 85–88 to cut the
normal maps' size. `Carpet016` and `Fabric026`'s colour maps are also made
greyscale, so the room tints them to the host's carpet colour; `Fabric026`'s
(a red cord, so dark in grey, mean 0.26) is also auto-levelled and lifted
with gamma 2.6 to a mean of 0.66, or a tint could only darken it. `SurfaceImperfections003`'s opacity map is greyscale, auto-levelled and
resized to 256 × 256 (it modulates the glass's blur, so detail is wasted).
Those are the only changes. `beige_wall_002` (Poly Haven, 3000 mm) was the first plaster and
was replaced by `white_stucco` the same day: as an exterior render it read as
far too coarse indoors.

Found by searching both libraries' APIs (`api.polyhaven.com/assets?t=textures`,
`ambientcg.com/api/v2/full_json?type=Material&q=…`): panelling, plaster,
wallpaper and carpet. ambientCG's `WoodSiding` sets are outdoor boards (moss,
nails), so the panelling is Poly Haven's.

**The wall finishes (2026-11-07) are KTX2, not JPEG.** Each is 1024 px Basis
ETC1S with mipmaps, made by `tools/room-assets.mjs` (which also says how to
install its encoder), and loaded through three's `KTX2Loader` with the Basis
transcoder copied to `public/basis/`. Each image is stored flipped top to
bottom, because a KTX2 texture cannot be flipped on upload and the JPEGs are
(see the tool's header). `painted_brick`'s colour map is made grey and
lifted to a mean of 0.82, so the host's colour is the paint's.

**The brick sizes are measured, not Poly Haven's.** The brief asks for bricks
at about 21.5 x 6.5 cm. Each map's courses were counted from the period of
its AO map's row profile (autocorrelation): `red_brick` 20 a map,
`yellow_brick` 26, `painted_brick` 11. At a 75 mm course (65 mm brick, 10 mm
joint) that is 1.50, 1.95 and 0.83 m a map. The stated sizes agree for the
first two within a brick; `painted_brick`'s stated 1800 mm would draw its
bricks twice life size.

The drawn sets: 6-inch (152 mm) glazed wall tiles, 8 a map with 2 mm grout
and a cushion edge; 12-inch (300 mm) bevelled mirror tiles, 4 a map (each
tile's slight tilt is the material's, arcade/roomtextures.ts); a 4-foot
(1220 mm) melamine sheet; and a damask flock on a half-drop 530 mm repeat
(a roll's width), whose motif is drawn as an SVG in the tool.

