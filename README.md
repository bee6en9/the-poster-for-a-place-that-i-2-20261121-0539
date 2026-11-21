# Velmora — Isles Above the Clouds

![competition](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539.svg)
![rank](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/bee6en9/the-poster-for-a-place-that-i-2-20261121-0539/rank.svg)
![reward](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/bee6en9/the-poster-for-a-place-that-i-2-20261121-0539/reward.svg)

A travel poster for a place that isn't there, built for the [make.fun bounty](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539): **Velmora**, a chain of islands floating above a sea of clouds. One tall lighthouse stands on the main isle, its lamp lit at golden hour, while a waterfall spills off the island's edge into the clouds below and a small airship drifts past. Come for the light that never quite sets — stay for the quiet above the world.

## How it works

`main.ts` (Node 22, standard library only — no dependencies, no network) paints the poster pixel by pixel into an RGBA buffer — golden-hour sky, cloud sea, floating island, lighthouse, waterfall, airship — draws the name VELMORA large with a hand-built bitmap font, and encodes the result as a PNG by hand with `node:zlib`. The output is fully deterministic: same seed, same bytes, every run.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts
# out/entry.png — 1024x1024 PNG, under 1 MiB
```

Play code: `vfk2n47z` — https://make.fun/r/vfk2n47z
