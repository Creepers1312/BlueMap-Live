# BlueMap Live – Phase 3: Plan für echte Spielermodelle

Stand: 2026-10-15 · Branch `bluemap-live` · Voraussetzung: Phase 2 (`phase-2.md`)

Legende: **[geprüft]** = im Code bzw. in einer Quelle tatsächlich nachgesehen · **[Referenz]** = aus einer unabhängigen Implementierung übernommen, nicht gegen den dekompilierten Minecraft-1.21.1-Client geprüft · **[Annahme]** = noch zu verifizieren

---

## 1. Ausgangslage im Code

### 1.1 Webclient-Rendering **[geprüft]**

| Aspekt | Befund | Quelle |
|---|---|---|
| Szene für dynamische Objekte | `MapViewer.markers` (`MarkerSet` → `THREE.Scene`), gerendert **nach** der Karte, mit derselben Kamera, **ohne** vorheriges Leeren des Tiefenpuffers → korrekte Verdeckung durch Karte | `MapViewer.js` `render()` |
| Render-Frequenz | `renderLoop` läuft mit `requestAnimationFrame`, **rendert aber nur**, wenn `delta >= 50 ms` (≈ 20 fps) **oder** innerhalb 1 s nach `redraw()` (dann mit voller rAF-Rate) | `MapViewer.js` `renderLoop` |
| Frame-Hook | Vor jedem gerenderten Frame: `dispatchEvent(events, "bluemapRenderFrame", {delta})` | `MapViewer.js` `render()` |
| Event-Ziel | `BlueMapApp.events === mapViewer.events` (beides `rootElement`); `PlayerMarkerManager` bekommt dieses Objekt bereits | `BlueMapApp.js` Konstruktor, `initPlayerMarkerManager()` |
| Licht der Karte | Hires-Shader: `light = mix(blocklight, max(sunlight, blocklight), sunlightStrength)`, `color *= mix(ambientLight, 1, light/15)`; Uniforms in `mapViewer.data.uniforms` | `HiresFragmentShader.js`, `MapViewer.js` |
| Präzision | Karte wird um Vielfache von 10000 verschoben gerendert, Marker in Weltkoordinaten – bestehende Marker funktionieren so | `MapViewer.js` |
| three.js | Version **0.147** (`package.json`) | |
| Phase-2-Platzhalter | `PlayerMarker.model` (Group, geteilte `BoxGeometry`/`MeshBasicMaterial`), Interpolation über `animate()` (eigene rAF-Schleife pro Marker) | `PlayerMarker.js` |

### 1.2 Skins auf dem Server **[geprüft]**

- `PlayerSkinUpdater` (common) lädt beim Join über `SkinProvider` (API) den **vollen** Skin (`MojangSkinProvider`: Session-Server → `textures.SKIN.url`), erzeugt daraus nur ein Kopf-Icon (`PlayerIconFactory`) und schreibt es als `assets/playerheads/<uuid>.png` in **jede** Map-Storage. Drosselung: 1×/h pro Spieler.
- Das **Modell (classic/slim)** steht im selben Mojang-JSON (`textures.SKIN.metadata.model == "slim"`), wird aber **nicht ausgewertet**.
- API-Schnittstellen (Submodul `api` @ `ba63193`): `SkinProvider.load(UUID) → Optional<BufferedImage>`, `PlayerIconFactory.apply(UUID, BufferedImage)` – **kein** Modelltyp. Eine Änderung der API wäre ein Breaking Change für Addons → vermeiden.
- **Vorbestehender Fehler:** Die Option `skin-download` (`PluginConfig.skinDownload`) wird im Code **nirgends** ausgewertet; Skins werden immer geladen. Wird in Phase 3 mitbehoben (Skins nur laden, wenn aktiviert).
- Asset-Auslieferung: `MapStorageRequestHandler` mit `Cache-Control: max-age=86400` → Skin-URLs brauchen einen Versions-Parameter.

### 1.3 Standard-Skin ohne mitgelieferte Mojang-Dateien **[geprüft / Annahme]**

