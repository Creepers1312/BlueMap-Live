# Changelog

All versions of BlueMap Live. The detailed release notes (German) are in [docs/bluemap-live/releases](docs/bluemap-live/releases).

## 1.0.0 (not released yet)

The first stable version. It contains everything from 0.1 to 0.6. Only 0.1 and 0.3 were published as GitHub releases, so for many users this is the first release with these features.

- **Forge and NeoForge**: the live features are now also available for Forge and NeoForge (Minecraft 1.21.1), not only for Fabric. Both share the live code of the Fabric version. They are new in 1.0 and have not been tested in Minecraft yet.
- **Players walk straight**: the body follows the movement like in the game (the server-side body rotation lags behind, the map now computes it like the Minecraft client does for other players).
- **Faster map**: about a third less work per frame in the browser with many players and entities (median 22 ms → 14 ms per frame in a scene with 20 players, 180 entities and rain). Block previews are no longer rebuilt when a block changes more than once.
- **Chests**: a chest that was just placed and is opened no longer shows its closed lid as well.
- **Placed blocks stay on the map**: a preview disappeared after 90 s even if BlueMap had not rendered the tile yet (e.g. while the game was paused). It now stays until the tile is rendered.
- **Jar names** start with `bluemap-live-`, so they are not mixed up with the original BlueMap. The Fabric version refuses to start together with the original BlueMap instead of running both.
- Minecraft versions: 1.21 and 1.21.1 (newer versions are not supported).
- New README (English and German), a [configuration reference](docs/bluemap-live/configuration.md) and this changelog.

## 0.6.0-alpha

- Live weather in the world-time mode: sun, moon phases, stars, clouds, rain, snow, lightning.
- Following a player in first person or over the shoulder.
- Name tags of named mobs, health bars of mobs and players.
- Entity filter (hostile, animals, other mobs, items, vehicles).
- World clock with the weather in the control bar, LIVE indicator.
- Quality presets: Performance, Balanced, Beautiful.
- The settings in a popup with tabs.
- Block previews with the light of their surroundings; placed light sources light up the map at once.
- No flickering of block previews.
- All 28 languages of the map.

## 0.5.0-alpha

- Live block changes: placed, broken and exploded blocks appear within 1–2 seconds as a preview until BlueMap has rendered the tile again.
- Chests, trapped chests, double chests and ender chests open and close.
- Settings for the entity radius, entity distance, particles and the block preview.
- `/bluemap live-stats`.

## 0.4.0-alpha

- Explosions of creepers, TNT, ghast fireballs, wither skulls and end crystals.
- Potion swirls, splash rings and lingering clouds.
- Burning players, mobs, items and arrows; smoke when a mob disappears.

## 0.3.1-alpha

- Smooth movements over the internet (playback delay, adjustable).
- Less work in the browser (no animation outside the view, optional frame rate limit) and on the server (fewer textures in memory, compressed live data).

## 0.3.0-alpha

- Entities around the players: items on the ground, thrown items, arrows with predicted flight.
- All mobs of 1.21 except the ender dragon with vanilla models, textures and animations; armor, riding, boats, minecarts, leashes, horses.
- The day-night cycle of the world, dynamic lights from held light sources.
- Placeholders for creatures without a model.

## 0.1.0-alpha

- 3D player models with skin, animations and held items, for Fabric 1.21.1.
