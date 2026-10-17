# BlueMap Live – Phase 7: Rüstung, Mob-Details und alle Mobs von 1.21

Stand: 2026-10-16 · Branch `bluemap-live` · Wunsch des Nutzers nach dem Test von 0.3.0, vor den Live-Blockänderungen

> **Kurzfassung:**
> - **Implementiert:**
>   - Rüstung an Spielern und Mobs
>   - Pilze auf dem Mooshroom, der getragene Block des Endermans
>   - weißes Aufblitzen des zündenden Creepers
>   - 60 weitere Mob-Arten von Minecraft 1.21
> - **Geprüft gegen Minecraft (CI):** alle 97 Modell-Ebenen.
> - **Nicht geprüft:** Minecraft (manuelle Prüfungen P1–P10 offen).

## 1. Rüstung

- **Server** (`FabricArmor`):
  - Pro Slot werden die Ebenen bestimmt wie in `ArmorFeatureRenderer`: nur ein Rüstungsitem des passenden Slots, die Ebenen seines Rüstungsmaterials, für die Hose die zweite Textur (inneres Modell).
  - Färbbare Ebenen bekommen die Farbstoff-Farbe (Leder, Standard `0xA06540`).
  - `ArmorMaterial` ist in Yarn 1.21 ein Record ohne lesbare Komponentennamen. Material, Ebenen und `getTexture(boolean)` werden deshalb per Reflection über ihre Typen gefunden.
  - Rückfallregel, falls das scheitert: die Vanilla-Ebenen `<material>_layer_1/2`, Leder mit Überzug.
- **Daten:** `equipment.armor` in `players.json` und `entities.json`:
  ```json
  "armor": {"head": [{"texture": "minecraft:models/armor/iron_layer_1"}],
            "legs": [{"texture": "minecraft:models/armor/leather_layer_2", "color": 3364351},
                     {"texture": "minecraft:models/armor/leather_layer_2_overlay"}]}
  ```
- **Texturen:**
  - Rüstungstexturen werden als PNG unter `assets/textures/<ns>/<pfad>.png` bereitgestellt (`ItemAssetUpdater.requestTexture`).
  - Angefordert werden sie über die Item-Anfragen mit dem Präfix `texture:`, erlaubt ist nur `models/armor/`.
- **Webapp** (`ArmorView`):
  - Die Teile pro Slot entsprechen `ArmorFeatureRenderer.setVisible`. Die Modelle sind `ArmorEntityModel` (innen 0,5, außen 1,0), eigene Modelle haben der Zombiedorfbewohner und die Piglins (außen 1,02).
  - Am Spieler hängen die Teile an den Knochen des Spielermodells, um 180° um x gedreht (Vanilla-Raum). So folgen sie der Animation und den Slim-Armen wie bei `copyBipedStateTo`.
  - Bei Mobs folgen sie den Knochen der Rüstungsmodelle.
  - Rüstung wird bei Schaden nicht rot, wie in Vanilla.

## 2. Mooshroom-Pilze, Enderman-Block

- **Server:** `mob.models` nennt die benötigten Blockmodelle, z. B. `minecraft:block/red_mushroom` (Mooshroom-Variante) oder den Block, den der Enderman trägt. Sie werden wie Item-Assets gebacken.
- **Webapp:** Die Lage entspricht `MooshroomMushroomFeatureRenderer`: zwei Pilze auf dem Rücken, einer auf dem Kopf, nicht bei Babys. Beim Enderman entspricht sie `EndermanBlockFeatureRenderer`.
- Hat ein Block kein eigenes Blockmodell, wird das Item-Modell verwendet.

## 3. Weißes Aufblitzen des Creepers

- Nachgebaut ist `CreeperEntityRenderer.getAnimationCounter`: Blinken alle 0,1 des Zündfortschritts, mindestens zur Hälfte.
- Die Stärke folgt der Overlay-Textur: Weißanteil = Stufe / 15 · 0,75.
- Bei Schaden ist das Rot stärker, wie in Vanilla.

## 4. Weitere Mobs

**Modelle:**
- Die Daten stammen direkt aus Minecraft. Der CI-Test ruft die Modell-Methoden auf, und meldet für Ebenen, die die Webapp noch nicht hat, die Vanilla-Definition. Diese wurde übernommen.
- Seitdem vergleicht der Test alle 97 Ebenen.

**Umfang:**

| Gruppe | Mobs |
|---|---|
| Menschenähnliche | Plünderer, Diener, Magier, Illusionist, Hexe, Fahrender Händler, Riese, Bogged |
| Golems | Eisengolem (Dreieckswelle der Beine), Schneegolem |
| Vierbeiner | Pferd (Farbe und Abzeichen), Esel, Maultier, Skelett- und Zombiepferd, Lama, Händlerlama, Katze, Ozelot, Wolf, Fuchs, Ziege, Eisbär, Panda, Hoglin, Zoglin, Verwüster, Kamel, Schnüffler, Gürteltier, Schildkröte, Kaninchen |
| Fliegende | Lohe (Stab-Ringe), Ghast, Phantom, Fledermaus, Biene, Papagei, Allay, Plagegeist, Breeze |
| Wasser | Kabeljau, Lachs, Tropenfisch (klein/groß, Muster), Kugelfisch, Tintenfisch, Leuchttintenfisch, Delfin, Wächter, Großer Wächter, Axolotl, Kaulquappe, Frosch |
| Sonstige | Silberfischchen, Endermite, Shulker, Magmawürfel, Wither, Warden, Strider |