BlueMap rendert Spielerköpfe als Blöcke mit dem Modell `minecraft:entity/player_head` → Textur `entity/player/slim/steve` (`core/src/main/resourceExtensions/.../models/entity/player_head.json`). Diese Textur stammt aus dem vom Betreiber heruntergeladenen Client-Jar und landet über die Textur-Galerie in `maps/<id>/textures.json` (`BmMap`: `textureGallery.put(resourcePack.getTextures())`).
→ Der Webclient kann den Standard-Skin **aus der bereits geladenen `textures.json`** nehmen (`resourcePath == "minecraft:entity/player/slim/steve"`), ohne neue Dateien und ohne Mojang-Assets im Repo. **[Annahme: dass die Textur in jeder `textures.json` enthalten ist – zur Laufzeit prüfen; sonst Fallback auf den bisherigen Kopf-Marker ohne Modell.]**

---

## 2. Modellgeometrie und Texturzuordnung

### 2.1 Quellen

Die Werte entsprechen dem Vanilla-`PlayerEntityModel`/`BipedEntityModel` und wurden gegen **skinview3d 3.4.2** (MIT, `libs/model.js`, per `npm pack` nur gelesen, **nicht** als Abhängigkeit) abgeglichen **[Referenz]**. Ein Abgleich mit dem dekompilierten Client 1.21.1 war nicht möglich (`piston-meta.mojang.com` und `libraries.minecraft.net` blockiert; `minecraft.wiki` nicht auflösbar). → Visuelle Prüfung mit echten Skins ist Pflicht (Tests §6).

### 2.2 Teile (Einheit: Skin-Pixel; Minecraft-Modellraum, Kopf-Pivot = Hals)

| Teil | Box (B × H × T) | Pivot relativ zum Hals | UV Basis | UV Overlay | Overlay-Aufschlag |
|---|---|---|---|---|---|
| Kopf | 8 × 8 × 8 | (0, 0, 0), Box nach oben | (0, 0) | (32, 0) „Hut“ | +0,5 je Seite (9³) |
| Körper | 8 × 12 × 4 | (0, 0, 0), Box nach unten | (16, 16) | (16, 32) „Jacke“ | +0,25 |
| rechter Arm | 4 × 12 × 4 (slim: **3** × 12 × 4) | (−5, −2, 0) Schulter; Box-Offset x −1 (slim −0,5) | (40, 16) | (40, 32) | +0,25 |
| linker Arm | 4 × 12 × 4 (slim: **3** × 12 × 4) | (+5, −2, 0); Box-Offset x +1 (slim +0,5) | (32, 48) | (48, 48) | +0,25 |
| rechtes Bein | 4 × 12 × 4 | (−1,9, −12, 0) Hüfte | (0, 16) | (0, 32) | +0,25 |
| linkes Bein | 4 × 12 × 4 | (+1,9, −12, 0) | (16, 48) | (0, 48) | +0,25 |

- **Blickrichtung:** Modell schaut nach +Z; „rechts“ des Spielers liegt bei −X (passt zur Phase-2-Konvention Yaw 0 = +Z).
- **Maßstab:** Vanilla rendert Spieler mit Faktor 0,9375 → Gesamthöhe 32 px × 0,9375 / 16 = **1,875 Blöcke** **[Referenz]**. Umrechnung im Webclient: `1 px = 0,9375 / 16` Block; Füße auf Höhe 0 der Modell-Gruppe.
- **Box-UV-Layout** (für Box mit u, v, B, H, T): oben (u+T, v, B×T), unten (u+T+B, v, B×T), rechts (u, v+T, T×H), vorne (u+T, v+T, B×H), links (u+T+B, v+T, T×H), hinten (u+2T+B, v+T, B×H). Die Unterseite ist in Minecraft vertikal gespiegelt **[Referenz]**.
- **Legacy-Skins 64×32** (vor 1.8): keine eigenen Bereiche für linken Arm/linkes Bein und keine Overlays außer Hut. Werden **serverseitig** auf 64×64 normalisiert: rechter Arm/rechtes Bein werden gespiegelt in die linken Bereiche kopiert, Overlays bleiben transparent.
- **Transparenz:** Basisschicht deckend (Alpha ignorieren wie Vanilla), Overlay mit Alpha-Test (`alphaTest ≈ 0.5`), beidseitig. Keine Sortierungsprobleme, weil Alpha-Test statt Blending.

