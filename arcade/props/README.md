# Room props

3D models the host can stand in their arcade (arcade/proplist.ts,
arcade/proplayer.ts). Every one is **CC0** (public domain) from Poly Haven:
nothing is owed and no credit is required, but the makers are named here.
Real-world size, as Poly Haven states it (`api.polyhaven.com/info/<id>`
`dimensions`, mm), is kept: the models are not scaled.

| file | source | made by | size (mm, w × d × h) | licence | fetched |
|---|---|---|---|---|---|
| `bar_chair_round_01.glb` | https://polyhaven.com/a/bar_chair_round_01 | Dairon Sanchez | 483 × 486 × 751 | CC0 | 2026-10-06 |
| `metal_stool_01.glb` | https://polyhaven.com/a/metal_stool_01 | Ulan Cabanilla | 352 × 355 × 883 | CC0 | 2026-10-06 |
| `potted_plant_01.glb` | https://polyhaven.com/a/potted_plant_01 | Rico Cilliers | 589 × 637 × 1351 | CC0 | 2026-10-06 |
| `potted_plant_02.glb` | https://polyhaven.com/a/potted_plant_02 | Rico Cilliers | 701 × 657 × 841 | CC0 | 2026-10-06 |
| `standing_chalkboard_01.glb` | https://polyhaven.com/a/standing_chalkboard_01 | ParzivalCG | 920 × 759 × 1509 | CC0 | 2026-10-06 |
| `trashcan_cylindric.glb` | Quaternius "Trashcan" via Poly Pizza — https://poly.pizza/m/vlVx279xut (CC0) | Quaternius | as made 750 × 750 × 1074; stood at 380 × 380 × 600 (ASSUMED indoor size) | CC0 | 2026-10-06 |
| `WetFloorSign_01.glb` | https://polyhaven.com/a/WetFloorSign_01 | Fran Calvente | 300 × 359 × 630 | CC0 | 2026-10-06 |
| `sofa_02.glb` | https://polyhaven.com/a/sofa_02 | Kirill Sannikov | 1807 × 818 × 709 | CC0 | 2026-10-09 |
| `Ottoman_01.glb` | https://polyhaven.com/a/Ottoman_01 | Caspian Fortune | 885 × 621 × 624 | CC0 | 2026-10-27 |
| `round_wooden_table_01.glb` | https://polyhaven.com/a/round_wooden_table_01 | Ulan Cabanilla | 1399 × 1399 × 1005 | CC0 | 2026-10-27 |
| `modern_arm_chair_01.glb` | https://polyhaven.com/a/modern_arm_chair_01 | Vibrant Nordic | 820 × 987 × 1023 | CC0 | 2026-10-27 |
| `painted_wooden_bench.glb` | https://polyhaven.com/a/painted_wooden_bench | Kirill Sannikov | 1165 × 497 × 889 | CC0 | 2026-10-27 |
| `coffee_table_round_01.glb` | https://polyhaven.com/a/coffee_table_round_01 | Ulan Cabanilla | 1301 × 1301 × 491 | CC0 | 2026-10-27 |

Licence: CC0 (Poly Haven, https://polyhaven.com/license; Quaternius, CC0 per
Poly Pizza's listing).

**This table is what lets a model ship.** arcade/test/build.test.ts fails a
public build carrying any model file not named here with a CC0 licence (the
lent cabinet models are not licensed for public use: owner, 2026-09-26; the
owner chose this rule over keeping props dev-only, 2026-10-06). A model
added without its row here fails that test.

The bin is Quaternius's as downloaded (one bare mesh, no texture
coordinates); arcade/proplayer.ts wraps coordinates round it and dresses it
in ambientCG `Metal027` (arcade/textures/). Searched for a bin: Poly Haven
(only a rusty outdoor dustbin), Sketchfab's CC0 filter (none; "Trash Can -
CC0 Game Asset" there is in fact CC BY-SA), Poly Pizza (Quaternius, used).

Each is Poly Haven's 1K glTF packed into one GLB by glTF-Transform 4.5.1:

```
npx @gltf-transform/cli@4 optimize <id>.gltf <id>.glb --compress false \
  --texture-compress webp --texture-size 512 --simplify true \
  --simplify-ratio 0.75 --simplify-error 0.001   # 0.2 for the two plants
```

That means textures at 512 px in WebP, and meshes simplified where the
simplifier could (the plants' leaves are separate pieces and stay ~55k
triangles each). The plan to search: Poly Haven's model API for stools, bins,
plants, signs and change machines. Its bin (`metal_trash_can`) is a rusty
outdoor dustbin and its extinguisher is Korean-labelled, so neither is used.
No CC0 change machine was found (Poly Haven, Sketchfab's CC0 filter); the
CC-BY ones on Sketchfab are on hold (owner, 2026-10-06).

The sofa (owner, 2026-10-09: seating for public use, easy to clean, robust)
is the one of Poly Haven's three sofas without loose cushions: `sofa_02`, a
tufted dark leather two-seater on a hardwood frame. `sofa_03` (Victorian,
2.7 m, fringed cushions) was shown to the owner and ruled out; `Sofa_01` is
a wooden settee. Packed as above, it is 117 KB.

Five more pieces of furniture (owner, 2026-10-27: "make the arcade room
richer"), all from the Poly Haven list read on 2026-10-09 and in the same
spirit as the sofa: a dark leather ottoman, a 1 m tall round wooden poser
table to go with the bar stools, a leather armchair, a painted wooden bench
and a low round coffee table. Fetched and packed as above on 2026-10-27
(glTF-Transform 4.5.1, every one at simplify error 0.001): 148, 232, 271, 80
and 161 KB.

**No jukebox.** One was built in code on 2026-10-27 and taken out the same
day (owner: it looked "drawn by a 6 year old"; "take the jukebox prop out
for now"). No CC0 model of one exists (searched 2026-10-09: Poly Haven's
whole model list, Sketchfab's CC0 filter, Poly Pizza; again 2026-10-27).
The one lead is Sketchfab's "Wurlitzer Jukebox 412" by Osho, CC BY 4.0,
which the owner has not cleared (CC-BY models are on hold).

**The cigarette machine is built in code** (arcade/proplayer.ts
`cigMachineObject`), like the poster, because no CC0 model of one exists.
Searched 2026-10-09: Poly Haven's whole model list (no vending machine,
dispenser, kiosk or machine of any kind); Sketchfab's API, downloadable
models, for "cigarette vending machine", "cigarette machine" (CC0 filter),
"vintage vending machine" (CC0 filter) and "cigarette dispenser", all
empty; Poly Pizza, only low-poly modern drinks machines, CC-BY. Its body is
the room's `black_oak_veneer` tinted walnut; the rest is plain colours. It
carries no real brand: the marks on a real one are trademarks. The packs in
its windows (owner, 2026-10-27: period-style branding) are drawn in canvas
by arcade/proplayer.ts (`PACK_BRANDS`): invented names and invented
artwork in the manner of 1970s-90s UK packets, each name checked by hand
against the brands of that period so none is a real one or a lookalike, and
no health warning, real or parodied.
