# BlueMap Live – Configuration

All BlueMap settings keep working as in BlueMap ([wiki](https://bluemap.bluecolored.de/wiki/)). This page lists what BlueMap Live adds.

## Server: `config/bluemap/plugin.conf`

The cost column is for the server. Drawing is always done by the browser of each viewer.

| Setting | Default | Range | What it does | Cost on the server |
|---|---|---|---|---|
| `live-player-markers` | `true` | | Sends the players to the map. Everything below needs it. | small |
| `live-player-update-interval` | `250` | 50–10000 ms | How often the players and entities are sampled and the map asks for them. Lower is smoother. | grows with the rate: 250 → 4 samples per second |
| `live-player-extended-data` | `true` | | Body rotation, velocity, movement states, held items, armor, item use, riding, health. `false`: only name, position and rotation, like BlueMap. | small |
| `hidden-game-modes` | `["spectator"]` | | (BlueMap) Players in these game modes are not shown, and neither is their surrounding. | |
| `live-entities` | `true` | | Items, projectiles, mobs and vehicles around the shown players. | grows with the number of entities |
| `live-entities-radius` | `30` | 0–128 blocks | Radius around each shown player. | grows with the area (radius²) |
| `live-entities-limit` | `200` | 0–1000 | Entities per map, the nearest first. | caps the response size |
| `live-entities-hidden-types` | `[]` | | Entity types that are never sent, e.g. `["minecraft:item", "minecraft:arrow"]`. | |
| `live-block-updates` | `true` | | Changed regions are rendered again after `live-block-update-cooldown`, the map reloads the tiles without a page reload. | renders more often |
| `live-block-preview` | `true` | | Changed blocks are shown at once as a preview until the tile is rendered again (a preview without a render within 90 s is discarded). Needs `live-block-updates`. | a hook on every block change, the work is done once per tick |
| `live-block-preview-radius` | `96` | 0–256 blocks | Radius around the shown players for the previews. | |
| `live-block-update-cooldown` | `10` | seconds | A changed region is rendered again at the earliest after this time (BlueMap: 60). | |

`/bluemap live-stats` shows the measured cost of the last minute: block changes and entity samples on the server thread (and their share of it), the render threads, and the JSON requests of the webserver.

`metrics` in `core.conf` is `false` in BlueMap Live: no reports are sent to the metrics server of the original project unless you turn it on.

## Browser: the settings popup

Open it with the menu button and "Settings". The values are stored in the browser of each viewer.

| Tab | Setting | Default | What it does |
|---|---|---|---|
| View | Preset | Balanced | Performance / Balanced / Beautiful: sets resolution, render distances, frame rate limit, entity distance and particles together. |
| Live | Smoothing (delay) | 400 ms | The live data is played back this much later, so movements are smooth. Off shows the newest state at once. |
| Live | Limit frame rate | unlimited | Saves battery and CPU. |
| Entities | Entities around players | all the server sends | Shows only entities near a shown player. |
| Entities | Show entities up to | 300 blocks | Distance from the camera (50–1000). |
| Entities | Particles and effects | on | Explosions, potions, fire, smoke. |
| Entities | Instant block preview | on | The block previews (if the server sends them). |
| Entities | Filter entities | all on | Hostile mobs, animals, other mobs, items and projectiles, boats and minecarts. |
| Entities | Name tags / Health bars | on / off | Over players and named mobs / over players and mobs. |
| Live | Camera when following | Map | Map (like BlueMap), first person, over the shoulder. |
| Light & weather | Day/night cycle of the world | off | The map shows the time of the world. |
| Light & weather | Live weather | on | Sun, moon, stars, clouds, rain, snow and lightning; only with the day/night cycle of the world. |

## Webserver

The live data comes from BlueMap's own webserver (`webserver.conf`) at `maps/<map>/live/players.json`, `entities.json` and `tiles.json`. If you use an external webserver, forward these paths to the integrated one, as described in the BlueMap wiki for `players.json`.
