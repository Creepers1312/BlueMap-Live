# BlueMap Live – Phase 6 (Release 0.3.0): Mobs

Stand: 2026-10-15 · Branch `bluemap-live` · Plan: `roadmap.md` (0.3.0-alpha)

> **Kurzfassung:**
> - **Implementiert:**
>   - Die häufigsten Mobs werden mit ihrem Vanilla-Modell und der Textur aus dem Resource-Pack gezeigt, mit Lauf- und Kopfanimation, roter Färbung bei Schaden und Umkippen beim Tod.
>   - Lebewesen ohne Modell in der Webapp erscheinen als Platzhalter (Hitbox und Name).
> - **Getestet:** siehe §6. Die Modelldaten prüft das CI gegen Minecraft 1.21 selbst.
> - **Nicht geprüft:** Minecraft (manuelle Prüfungen O1–O12 offen).

## 1. Umfang

| Gruppe | Mobs | Besonderheiten |
|---|---|---|
| Menschenähnliche | Zombie, Wüstenzombie, Ertrunkener, Skelett, Eiswanderer, Witherskelett, Zombiedorfbewohner, Piglin, Piglin-Barbar, Zombifizierter Piglin | gehaltene Items; Zombies mit nach vorn gestreckten Armen (beim Angriff höher); Skelette zielen beim Angriff mit dem Bogen; Ertrunkene heben beim Angriff den Dreizack; Piglins: Ohren, Armbrust, Bewundern von Gold |
| Vierbeiner | Kuh, Mooshroom (rot/braun), Schwein (mit Sattel), Schaf (Wollfarbe, geschoren) | Babys mit den Vanilla-Proportionen (größerer Kopf) |
| Einzelmodelle | Creeper (aufgeladen, Anschwellen), Spinne, Höhlenspinne (mit Augen), Huhn (Flügelschlag in der Luft), Enderman (Augen, offener Mund, Block tragen), Schleim (Größe), Dorfbewohner (Biom, Beruf, Stufe) | |

Alle anderen Lebewesen (außer Spielern und Rüstungsständern, ohne unsichtbare) erscheinen als **Platzhalter**: ein durchsichtiger Kasten in Hitbox-Größe mit einer Markierung vorn und dem Namen darüber.

## 2. Datenfluss

1. **Fabric** (`FabricMobs`, in der vorhandenen Entity-Abtastung, Spiel-Thread):
   - Für jedes Lebewesen werden ausschließlich Werte gelesen, die auch der Client bekommt:
     - Körper- und Kopfdrehung (`bodyYaw`, `getHeadYaw`)
     - `hurtTime`, `deathTime`, `isBaby`
     - Haupt- und Nebenhand, Linkshänder
     - Hitbox (`getWidth`/`getHeight`)
     - `isAttacking`
   - Je nach Art kommen dazu:
     - Schaf: Farbe, geschoren
     - Mooshroom: Variante
     - Schwein: Sattel
     - Creeper: aufgeladen, Zündung
     - Schleim: Größe
     - Enderman: wütend, trägt Block
     - Dorfbewohner/Zombiedorfbewohner: Biom/Beruf/Stufe
     - Piglin: Aktivität
   - Absicherung: Fehlt eine dieser artspezifischen Methoden zur Laufzeit (`LinkageError`), werden die Details abgeschaltet und einmal im Log gemeldet. Die übrigen Daten laufen weiter.
2. **`live/entities.json`:** Lebewesen haben zusätzlich ein Objekt `mob`. Es enthält nur Werte, die vom Standard abweichen:
   ```json
   {"id": 31, "type": "minecraft:zombie", "position": {...}, "rotation": {"yaw": 90, "pitch": 10}, ...,
    "mob": {"bodyYaw": 88.5, "headYaw": 95, "hurtTime": 7, "baby": true, "width": 0.6, "height": 1.95,
            "flags": ["attacking"], "equipment": {"mainHand": {"id": "minecraft:iron_sword"}, "mainArm": "left"}}}
   ```
   Weitere mögliche Felder sind `deathTime`, `variant` (z. B. `light_blue`, `brown`, `plains/farmer/2`) und `size`.
   Mögliche Werte für `flags`: `attacking`, `sheared`, `saddled`, `charged`, `fusing`, `angry`, `carrying`, `admiring`, `melee`, `crossbow_hold`, `crossbow_charge`.
3. **Texturen:**
   - `ItemModelBaker.bakeMob` schreibt beim ersten Auftreten eines Mob-Typs `assets/entities/<ns>/<pfad>.json` mit den Texturen aus dem Resource-Pack, als Daten-URLs nach Texturschlüssel.
   - Die Pfade stammen aus den Vanilla-Renderern (`MobTextures`). Für Dorfbewohner wird der ganze Ordner `entity/villager/` übernommen (Typen, Berufe, Stufen).
   - Gehaltene Items nutzen die vorhandenen Item-Assets.

