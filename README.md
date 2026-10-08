<h1 align="center">
  <img src="docs/brick.png" alt="" width="64" align="absmiddle" hspace="8" />
  HoloBricks
</h1>

<p align="center"><b>Tell Holo what you'd like to build, watch it come together brick by brick, then order the real parts and build it yourself.</b></p>

![HoloBricks showing the Paris diorama](docs/holobricks.jpg)

<table align="center">
  <tr>
    <td align="center"><img src="docs/gallery/paris.png" width="180" alt="" /><br />Paris · 2,135</td>
    <td align="center"><img src="docs/gallery/london.png" width="180" alt="" /><br />London · 1,534</td>
    <td align="center"><img src="docs/gallery/bag-end.png" width="180" alt="" /><br />Bag End · 7,329</td>
    <td align="center"><img src="docs/gallery/hogwarts.png" width="180" alt="" /><br />Hogwarts · 45,073</td>
  </tr>
</table>

## What you can do

|                       |                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Describe**          | Type an idea or drop in a photo, and Holo builds it in 3D while you watch.                                                                         |
| **Trust**             | Every brick is a real LDraw part, checked to make sure it fits and connects.                                                                       |
| **Replay**            | Scrub back through the steps, or share the build as a GIF.                                                                                         |
| **Tweak**             | Move, turn, recolor and replace pieces, or walk through the model.                                                                                 |
| **Build it for real** | Get the instructions as a PDF, an official parts store list, or BrickLink carts through [HoloTab](SHOPPING.md). |
| **Share**             | Publish a build so anyone can open it, and builders can remix it into their own.                                                                   |

## How it works

```
 you ── idea ──▶  Holo  (H Agents API)  ── bricks run ──▶  Workstation
  ▲                 │                                         │
  └── 3D model ◀────┴─────────────── model.json.gz ◀──────────┘
```

Your browser renders every revision and shows it to Holo, so keep the tab open while it builds.

## Run it

Anyone can browse and open the public builds and showcases, no account needed. Anyone can sign in, with Google or an email, to build with Holo. Setup, deploy, tests and the toolkit's checks are in [docs/README.md](docs/README.md).

## Run it yourself

You need Node 24, Python with [uv](https://docs.astral.sh/uv/), a free [Rebrickable](https://rebrickable.com/api/) API key, a [Vercel Blob](https://vercel.com/docs/vercel-blob) store, and an H account from [platform.hcompany.ai](https://platform.hcompany.ai): signing in mints the Agents API key Holo builds with.

```bash
git clone https://github.com/hcompai/brickyard && cd brickyard
scripts/fetch-ldraw.sh                                # the LDraw parts library (145 MB)
(cd server && uv sync && REBRICKABLE_API_KEY=... .venv/bin/brickyard-catalog)   # the parts catalog
server/.venv/bin/python scripts/pack-toolkit.py       # the toolkit the app sends Holo
cd web && npm install
printf 'BRICKYARD_SECRET=%s\nBLOB_READ_WRITE_TOKEN=...\n' "$(openssl rand -hex 32)" > .env.local
npm run dev
```

Open http://127.0.0.1:5173 and sign in with your H account. `sh setup.sh` installs the toolkit's `bricks` command on your own machine, as Holo does on its workstation.