### 2.3 Wiederverwendung

- **Geometrie:** pro Variante (classic, slim) **einmal** erzeugt (Basis + Overlay je Teil, UVs vorberechnet) und von allen Spielern geteilt. Pro Spieler nur `Mesh`-Objekte und Pivot-`Group`s (Knochen).
- **Material/Textur:** pro **Skin-Version** einmal (`Texture` mit `NearestFilter`, ohne Mipmaps, `flipY` passend zum UV-Schema), referenzgezählt in einem `PlayerSkinCache`; freigegeben, wenn kein Spieler sie mehr nutzt. Basis- und Overlay-Material teilen sich die Textur.
- **Draw-Calls:** 12 Meshes pro Spieler (6 Teile × 2 Schichten). Für typische Spielerzahlen (≤ 50 sichtbar) unkritisch; Instancing wird erst bei messbarem Bedarf erwogen.

### 2.4 Beleuchtung

Gleiche Formel wie die Karte, damit Spieler in Höhlen/nachts nicht „leuchten“:
`brightness = mix(ambientLight, 1, mix(block, max(sky, block), sunlightStrength) / 15)`.
Umsetzung ohne eigenen Shader: `MeshBasicMaterial.color` pro Spieler-Material auf `brightness` setzen, vor dem Rendern im Frame-Hook (Werte aus `mapViewer.data.uniforms` + neue Felder `light.sky/block`). Keine Änderung an Karten-Shadern.

---

## 3. Animationsarchitektur

### 3.1 Trennung Datenrate ↔ Animationsrate

```
Server (Ticks)            HTTP-Poll (250 ms)            Browser (pro gerendertem Frame)
FabricPlayer.update  ──►  players.json  ──►  PlayerMarkerSet ──►  PlayerMarker.setTarget(sample)
                                                                       │
MapViewer.render() ── "bluemapRenderFrame"(delta) ──► PlayerMarkerManager.onFrame(delta, now)
                                                         └─► jeder sichtbare PlayerMarker.step(dt)
                                                               ├─ Position/Rotation interpolieren
                                                               ├─ PlayerAnimator.step(dt, motion, state)
                                                               └─ Knochen-Rotationen setzen
```

- **Ein** zentraler Frame-Hook statt einer `animate()`-rAF-Schleife pro Marker: Interpolation und Pose werden genau dann berechnet, wenn auch gerendert wird (kein Arbeiten für nicht gerenderte Frames, keine Drift zwischen Position und Gliedmaßen).
- **Interpolation:** wie in Phase 2 (`interpolationDuration`, Sprung bei Diskontinuität), aber im Frame-Hook statt per eigener rAF-Schleife.
- **Reset bei Diskontinuität** (neue Generation, Weltwechsel, `foreign`, erster Datensatz, > 64 Blöcke): Position sofort setzen **und** Animator zurücksetzen (Schrittphase, Glättungswerte), damit kein Lauf-Animationssprung oder „Nachschwingen“ entsteht.

### 3.2 `PlayerAnimator` (reine Funktion, ohne three.js, Node-testbar)

Eingaben pro Frame: `dt`, horizontale Geschwindigkeit (aus interpolierter Bewegung, sonst `velocity` vom Server), `state` (sneaking, sprinting, onGround, swimming, flying, fallFlying), Kopf-/Körper-Yaw, Pitch. Ausgabe: Rotationen für Kopf, Körper, Arme, Beine (+ Körperneigung/Absenkung beim Schleichen).

Formeln nach Vanilla-`BipedEntityModel.setAngles` **[Referenz, Konstanten aus dem Gedächtnis – vor Abschluss gegen dekompilierten Code prüfen]**:

