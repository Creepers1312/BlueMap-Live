# BlueMap Live – Phase 8: Tag-Nacht-Zyklus der Welt und weitere Mob-Details

Stand: 2026-10-16 · Branch `bluemap-live` · Wunsch des Nutzers nach Phase 7

> **Kurzfassung:**
> - **Implementiert:**
>   - Die Kartenbeleuchtung kann dem Tag-Nacht-Zyklus der Minecraft-Welt folgen. Das ist eine zusätzliche Auswahl neben BlueMaps eigenem Tag/Nacht-Schalter.
>   - Der sichtbare Schlag der Mobs.
> - **Nicht geprüft:** Minecraft (manuelle Prüfungen Q1–Q9 offen).

## 1. Tag-Nacht-Zyklus der Welt

**Server** (`FabricMod`, Server-Thread, im Takt der Live-Daten):
- Für jede Welt ohne feste Zeit (Oberwelt, nicht Nether und Ende) werden gelesen:
  - die Tageszeit (`getTimeOfDay() mod 24000`)
  - Regen- und Gewitterstärke
  - die Spielregel `doDaylightCycle`
- **Daten** in `players.json` der Karte, nur mit `live-player-extended-data`:
  ```json
  "world": {"dayTime": 13000, "rain": 0.0, "thunder": 0.0, "cycle": true}
  ```
- Ohne Feld (alter Server, Nether, Ende) bleibt alles wie bisher.

**Webapp** (`WorldTime.js`, `WorldTimeLighting.js`):
- **Helligkeit:** Das Sonnenlicht der Karte folgt dem Himmelslicht des Servers wie `World.calculateAmbientDarkness` (Sonnenwinkel wie `DimensionType.getSkyAngle`).
  - Werte: Tag 1, Nacht 4/15. Regen und Gewitter dunkeln ab.
  - Anders als in Minecraft wird nicht auf ganze Lichtstufen gerundet. Der Übergang ist dadurch fließend.
- **Zwischen den Abfragen** läuft die Zeit mit 20 Ticks pro Sekunde weiter (nicht bei `doDaylightCycle false`). Die Beleuchtung wird einmal pro Sekunde nachgeführt und nur bei einer Änderung neu gezeichnet.
- **Bedienung:**
  - Ein Uhr-Knopf direkt neben dem Tag/Nacht-Schalter und ein Schalter „Tag-Nacht-Zyklus der Welt“ im Einstellungsmenü unter „Beleuchtung“.
  - Beide erscheinen nur, wenn der Server die Zeit liefert. Standard: aus, das ursprüngliche Verhalten.
  - Der eigene Tag/Nacht-Schalter und der Sonnenlicht-Regler beenden den Modus.
  - Die Wahl wird mit den anderen Benutzereinstellungen gespeichert (nur mit `useCookies`, wie im Original).
- **Lebewesen und Gegenstände:**
  - Spieler, Mobs und Items werden jetzt wie die Karte im Freien beleuchtet, d. h. nachts dunkler: Farbe · mix(Umgebungslicht, 1, Sonnenlicht).
  - Das gilt auch für BlueMaps eigenen Schalter und die Regler.
  - Leuchtende Teile (Augen von Spinne und Enderman, Energiehülle) bleiben hell wie in Minecraft.
  - Das Blocklicht am Ort des Lebewesens wird nicht berücksichtigt (Näherung: draußen).

**Einschränkungen:**
- Der Himmel der Karte ist BlueMaps eigener (keine Sonne, kein Mond, keine Sterne).
- Das Licht der Karte ist BlueMaps Shader: `mix(Blocklicht, Himmelslicht, Sonnenlicht)`. In Minecraft wird stattdessen die Verdunkelung vom Himmelslicht abgezogen. Höhlen und Innenräume können dadurch leicht anders wirken.

## 2. Sichtbarer Schlag der Mobs

**Server** (`FabricMobs`):
- **Armschwung:** `handSwingTicks`, solange `handSwinging` gesetzt ist, und die schwingende Hand.
  - Nur für feindliche Mobs (`HostileEntity`): Nur deren `tickMovement` lässt den Schwung auf dem Server weiterlaufen.
  - Das betrifft u. a. Zombies, Skelette, Piglins, Diener und Hexen.