## 3. Modelle

- **Modelldaten:**
  - `common/webapp/src/js/markers/mob/vanilla-mob-models.json` enthält die Modell-Ebenen im Format der Vanilla-`TexturedModelData`: Teile, Drehpunkt, Drehung, Quader mit UV, Vergrößerung (`dilation`), Spiegelung und Texturgröße.
  - Dazu kommen die Wollfarben der Schafe.
- **Prüfung gegen Minecraft:**
  - Der Fabric-Test `VanillaMobModelsTest` vergleicht diese Datei im CI mit den Modelldaten aus Minecraft selbst. Er ruft dafür die statischen Modell-Methoden der Vanilla-Klassen auf (Client-Klassen des Merged-Jars), z. B. `BipedEntityModel.getModelData`, `CowEntityModel.getTexturedModelData` und `SlimeEntityModel.getInnerTexturedModelData`.
  - Jede Abweichung lässt den Test fehlschlagen. Die Vanilla-Definition wird dann als GitHub-Annotation ausgegeben, so muss kein Wert geraten werden. Gefunden und korrigiert wurde so die Texturgröße des Schweins (64×32).
  - Geprüft werden Teile, Drehpunkte, Drehungen, Quader, UV, Vergrößerung, Spiegelung und Texturgröße.
- **Nicht von Minecraft geprüft:**
  - Welche Methode zu welcher Modell-Ebene gehört (die Zuordnung aus `EntityModels.getModels()`): `getModels()` selbst braucht die Registries, und die lassen sich in der Test-JVM mit den Entwickler-Mappings nicht starten. Der Fabric-Loader im Test scheitert an den aufgelösten Abhängigkeiten.
  - Die Texturgröße der Ebenen, die `EntityModels` selbst mit `TexturedModelData.of` erzeugt: Zombie, Wüstenzombie, Eiswanderer-Hülle, Dorfbewohner, Piglins.
- **Wollfarben:**
  - `SheepEntity` lässt sich ohne Registries nicht laden. Geprüft werden deshalb die Farbstoff-Farben (`DyeColor.getEntityColor`) aus Minecraft.
  - Die Abdunklung (Weiß = `#E6E6E6`, sonst · 0,75) entspricht `SheepEntity.getDyedColor`. Sie ist nachgebaut, nicht aus Minecraft gelesen.
- **Geometrie** (`MobModelGeometry.js`):
  - Die Quader werden wie in `ModelPart.Cuboid` aufgebaut: Ecken, UV-Layout, Spiegelung, Vergrößerung, Texturskalierung.
  - Ein Node-Test prüft das UV-Layout gegen das in Minecraft bestätigte Spielermodell.
- **Darstellung** (`MobModel.js`): Die Kette entspricht `LivingEntityRenderer`:
  - Drehung `180° − bodyYaw`
  - Todesdrehung um z: `min(1, √((deathTime − 1) / 20 · 1,6)) · 90°`, bei Spinnen 180°
  - Spiegelung `scale(−1, −1, 1)`, dann die Renderer-Skalierung
  - Verschiebung um −1,501
  - Teile mit Drehung in der Reihenfolge z·y·x
  - Babys wie in `AnimalModel`: Kopf- und Körperteile getrennt skaliert und verschoben. Dorfbewohner-Babys werden wie im Vanilla-Renderer auf 0,5 skaliert.
- **Renderer-Skalierungen:**

  | Mob | Skalierung |
  |---|---|
  | Wüstenzombie | 1,0625 |
  | Witherskelett | 1,2 |
  | Höhlenspinne | 0,7 |
  | Dorfbewohner | 0,9375 |
  | Schleim | 0,999 · Größe |
  | Creeper | Anschwellen nach `CreeperEntityRenderer.scale` |

- **Ebenen:**
  - äußere Ebene: Ertrunkener, Eiswanderer
  - Wolle (eingefärbt), Sattel
  - Energie-Wirbel des aufgeladenen Creepers: additiv, die Textur wandert um 0,01 pro Tick
  - Augen: Spinne, Enderman (additiv)
  - durchscheinende Hülle des Schleims
  - Kleidung des Dorfbewohners: Grundtextur, Biom, Beruf und Stufe übereinander gezeichnet; fehlende Zusatzebenen werden ausgelassen
- **Gehaltene Items:**
  - Gleiche Kette wie `HeldItemFeatureRenderer`, mit der Item-Darstellung aus Phase 4.
  - Skelette halten das Item 1 px weiter außen (`SkeletonEntityModel.setArmAngle`).

## 4. Animation (`MobAnimations.js`)