| Animation | Datenbasis | Umsetzung |
|---|---|---|
| Idle | Zeit | Arme: Roll `cos(t·0.09)·0.05 + 0.05`, Pitch `sin(t·0.067)·0.05` (t in Ticks) |
| Gehen | Geschwindigkeit (Näherung aus Positionen) | `limbSpeed` → min(v·4/20, 1), geglättet (Faktor 0,4 pro Tick); `limbPos += limbSpeed` pro Tick; Beine `cos(limbPos·0.6662 [+π])·1.4·limbSpeed`, Arme `cos(limbPos·0.6662 [+π])·limbSpeed` |
| Sprinten | `state.sprinting` (Server) + Geschwindigkeit | ergibt sich aus höherer Geschwindigkeit; zusätzlich nichts nötig |
| Schleichen | `state.sneaking` | Körper-Pitch 0,5 rad, Arme +0,4, Beine nach hinten, Modell abgesenkt |
| Springen/Fallen | `state.onGround == false` + vertikale Geschwindigkeit | Beine/Arme mit reduzierter Amplitude; Vanilla hat keine eigene Sprungpose → nur Näherung |
| Schwimmen / Elytra | `state.swimming` / `state.fallFlying` | Körper horizontal (Pitch −90° + Blick) – Phase 3b, nach den Grundanimationen |
| Kopf vs. Körper | `rotation.yaw`, `bodyYaw`, `pitch` | wie Phase 2 |

Dokumentiert wird je Animation, ob sie auf Server-**Zustand** (sneaking, sprinting, onGround, swimming, fallFlying) oder auf **Näherung** (Geschwindigkeit aus Positionsdifferenzen, Sprungphase) beruht.

### 3.3 Flüssige Darstellung (Render-Frequenz)

- Ohne Interaktion rendert `MapViewer` mit ≈ 20 fps. Für flüssige Animation ruft der `PlayerMarkerManager` im Frame-Hook `mapViewer.redraw()` auf, **solange** mindestens ein Spieler **sichtbar und in Modell-Distanz** ist **und sich bewegt oder dreht** (Interpolation läuft, `limbSpeed > ε`). Stehende Spieler (nur Idle-Wippen) bleiben bei 20 fps – Idle ist so langsam, dass 20 fps reichen.
- Übergabe von `redraw`: `BlueMapApp.initPlayerMarkerManager()` reicht `this.mapViewer.redraw` an den Manager weiter (eine Zeile). Kein Umbau von `MapViewer`.
- **Grenze des Ansatzes:** `redraw()` lässt die **gesamte** Szene (Karte + Marker) mit voller Bildrate rendern – das ist die bestehende Architektur, ein separates Rendern nur der Marker-Szene würde einen Umbau von `MapViewer` erfordern (Tiefenpuffer der Karte müsste erhalten bleiben). GPU-Last steigt daher, solange sich Spieler im Bild bewegen. Gegenmaßnahmen: nur bei Bewegung, nur in Modell-Distanz, Option `live-player-animations` (aus = 20 fps, statische Pose).
- Optional, nur nach Messung: Obergrenze (z. B. 30 fps) – erfordert eine kleine Änderung in `MapViewer.renderLoop` und ist deshalb nicht Teil des ersten Schritts.

### 3.4 Kopf-Marker in Nähe

Der CSS-Kopfmarker liegt auf Kopfhöhe und verdeckt bei Nähe das 3D-Gesicht (Phase-2-Screenshot). Vorschlag: In Modell-Distanz Kopfbild ausblenden, Name oberhalb des Modells anzeigen; außerhalb wie bisher Kopf + Name. Reine CSS/Attribut-Steuerung über das bestehende `distance-data`.

---

## 4. Benötigte Datenfelder

| Feld (players.json, Protokoll 1, optional) | Quelle (Server) | Zweck |
|---|---|---|
| `skin.model` (`"classic"`/`"slim"`) | Mojang-Profil `metadata.model`; bei fremden `SkinProvider`n Heuristik (Pixel im Slim-Spaltenbereich transparent) | Modellvariante |
| `skin.version` (kurzer Hash des Skin-Bilds) | `PlayerSkinUpdater` | Cache-Busting der Skin-URL, Wechsel erkennen |
| `light.sky`, `light.block` | `FabricPlayer` (bereits erfasst, bisher nur für Filter) | Beleuchtung wie Karte |
| bereits vorhanden | `position`, `rotation`, `bodyYaw`, `velocity`, `state`, `generation`, `time`, `world` | Bewegung/Animation/Reset |
| optional später | `state.sleeping` (`isSleeping()` **[geprüft: Yarn-Name vorhanden]**), Schlagbewegung (`handSwinging`) **[Annahme]** | weitere Posen |