- **Angriffs-Zähler** der Modelle mit eigener Angriffsanimation:
  - Eisengolem: `getAttackTicksLeft`
  - Verwüster: `getAttackTick`
  - Hoglin und Zoglin: `getMovementCooldownTicks`
- **Daten:** `mob.swingTicks` und `mob.attackTicks` in `entities.json`, nur wenn gesetzt. Die schwingende Nebenhand ist die Flag `swing_off_hand`.
- **Abtastung:** Ein Armschwung dauert 6 Ticks. Beim Standardtakt von 250 ms (5 Ticks) wird so jeder Schwung mindestens einmal erfasst. Bei längeren Intervallen können einzelne Schwünge fehlen.

**Webapp:**
- **Zeitverlauf:**
  - Schwung und Angriff laufen zwischen den Abfragen lokal weiter.
  - Eine weitere Abfrage desselben Schwungs startet ihn nicht neu. Nur ein neuer, früherer Fortschritt beginnt einen neuen.
- **Animationen:**
  - Armschwung wie `BipedEntityModel.animateArms`, mit dem Arm aus `getPreferredArm`: Der Körper dreht sich mit, der Arm schlägt.
  - Zombies, Skelette, Piglins und Diener nutzen den Fortschritt zusätzlich in ihren Angriffsposen (`CrossbowPosing.meleeAttack` usw.).
  - Eisengolem wie `IronGolemEntityModel.animateModel`: beide Arme `-2 + 1,5 · wrap(Zähler, 10)`.
  - Hoglin und Zoglin wie `HoglinEntityModel.setAngles`: Der Kopf wird bis −20° hochgerissen.
  - Verwüster wie `RavagerEntityModel.animateModel`: Der Hals stößt 12 px nach vorn, das Maul öffnet sich.
- **Prüfung der Werte:**
  - Die Ruhewerte stimmen mit den CI-geprüften Modelldaten überein: Hoglin-Kopf 0,87266463, Verwüster-Hals bei z = 5,5.
  - Die Formeln selbst sind nicht automatisch gegen Minecraft geprüft.

**Nicht gezeigt:**
- Angriff des Wardens (Keyframe-Animation).
- Betäubter oder brüllender Verwüster.
- Schwünge friedlicher Mobs, z. B. des Allays (deren Schwung läuft nur im Client).

## 3. Tests

**Automatisiert:**

| Test | Ergebnis |
|---|---|
| Java (lokal) | 63/63, u. a. `world` in `players.json` nur mit erweiterten Daten, `swingTicks` und `attackTicks` nur wenn gesetzt |
| Node | 100/100, u. a. Sonnenwinkel, Himmelslicht (Tag, Nacht, Regen, Gewitter), Weiterlaufen der Zeit, Beleuchtung der Lebewesen, Ein- und Ausschalten; Eisengolem-, Hoglin- und Verwüster-Angriff, Körperdrehung beim Schwung (Haupt- und Nebenhand), lokaler Ablauf ohne Neustart |
| Browser `worldtime-e2e.mjs` | 9/9: Knopf nur mit Weltzeit, Mitternacht dunkelt die Karte ab (Pixel), Mittag, Regen, Speichern/Laden, eigener Schalter beendet den Modus, Einstellungsmenü |
| Browser `mobs-e2e.mjs` | 11/11, neu: Zombie schwingt (Körper dreht sich und kehrt zurück), Eisengolem schlägt mit beiden Armen |
| Browser `entities`, `items`, `animation` | 12/12, 16/16, 19/19 |
| Browser `player-e2e.mjs` | 22/22 nach der Tag-Nacht-Änderung; in späteren Läufen 21/22 (s. u.) |

- Ein Lauf von `animation-e2e.mjs` schlug einmal bei der Gehamplitude nach Skinwechsel fehl, zwei Wiederholungen liefen fehlerfrei durch (Zeitabhängigkeit des Tests).
- `player-e2e.mjs`, Schritt „skin (slim)“: Ein Farbpixel am linken Arm weicht ab. Derselbe Fehler tritt mit dem Webclient-Stand vor Phase 8 (`e41baa29`) auf. Er stammt also nicht aus diesen Änderungen; die Ursache ist noch nicht geklärt.
- Der Fabric-Teil kompiliert nur in der CI.

**Manuell in Minecraft:** Q1–Q6 in `singleplayer-test.md`, alle offen.
