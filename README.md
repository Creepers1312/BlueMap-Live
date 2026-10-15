# BlueMap Live

> **Dies ist ein Fork von [BlueMap](https://github.com/BlueMap-Minecraft/BlueMap)** (Branch `mc1.21.1`) mit dem Ziel,
> die originale BlueMap-Karte um **Live-Inhalte** zu ergänzen – ohne die Karte, ihre Texturen, den Webclient oder die Navigation zu ersetzen.

**Ziel:** Minecraft Java Edition **1.21.1** mit **Fabric**

- echte 3D-Spielermodelle mit Skin, Live-Position, Blickrichtung und Animationen (siehe auch [BlueMap#95](https://github.com/BlueMap-Minecraft/BlueMap/issues/95))
- Live-Blockänderungen ohne komplettes Neu-Rendern der Welt

### Stand

| Phase | Inhalt | Status |
|---|---|---|
| 1 | Analyse und Architektur | fertig – [`docs/bluemap-live/analysis.md`](docs/bluemap-live/analysis.md) |
| 2 | End-to-End-Prototyp: erweiterte Live-Spielerdaten + **vorläufiges** 3D-Objekt im Webclient | implementiert, teilweise getestet, **noch nicht mit Gradle gebaut und nicht auf einem echten Server geprüft** – [`docs/bluemap-live/phase-2.md`](docs/bluemap-live/phase-2.md) |
| 3 | Echte Spielermodelle mit Skin und Animationen | geplant |
| 4–5 | Live-Blockänderungen (zuverlässig, dann inkrementell) | geplant |
| 6 | Stabilisierung und Dokumentation | geplant |

Noch **nicht für den produktiven Einsatz** gedacht.

### Branches

- `mc1.21.1` – unveränderter Stand des Original-BlueMap-Branches (Basis)
- `bluemap-live` – Entwicklungsstand von BlueMap Live

Lizenz und Urheberschaft von BlueMap bleiben unverändert (MIT, siehe [LICENSE](LICENSE)).
Alles unterhalb dieser Linie ist die originale BlueMap-README.

---

[![title-banner](https://bluecolored.de/paste/BluemapBanner.png)](https://bluemap.bluecolored.de/)

<div align="center">

create **3D**-maps of your Minecraft worlds and display them in your browser  
**>> [DEMO MAP](https://bluecolored.de/bluemap) <<**


[![GitHub issues](https://img.shields.io/github/issues-raw/BlueMap-Minecraft/BlueMap)](https://github.com/orgs/BlueMap-Minecraft/projects/2)
[![GitHub all releases](https://img.shields.io/github/downloads/BlueMap-Minecraft/BlueMap/total)](https://github.com/BlueMap-Minecraft/BlueMap/releases)
[![GitHub release (latest by date)](https://img.shields.io/github/v/release/BlueMap-Minecraft/BlueMap)](https://github.com/BlueMap-Minecraft/BlueMap/releases/latest)
[![Discord](https://img.shields.io/discord/665868367416131594?label=discord)](https://discord.gg/zmkyJa3)

</div>

<br>
<br>

## What is BlueMap
BlueMap is a program that reads your Minecraft world files and generates not only a map, but also 3D-models of the whole surface.
With the web-app you then can look at those in your browser and basically view the world as if you were ingame! 
Or just look at it from far away to get an overview.

[![screenshot](https://bluecolored.de/paste/BlueMapScreenshot.jpg?2)](https://bluecolored.de/bluemap)

BlueMap comes as a Spigot/Paper or Sponge Plugin, as a Fabric or Forge-Mod and you can also use BlueMap without any Server
from the Command-Line as a standalone tool.

If installed as a Plugin/Mod, BlueMap **renders asynchronously** to your MinecraftServer-Thread. 
This means at no time it will block your server-thread directly. 
So as long as your CPU is not fully utilized, your server should not be slowed down while BlueMap is rendering.


## Using BlueMap
You can download BlueMap from [here](https://github.com/BlueMap-Minecraft/BlueMap/releases).  
Read the [installation instructions](https://bluemap.bluecolored.de/wiki/getting-started/Installation.html) to get started!

Here you can see how many servers are using BlueMap:

[![BlueMap Graph](https://metrics.bluecolored.de/bluemap/graph.php?1)](https://metrics.bluecolored.de/)

## Development
### Clone
If you have git installed, simply use the command `git clone --recursive https://github.com/BlueMap-Minecraft/BlueMap.git` to clone BlueMap.

### Build
In order to build BlueMap you simply need to run the `./gradlew release` command in BlueMap's root directory.
You can find the compiled JAR files in `./build/release`.

### Issues
You found a bug, have another issue?  
First, make sure it's not on your end, if you are unsure you can always ask about it in our [Discord](https://bluecolo.red/map-discord).  
If you are sure it's a bug on BlueMap's end, please create an issue [here](https://github.com/BlueMap-Minecraft/BlueMap/issues)!

### Contributing
You are welcome to contribute!
Just create a pull request with your changes :)

**If you want to have your changes merged, make sure they are complete, documented and well tested!**

Keep in mind that we have to maintain all new features and keep supporting them in the future.
This means we always can decide to not accept a PR for any reason.

## Links
**TODO-List:** https://github.com/orgs/BlueMap-Minecraft/projects/2  
**Wiki:** https://bluecolo.red/map-wiki  
**Discord:** https://bluecolo.red/map-discord  
**Reddit:** https://www.reddit.com/r/BlueMap  

---

[![JetBrainsLogo](https://bluemap.bluecolored.de/assets/jetbrains.svg)](https://www.jetbrains.com/?from=BlueMap)<br>
<br>
Special thanks to [JetBrains](https://www.jetbrains.com/?from=BlueMap) for giving out an OpenSource-Licence for BlueMap development!