Neues Asset: `maps/<id>/assets/playerskins/<uuid>.png` (normalisiert 64×64), geschrieben vom `PlayerSkinUpdater` analog zu `playerheads`.
Alle neuen Felder sind optional; fehlen sie, nutzt der Client `classic`, Standard-Skin und volle Helligkeit. Das Protokoll bleibt 1.

---

## 5. Betroffene Quelldateien

**Server**

| Datei | Änderung |
|---|---|
| `common/.../plugin/skins/MojangSkinProvider.java` | zusätzlich Modelltyp aus `metadata.model` lesen (interne Methode, API unverändert) |
| `common/.../plugin/skins/PlayerSkinUpdater.java` | vollen Skin normalisieren (Legacy → 64×64), als `playerskins/<uuid>.png` schreiben; Modell + Version pro Spieler merken; `skin-download` respektieren |
| `common/.../plugin/skins/SkinUtil.java` (neu) | Legacy-Normalisierung, Slim-Heuristik, Hash (reine Funktionen, JUnit) |
| `common/.../live/LivePlayersJson.java`, `LivePlayerState` bzw. `Entry` | Felder `skin`, `light` |
| `common/.../live/LivePlayersDataSupplier.java` | Skin-Info vom `PlayerSkinUpdater` und Licht des Spielers übernehmen |
| `common/.../config/PluginConfig.java`, `plugin.conf` | `live-player-models` (Modell an/aus), `live-player-animations` |

**Webclient** (keine Änderung an `MapViewer`, `Map`, `TileManager`, Shadern)

| Datei | Änderung |
|---|---|
| `markers/player/PlayerModelGeometry.js` (neu) | Box-UV-Funktion, geteilte Geometrien classic/slim (pure Daten + three-`BufferGeometry`) |
| `markers/player/PlayerSkinCache.js` (neu) | Textur laden, Referenzzählung, Fallback (Standard-Skin aus `textures.json`, sonst kein Modell) |
| `markers/player/PlayerAnimator.js` (neu) | Animationsmathematik (ohne three.js) |
| `markers/player/PlayerModel.js` (neu) | Knochenhierarchie, wendet Animator-Ergebnis + Helligkeit an |
| `markers/PlayerMarker.js` | Platzhalter durch `PlayerModel` ersetzen; Interpolation in `step(dt)` statt `animate()` |
| `markers/PlayerMarkerManager.js` / `PlayerMarkerSet.js` | Frame-Hook `bluemapRenderFrame`, `redraw`-Callback, Skin-URL/Version weiterreichen |
| `markers/LivePlayerData.js` | `skin`, `light` parsen/validieren |
| `BlueMapApp.js` | `redraw`-Callback und Standard-Skin-Quelle an den Manager übergeben (wenige Zeilen) |
| `style.scss` (o. ä.) | Kopfbild in Modell-Distanz ausblenden |

---

## 6. Tests

**JUnit (common)**
- Legacy-Normalisierung: 64×32 → 64×64, linker Arm/Bein = gespiegelte rechte Bereiche (Pixelvergleich mit synthetischen Testbildern); 64×64 bleibt unverändert; ungültige Größen werden abgelehnt.
- Slim-Heuristik: synthetische classic-/slim-Skins; Mojang-Metadaten haben Vorrang.
- JSON: `skin`/`light` werden geschrieben bzw. weggelassen; alte Felder unverändert.
- `MojangSkinProvider`-Parsing mit gespeicherten Beispiel-JSONs (mit/ohne `metadata.model`), ohne Netzwerk.

**Node (Webclient, ohne three.js)**
- Box-UVs: für jede Fläche jedes Teils die erwarteten Pixelrechtecke (Tabelle §2.2), Unterseite gespiegelt.
- Geometrie-Maße classic vs. slim (Armbreite 4/3 px, Pivot-Offsets), Gesamthöhe 1,875.
- Animator: Ruhe ⇒ Gliedmaßen ≈ 0 (bis auf Idle-Amplitude ≤ 0,1 rad); Amplitude begrenzt; Phase stetig bei konstanter Geschwindigkeit; Schleichen setzt Körper-Pitch; **Reset bei Generationswechsel** setzt Phase/Glättung zurück; `dt`-Unabhängigkeit (10 × 10 ms ≈ 1 × 100 ms).
- Parser: fehlende/ungültige `skin`/`light`-Felder → Defaults.