**Varianten:**
- Der Server liest sie allgemein über `VariantHolder`, mit Name aus Registry-Schlüssel, `StringIdentifiable` oder Enum. Das betrifft u. a. Katze, Wolf, Frosch, Axolotl, Fuchs, Lama, Papagei, Kaninchen und Tropenfisch.
- Eigens gelesen werden Pferdefarbe mit Abzeichen und das Panda-Gen.
- Zusätzliche Zustände als Flags: zahm, sitzend, wütend, Sattel, Truhe, Illager-Zustand, Biene (Nektar, gestochen), Ghast schießt, Plagegeist greift an, Bogged geschoren, Strider friert.

**Animationen:**
- Nachgebaut aus den `setAngles`-Methoden: Illager, Eisengolem, Schneegolem, Lohe, Ghast, Phantom, Silberfischchen, Endermite, Hoglin, Ozelot und Katze (Gehen), Strider, Wolf (Beine und Schwanz).
- **Näherungen**, weil die Vanilla-Animation per Keyframes oder eigener Zustandslogik läuft: Frosch, Kamel, Schnüffler, Warden, Gürteltier, Breeze, Fledermaus, Allay, Plagegeist, Biene, Papagei, Fische, Tintenfisch, Wächter, Delfin, Pferde, Fuchs, Schildkröte, Kaninchen, Panda, Eisbär, Ziege, Axolotl, Kaulquappe, Wither.
- Diese Mobs bekommen eine Kopfbewegung, Beinschwung bzw. Flügel- und Schwanzbewegung.

**Renderer-Skalierungen** (aus den Vanilla-Renderern, nicht automatisch geprüft):

| Mob | Skalierung |
|---|---|
| Riese | 6 |
| Ghast | 4,5 |
| Großer Wächter | 2,35 |
| Wither | 2 |
| Eisbär | 1,2 |
| Pferd | 1,1 |
| Maultier | 0,92 |
| Esel | 0,87 |
| Katze | 0,8 |
| Fledermaus | 0,35 |
| Illager, Hexe, Fahrender Händler | 0,9375 |

## 5. Einschränkungen

- **Rüstung:** keine Rüstungsverzierungen (Trims), kein Verzauberungsglanz. Köpfe und geschnitzte Kürbisse auf dem Kopf fehlen.
- **Ganz fehlende Mobs:** Der Enderdrache erscheint als Platzhalter.
- **Fehlende Ebenen:** Halsbänder (Katze, Wolf), Lama-Teppiche, Pferderüstung, Leuchtschichten (Warden, Leuchttintenfisch), der Wind der Breeze, der Kürbis des Schneegolems.
- **Fehlende Posen:** Sitzen (Katze, Wolf, Fuchs), Schlafen, Stehen (Eisbär), Rollen (Gürteltier).
- **Varianten:**
  - Tropenfische ohne ihre Farben (weiße Grundtextur mit Muster).
  - Kugelfische immer klein.
  - Phantome ohne Größe.
- Die Pilze bleiben bei Schaden ungefärbt.
- Die Transformationen der Pilze und des Enderman-Blocks sind aus den Vanilla-Renderern nachgebaut und nicht automatisch geprüft.

## 6. Tests

**Automatisiert:**

| Test | Ergebnis |
|---|---|
| Fabric `VanillaMobModelsTest` (CI) | alle 97 Ebenen gleich wie in Minecraft 1.21 |
| Java (lokal) | 62/62, u. a. Rüstung und `models` im JSON, Anfragen der Texturen und Blockmodelle |
| Node | 88/88 |
| Browser `mobs-e2e.mjs` | 10/10 |
| Browser `entities-e2e.mjs` | 12/12 |
| Browser `items-e2e.mjs` | 16/16 |
| Browser `player-e2e.mjs` | 22/22 |
| Browser `animation-e2e.mjs` | 19/19 |
| Regression gegen das Original | 216 Pixel mit höchstens 36 von 255 Stufen Unterschied, vergleichbar mit Original gegen Original (111 Pixel) |

- Die Node-Tests prüfen u. a.: Lage der Rüstung (Helm 1 px um den Kopf), Färbung, Freigabe, Pilze, Block-Rückfall, Aufblitzen und alle Mob-Typen mit ihren Animationen.
- Die Browsertests prüfen u. a.: Rüstung an Zombie und Spieler (Pixel), Pilze, getragener Block, Aufblitzen und Anschwellen.
- Der Regressionsvergleich war in früheren Läufen pixelgleich; das Rauschen tritt auch zwischen zwei Läufen des Originals auf.

**Manuell in Minecraft:** P1–P10 in `singleplayer-test.md`, alle offen.