- Die Animationen sind den `setAngles`/`animateModel`-Methoden der Vanilla-Modelle (1.21) nachgebaut:
  - Biped
  - Zombie (`CrossbowPosing.meleeAttack`)
  - Ertrunkener
  - Skelett
  - Piglin
  - Vierbeiner
  - Creeper
  - Spinne
  - Huhn
  - Enderman
  - Dorfbewohner
- Die Laufanimation folgt `LimbAnimator`. Die Geschwindigkeit kommt aus der angezeigten (interpolierten) Bewegung: Ziel `min(Blöcke pro Tick · 4, 1)`, Annäherung 40 % pro Tick. Bei Babys läuft die Phase dreimal so schnell.
- Weitere Animationen:
  - **Kopf:** Drehung relativ zum Körper.
  - **Hühner:** Flügelschlag aus `ChickenEntity.tickMovement`, abhängig von „am Boden“.
  - **Creeper:** Zündung über einen eigenen Zähler (±1 pro Tick, 30 Ticks).
  - **Treffer:** rot für `hurtTime` Ticks.
  - **Tod:** rot und Umkippen über 20 Ticks.

## 5. Einschränkungen (bekannt)

- Rüstung der Mobs wird nicht gezeigt.
- Die Pilze auf dem Mooshroom fehlen (Blockmodelle als Feature).
- Der Block in den Händen des Endermans fehlt; nur die Armhaltung ist zu sehen.
- Der Schlag-Schwung der Mobs (`handSwingProgress`) wird nicht übertragen. Zombies und Skelette heben beim Angriff die Arme, schlagen aber nicht sichtbar zu.
- Fehlende Effekte:
  - das weiße Aufblitzen des zündenden Creepers
  - das Zittern des wütenden Endermans
  - der Tanz feiernder Piglins
  - das Grasfressen der Schafe
  - das Kopfschütteln der Dorfbewohner
  - der Regenbogen von „jeb_“
- Der Hut-Typ aus den `.mcmeta`-Dateien der Dorfbewohner wird nicht ausgewertet; der Hut wird immer gezeichnet.
- Magmawürfel, Pferde, Wölfe, Katzen, Eisengolems und alle übrigen erscheinen als Platzhalter; weitere Familien folgen in 0.3.x.
- Die Beleuchtung ist wie bei den Spielermodellen unbeleuchtet.

## 6. Tests

**Automatisiert:**

| Test | Ergebnis | Inhalt |
|---|---|---|
| Fabric `VanillaMobModelsTest` (CI) | siehe CI-Lauf | 27 Modell-Ebenen und Farbstoff-Farben gegen Minecraft 1.21 |
| Java (lokal) | 61/61 | u. a. Mob-JSON, Ausrüstungs-Assets, Mob-Texturen, Ordner-Texturen |
| Node | 82/82 | u. a. UV gegen das Spielermodell, Spiegelung, Animationen, Varianten, Material-Cache, MobModel, Marker |
| Browser `mobs-e2e.mjs` | 8/8 | siehe unten |
| Browser `entities-e2e.mjs` | 11/11 | neu: `markers.json`-Aktualisierung behält das Entity-Set |
| Browser `player-e2e.mjs` | 22/22 | |
| Browser `animation-e2e.mjs` | 19/19 | |
| Browser `items-e2e.mjs` | 16/16 | |
| Regression gegen das Original | pixelgleich | |

`mobs-e2e.mjs` prüft im Einzelnen:
- Zombie mit Textur, Armen und Schwert (Pixel)
- Laufen
- Treffer (rote Pixel und wieder normal)
- Tod
- Kuh
- Schaf mit Vanilla-Rot, geschoren ohne Wolle
- Dorfbewohner mit Beruf (Pixel)
- Platzhalter

**Fehler nach dem Test in Minecraft behoben (liegende Items zu groß, Schild kreist):**
- Der Webserver erlaubt Browsern, Assets einen Tag lang zu cachen. Nach dem Update wurden deshalb noch die Item-Assets von 0.1.0 verwendet, und darin fehlte die Boden-Transformation (Skalierung 0,5 und Verschiebung).
- Die Asset-URLs haben jetzt eine Versionsnummer (`?v=3`, `ASSET_VERSION`), so lädt eine neue Webapp-Version immer die passenden Assets.
- Neue Prüfungen in `entities-e2e.mjs`: Boden-Skalierung 0,5 und versionierte URL.

**Fehler in 0.2.0 gefunden und behoben:**
- `markers.json` wird alle 10 s neu geladen. Dabei hat der `NormalMarkerManager` jedes Marker-Set entfernt, das dort nicht steht, also auch „Entities“. Danach wurden alle Entities neu angelegt: Item-Modelle wurden neu geladen und fliegende Pfeile begannen neu.
- Das Set steht jetzt wie das Spieler-Set auf der Ausnahmeliste.

**Manuell in Minecraft:** O1–O12 in `singleplayer-test.md`, alle offen.