**Browser-E2E (Erweiterung `docs/bluemap-live/e2e/`)**
- Test-Skin mit **eindeutig gefärbten Flächen** pro Teil/Seite (synthetisch erzeugt, keine Mojang-Assets): Kamera auf Vorder-/Rück-/Seitenansicht, Pixelfarbe an projizierten Flächenmittelpunkten prüfen → beweist UV-Zuordnung und Orientierung (inkl. links/rechts).
- classic vs. slim: Breite der Arme im Screenshot / Bounding-Box.
- Legacy-Skin, transparenter Overlay-Bereich, fehlender Skin (404) → Standard-Skin bzw. Kopf-Marker; Skinwechsel (neue `version`) → neue Textur, alte freigegeben.
- Animation: bei Bewegung ändern sich Bein-Rotationen periodisch, bei Stillstand nicht; bei Teleport kein Nachschwingen (Phase zurückgesetzt).
- Render-Frequenz: `redraw` wird nur bei Bewegung angefordert (Zähler), bei stehenden Spielern bleibt die Frame-Rate bei ≈ 20 fps.

**Performance**
- 1 / 20 / 100 Spieler im E2E-Server: Frame-Zeit (`performance.now()` um `render`), Anzahl Draw-Calls (`renderer.info.render.calls`), Geometrie-/Textur-Zähler (`renderer.info.memory`) – müssen bei mehr Spielern nur um Meshes/Texturen pro Skin wachsen, nicht pro Frame.
- Speicher: nach Disconnect aller Spieler gehen `renderer.info.memory.textures` auf den Ausgangswert zurück.
- Ergebnisse mit SwiftShader sind nur relativ aussagekräftig; echte GPU-Messung bleibt offen, bis eine Umgebung vorhanden ist.

**Regression**
- Pixelvergleich ohne Spieler (`regression-e2e.mjs`) gegen `mc1.21.1` – muss weiterhin 0 Abweichungen ergeben.
- Phase-2-E2E (`player-e2e.mjs`) muss weiter bestehen (angepasst an das echte Modell).
- Originaler Webclient gegen neues Format (Kompatibilität).
- `live-player-models: false` ⇒ Verhalten wie vor BlueMap Live (nur Kopf + Name).

---

## 7. Reihenfolge der Umsetzung

1. **Phase 2 abschließen:** CI (`spotlessCheck test` + Build) grün; manueller Test M1–M16 auf echtem Server (offen, braucht Umgebung).
2. Server: `SkinUtil` + Tests, `PlayerSkinUpdater` (playerskins, Modelltyp, Version, `skin-download`), JSON-Felder.
3. Webclient: `PlayerModelGeometry` + Node-Tests (UV), `PlayerSkinCache`, `PlayerModel` statisch (ohne Animation) → E2E mit Farbflächen-Skin.
4. Frame-Hook + Interpolation in `step(dt)`, `redraw`-Steuerung.
5. `PlayerAnimator` (Idle, Gehen, Sprinten, Schleichen, Springen) + Tests.
6. Licht, Kopf-Marker-Verhalten, Konfiguration, Performance-Messung, Regression.
7. Phase 3b: Schwimmen/Elytra/Schlafen nach Machbarkeit.

## 8. Risiken

| Risiko | Umgang |
|---|---|
| UV/Maße nur gegen Referenzimplementierung geprüft | Farbflächen-E2E + Sichtprüfung mit echten Skins; Abgleich mit dekompiliertem Client, sobald Netzwerkzugang besteht |
| Animationskonstanten aus dem Gedächtnis | als Referenz markiert; Abgleich mit `BipedEntityModel` vor Abschluss |
| `redraw()` erhöht GPU-Last | nur bei Bewegung + Distanz; Option zum Abschalten; Messung |
| Standard-Skin evtl. nicht in `textures.json` | Laufzeitprüfung; Fallback Kopf-Marker |
| Skins über externe Webserver/CDN (Cache) | Versions-Parameter in der URL |
| Body-Yaw auf dem Server ungenau | Fallback: Körper folgt Kopf mit Vanilla-ähnlicher Verzögerung (max. 50° Abweichung) im Client |
