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
| `Wallpaper001A/` | ambientCG `Wallpaper001A` — https://ambientcg.com/view?id=Wallpaper001A (no size given) | ambientCG (Lennart Demes) | CC0 — https://docs.ambientcg.com/license/ | 2026-10-05 |

The Poly Haven maps used are `diff` (colour), `nor_gl` (OpenGL normal) and
`arm` (R ambient occlusion, G roughness, B metal). From ambientCG: `Color`,
`NormalGL` and `Roughness`, re-saved as JPEG at quality 85–88 to cut the
normal maps' size. `Carpet016` and `Fabric026`'s colour maps are also made
greyscale, so the room tints them to the host's carpet colour; `Fabric026`'s
(a red cord, so dark in grey, mean 0.26) is also auto-levelled and lifted
with gamma 2.6 to a mean of 0.66, or a tint could only darken it. Those are the
only changes. `beige_wall_002` (Poly Haven, 3000 mm) was the first plaster and
was replaced by `white_stucco` the same day: as an exterior render it read as
far too coarse indoors.

Found by searching both libraries' APIs (`api.polyhaven.com/assets?t=textures`,
`ambientcg.com/api/v2/full_json?type=Material&q=…`): panelling, plaster,
wallpaper and carpet. ambientCG's `WoodSiding` sets are outdoor boards (moss,
nails), so the panelling is Poly Haven's.
