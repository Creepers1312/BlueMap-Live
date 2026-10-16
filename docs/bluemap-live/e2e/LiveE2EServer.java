/*
 * BlueMap Live – Phase 2 end-to-end test-server (NOT part of the BlueMap build).
 *
 * Serves the original, built BlueMap webapp (common/webapp/dist) together with
 *  - a small test-map whose single hires-tile is generated with BlueMap's own ArrayTileModel + PRBMWriter
 *  - maps/world/live/players.json generated with BlueMap's own PlayerMotionTracker + LivePlayersJson
 *    (the same classes FabricPlayer / LivePlayersDataSupplier use on the real server)
 *
 * The player-state is driven by the test-script through /control requests, each /control request is one
 * "server sample" (like FabricPlayer.update() on the server-thread).
 *
 * Usage: see docs/bluemap-live/e2e/README.md
 */

import com.flowpowered.math.vector.Vector3d;
import com.google.gson.stream.JsonWriter;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import de.bluecolored.bluemap.common.live.LivePlayerState;
import de.bluecolored.bluemap.common.live.LivePlayersJson;
import de.bluecolored.bluemap.common.live.Armor;
import de.bluecolored.bluemap.common.live.Equipment;
import de.bluecolored.bluemap.common.live.HeldItem;
import de.bluecolored.bluemap.common.live.ItemUse;
import de.bluecolored.bluemap.common.live.LiveEntitiesJson;
import de.bluecolored.bluemap.common.live.LiveEntityState;
import de.bluecolored.bluemap.common.live.LiveMobState;
import de.bluecolored.bluemap.common.live.MovementState;
import de.bluecolored.bluemap.common.live.SwingState;
import de.bluecolored.bluemap.common.plugin.items.ItemModelBaker;
import de.bluecolored.bluemap.common.live.PlayerMotionTracker;
import de.bluecolored.bluemap.core.map.hires.ArrayTileModel;
import de.bluecolored.bluemap.core.map.hires.PRBMWriter;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.StringWriter;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

public class LiveE2EServer {

    private static final String MAP_WORLD = "minecraft:overworld";

    /** map-id -> the dimension the map shows (like the auto-generated map-configs of a world) */
    private static final Map<String, String> MAPS = Map.of(
            "world", "minecraft:overworld",
            "world_the_nether", "minecraft:the_nether"
    );

    private static final class SimPlayer {
        final String uuid;
        final String name;
        final PlayerMotionTracker tracker = new PlayerMotionTracker();
        String world = MAP_WORLD;
        LivePlayerState state;
        String skin = "none"; // none | classic | slim | broken
        int swingCount = 0;
        boolean swingLeft = false;
        SwingState.Kind swingKind = SwingState.Kind.SWING;
        String mainHand = null, offHand = null;
        Armor armor = null;
        boolean leftHanded = false, charged = false;
        Integer hurtCount = null;

        SimPlayer(String uuid, String name) {
            this.uuid = uuid;
            this.name = name;
        }
    }

    private final Path webroot;
    private final byte[] tile;
    private final Map<String, SimPlayer> online = new LinkedHashMap<>();
    private final Deque<String> history = new ArrayDeque<>();
    private boolean serveStaleOnce = false;
    private int staleServed = 0;
    private boolean endpointDown = false;
    private boolean itemsDown = false;
    private final Map<String, byte[]> itemAssets = new HashMap<>();
    /** BlueMap Live entities (only in the overworld) */
    private final Map<Integer, LiveEntityState> entities = new LinkedHashMap<>();

    public LiveE2EServer(Path webroot) throws IOException {
        this.webroot = webroot;
        this.tile = createTile();
    }

    public static void main(String[] args) throws Exception {
        Path webroot = Path.of(args[0]);
        int port = args.length > 1 ? Integer.parseInt(args[1]) : 8100;

        LiveE2EServer server = new LiveE2EServer(webroot);
        HttpServer http = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        http.createContext("/", server::handle);
        http.start();
        System.out.println("LiveE2EServer running on http://127.0.0.1:" + port + "/");
    }

    private synchronized void handle(HttpExchange ex) throws IOException {
        try {
            String path = ex.getRequestURI().getPath();
            if (path.equals("/settings.json")) {
                send(ex, 200, "application/json", rootSettings().getBytes(StandardCharsets.UTF_8));
            } else if (path.equals("/control")) {
                handleControl(ex);
            } else if (path.startsWith("/maps/")) {
                String rest = path.substring("/maps/".length());
                int slash = rest.indexOf('/');
                String mapId = slash < 0 ? rest : rest.substring(0, slash);
                String file = slash < 0 ? "" : rest.substring(slash + 1);
                if (!MAPS.containsKey(mapId)) {
                    send(ex, 404, "text/plain", "no map".getBytes(StandardCharsets.UTF_8));
                    return;
                }
                switch (file) {
                    case "settings.json" -> send(ex, 200, "application/json", mapSettings(mapId).getBytes(StandardCharsets.UTF_8));
                    case "textures.json" -> send(ex, 200, "application/json", textures().getBytes(StandardCharsets.UTF_8));
                    case "tiles/0/x0/z0.prbm" -> send(ex, 200, "application/octet-stream", tile);
                    case "live/players.json" -> handlePlayers(ex, mapId);
                    case "live/markers.json" -> send(ex, 200, "application/json", "{}".getBytes(StandardCharsets.UTF_8));
                    case "live/entities.json" -> handleEntities(ex, mapId);
                    default -> {
                        if (file.startsWith("assets/playerskins/") && file.endsWith(".png")) handleSkin(ex, file);
                        else if (file.startsWith("assets/items/") && file.endsWith(".json")) handleItem(ex, file);
                        else if (file.startsWith("assets/entities/") && file.endsWith(".json")) handleEntityAsset(ex, file);
                        else if (file.startsWith("assets/textures/") && file.endsWith(".png")) handleTexture(ex, file);
                        else send(ex, 404, "text/plain", "not found".getBytes(StandardCharsets.UTF_8));
                    }
                }
            } else {
                serveStatic(ex, path);
            }
        } catch (Exception e) {
            e.printStackTrace();
            send(ex, 500, "text/plain", e.toString().getBytes(StandardCharsets.UTF_8));
        }
    }

    // --- live data ---

    private void handlePlayers(HttpExchange ex, String mapId) throws IOException {
        if (endpointDown) {
            send(ex, 503, "text/plain", "down".getBytes(StandardCharsets.UTF_8));
            return;
        }

        String body;
        if (!mapId.equals("world")) {
            body = currentJson(MAPS.get(mapId));
        } else if (serveStaleOnce && history.size() >= 2) {
            // the response of the second to last sample (older serverTime and older positions),
            // like it could come from a cache or a slow proxy: must be ignored by the client
            Iterator<String> it = history.descendingIterator();
            it.next();
            body = it.next();
            serveStaleOnce = false;
            staleServed++;
        } else {
            body = currentJson(MAP_WORLD);
        }
        send(ex, 200, "application/json", body.getBytes(StandardCharsets.UTF_8));
    }

    /** like LivePlayersDataSupplier: players in another dimension than the map are "foreign" */
    private String currentJson(String mapWorld) throws IOException {
        List<LivePlayersJson.Entry> entries = new ArrayList<>();
        for (SimPlayer p : online.values()) {
            LivePlayersJson.Skin skin = switch (p.skin) {
                case "classic" -> new LivePlayersJson.Skin("classic", "0c");
                case "slim" -> new LivePlayersJson.Skin("slim", "05");
                case "broken" -> new LivePlayersJson.Skin("classic", "0b"); // announced, but the image is missing (404)
                default -> null;
            };
            entries.add(new LivePlayersJson.Entry(p.uuid, p.name, !p.world.equals(mapWorld), p.world, p.state, skin));
        }
        StringWriter out = new StringWriter();
        try (JsonWriter json = new JsonWriter(out)) {
            LivePlayersJson.write(json, System.currentTimeMillis(), 250, true, entries);
        }
        return out.toString();
    }

    /**
     * One server-sample: /control?uuid=..&name=..&x=..&y=..&z=..&pitch=..&yaw=..&bodyYaw=..&world=..&respawn=1
     * Movement-flags (default: standing on the ground): &sneaking=1&sprinting=1&ground=0&swimming=1&flying=1&fallFlying=1
     * Velocity override (instead of the one derived from the samples): &vx=..&vy=..&vz=..
     * Arm-swing (increments the swing-counter): &swing=right|left&swingKind=attack|mine|use|swing
     * Held items (kept until changed, "none" clears): &main=minecraft:diamond_sword&off=minecraft:shield&leftHanded=1&charged=1
     * Item use (only for this sample): &use=main|off&useAction=bow&useTicks=12
     * Hurt-counter (kept): &hurt=3
     * Item-assets unavailable (404, like before the server created them): /control?itemsDown=1|0
     * Other commands: /control?leave=uuid, /control?stale=1, /control?down=1|0, /control?status=1
     */
    private void handleControl(HttpExchange ex) throws IOException {
        Map<String, String> q = query(ex);

        if (q.containsKey("stale")) {
            serveStaleOnce = true;
            send(ex, 200, "application/json", "{}".getBytes(StandardCharsets.UTF_8));
            return;
        }
        if (q.containsKey("status")) {
            send(ex, 200, "application/json", ("{\"staleServed\":" + staleServed + "}").getBytes(StandardCharsets.UTF_8));
            return;
        }
        // entities: /control?entity=ID&type=minecraft:item&x=..&y=..&z=..&item=minecraft:diamond&vx=..&vy=..&vz=..&yaw=..&pitch=..
        //           /control?removeEntity=ID
        if (q.containsKey("entity")) {
            int id = Integer.parseInt(q.get("entity"));
            // mobs: &mob=1&bodyYaw=..&headYaw=..&hurt=TICKS&death=TICKS&baby=1&variant=..&size=..&flags=a,b&main=ITEM&left=1&w=..&h=..
            LiveMobState mob = null;
            if ("1".equals(q.get("mob"))) {
                HeldItem main = q.containsKey("main") ? new HeldItem(q.get("main")) : null;
                mob = new LiveMobState(d(q, "bodyYaw"), q.containsKey("headYaw") ? d(q, "headYaw") : d(q, "bodyYaw"),
                        (int) d(q, "hurt"), (int) d(q, "death"), "1".equals(q.get("baby")),
                        main != null || q.containsKey("armor") ? new Equipment(main, null, "1".equals(q.get("left")), false,
                                q.containsKey("armor") ? armor(q.get("armor")) : null) : null,
                        q.get("variant"), (int) d(q, "size"),
                        q.containsKey("w") ? d(q, "w") : 0.6, q.containsKey("h") ? d(q, "h") : 1.95,
                        q.containsKey("models") ? List.of(q.get("models").split(";")) : List.of(),
                        q.containsKey("flags") && !q.get("flags").isEmpty() ? List.of(q.get("flags").split(",")) : List.of());
            }
            entities.put(id, new LiveEntityState(id, q.getOrDefault("type", "minecraft:item"),
                    new Vector3d(d(q, "x"), d(q, "y"), d(q, "z")), d(q, "yaw"), d(q, "pitch"),
                    new Vector3d(d(q, "vx"), d(q, "vy"), d(q, "vz")), System.currentTimeMillis(),
                    q.containsKey("item") ? new HeldItem(q.get("item")) : null, "1".equals(q.get("ground")) || mob != null, mob,
                    // projectiles: &impact=x,y,z,ticks (where the server predicted the hit on a block)
                    q.containsKey("impact") ? impact(q.get("impact")) : null));
            send(ex, 200, "application/json", "{}".getBytes(StandardCharsets.UTF_8));
            return;
        }
        if (q.containsKey("removeEntity")) {
            entities.remove(Integer.parseInt(q.get("removeEntity")));
            send(ex, 200, "application/json", "{}".getBytes(StandardCharsets.UTF_8));
            return;
        }
        if (q.containsKey("itemsDown")) {
            itemsDown = q.get("itemsDown").equals("1");
            send(ex, 200, "application/json", "{}".getBytes(StandardCharsets.UTF_8));
            return;
        }
        if (q.containsKey("down")) {
            endpointDown = q.get("down").equals("1");
            send(ex, 200, "application/json", "{}".getBytes(StandardCharsets.UTF_8));
            return;
        }

        if (q.containsKey("leave")) {
            online.remove(q.get("leave"));
        } else {
            String uuid = q.get("uuid");
            SimPlayer p = online.computeIfAbsent(uuid, u -> new SimPlayer(u, q.getOrDefault("name", "Player")));
            if (q.containsKey("world")) p.world = q.get("world");
            if (q.containsKey("skin")) p.skin = q.get("skin");
            if ("1".equals(q.get("respawn"))) p.tracker.markDiscontinuity();
            if (q.containsKey("swing")) {
                p.swingCount++;
                p.swingLeft = q.get("swing").equals("left");
                p.swingKind = SwingState.Kind.valueOf(q.getOrDefault("swingKind", "swing").toUpperCase(java.util.Locale.ROOT));
            }
            if (q.containsKey("main")) p.mainHand = q.get("main").equals("none") ? null : q.get("main");
            if (q.containsKey("off")) p.offHand = q.get("off").equals("none") ? null : q.get("off");
            if (q.containsKey("leftHanded")) p.leftHanded = q.get("leftHanded").equals("1");
            if (q.containsKey("charged")) p.charged = q.get("charged").equals("1");
            if (q.containsKey("hurt")) p.hurtCount = Integer.parseInt(q.get("hurt"));
            if (q.containsKey("armor")) p.armor = armor(q.get("armor"));
            Equipment equipment = new Equipment(
                    p.mainHand != null ? new HeldItem(p.mainHand, false, null, p.charged && p.mainHand.endsWith(":crossbow"), false) : null,
                    p.offHand != null ? new HeldItem(p.offHand) : null,
                    p.leftHanded, false, p.armor
            );
            ItemUse use = q.containsKey("use") ?
                    new ItemUse(q.get("use").equals("main"), q.getOrDefault("useAction", "none"), Integer.parseInt(q.getOrDefault("useTicks", "0"))) :
                    null;

            Vector3d position = new Vector3d(d(q, "x"), d(q, "y"), d(q, "z"));
            long now = System.currentTimeMillis();
            PlayerMotionTracker.Result motion = p.tracker.sample(p.world, position, now);
            p.state = new LivePlayerState(
                    position,
                    new Vector3d(d(q, "pitch"), d(q, "yaw"), 0),
                    q.containsKey("bodyYaw") ? d(q, "bodyYaw") : d(q, "yaw"),
                    q.containsKey("vx") || q.containsKey("vy") || q.containsKey("vz") ?
                            new Vector3d(d(q, "vx"), d(q, "vy"), d(q, "vz")) : motion.velocity(),
                    motion.generation(),
                    now,
                    new MovementState(
                            flag(q, "sneaking"), flag(q, "sprinting"), !"0".equals(q.get("ground")),
                            flag(q, "swimming"), flag(q, "flying"), flag(q, "fallFlying")
                    ),
                    new SwingState(p.swingCount, p.swingLeft, p.swingKind),
                    equipment,
                    use,
                    p.hurtCount
            );
        }

        String json = currentJson(MAP_WORLD);
        history.addLast(json);
        while (history.size() > 8) history.removeFirst();
        send(ex, 200, "application/json", json.getBytes(StandardCharsets.UTF_8));
    }

    private static boolean flag(Map<String, String> q, String key) {
        return "1".equals(q.get(key));
    }

    private static double d(Map<String, String> q, String key) {
        return Double.parseDouble(q.getOrDefault(key, "0"));
    }

    private static Map<String, String> query(HttpExchange ex) {
        Map<String, String> map = new HashMap<>();
        String raw = ex.getRequestURI().getRawQuery();
        if (raw == null) return map;
        for (String part : raw.split("&")) {
            int i = part.indexOf('=');
            if (i < 0) map.put(URLDecoder.decode(part, StandardCharsets.UTF_8), "");
            else map.put(URLDecoder.decode(part.substring(0, i), StandardCharsets.UTF_8), URLDecoder.decode(part.substring(i + 1), StandardCharsets.UTF_8));
        }
        return map;
    }

    // --- test-map ---

    private static String rootSettings() {
        return """
            {"version":"live-e2e","useCookies":false,"defaultToFlatView":false,"resolutionDefault":1.0,
             "minZoomDistance":5,"maxZoomDistance":100000,"hiresSliderMax":500,"hiresSliderDefault":100,"hiresSliderMin":0,
             "lowresSliderMax":7000,"lowresSliderDefault":2000,"lowresSliderMin":500,
             "mapDataRoot":"maps","liveDataRoot":"maps","maps":["world","world_the_nether"],"scripts":[],"styles":[]}
            """;
    }

    private static String mapSettings(String mapId) {
        return mapSettings().replace("\"name\":\"Live E2E\"", "\"name\":\"Live E2E (" + mapId + ")\"")
                .replace("\"sorting\":0", "\"sorting\":" + (mapId.equals("world") ? 0 : 1));
    }

    private static String mapSettings() {
        return """
            {"name":"Live E2E","sorting":0,"startPos":[18,18],"skyColor":[0.5,0.8,1.0,1.0],"voidColor":[0,0,0,1],
             "ambientLight":0.1,"skyLight":1.0,
             "hires":{"tileSize":[32,32],"scale":[1,1],"translate":[2,2]},
             "lowres":{"tileSize":[500,500],"lodFactor":5,"lodCount":3},
             "perspectiveView":true,"flatView":true,"freeFlightView":true}
            """;
    }

    // --- skins ---

    private static final int[][] PART_UV = { {0, 0}, {16, 16}, {40, 16}, {32, 48}, {0, 16}, {16, 48} };
    private static final int[][] OVERLAY_UV = { {32, 0}, {16, 32}, {40, 32}, {48, 48}, {0, 32}, {0, 48} };

    /** face-rectangles {x, y, w, h} in the order right, left, top, bottom, front, back (standard box-uv layout) */
    private static int[][] boxRects(int u, int v, int w, int h, int d) {
        return new int[][] {
                { u, v + d, d, h },
                { u + d + w, v + d, d, h },
                { u + d, v, w, d },
                { u + d + w, v, w, d },
                { u + d, v + d, w, h },
                { u + d + w + d, v + d, w, h },
        };
    }

    private static int[] partSize(int part, boolean slim) {
        return switch (part) {
            case 0 -> new int[] {8, 8, 8};
            case 1 -> new int[] {8, 12, 4};
            case 2, 3 -> new int[] {slim ? 3 : 4, 12, 4};
            default -> new int[] {4, 12, 4};
        };
    }

    /** unique color per (layer, part, face, quadrant) – the same formula is used in player-e2e.mjs */
    static int skinColor(int layer, int part, int face, int quadrant) {
        int id = ((layer * 6 + part) * 6 + face) * 4 + quadrant;
        int r = 30 + (id % 8) * 30, g = 30 + ((id / 8) % 8) * 30, b = 30 + (id / 64) * 45;
        return 0xFF000000 | (r << 16) | (g << 8) | b;
    }

    /**
     * A synthetic skin: every face of the base layer is split into 4 quadrants (top-left, top-right, bottom-left,
     * bottom-right of the face-rectangle) with unique colors. The second layer is transparent, except the left half
     * of the hat-front.
     */
    private static BufferedImage colorCodedSkin(boolean slim) {
        BufferedImage img = new BufferedImage(64, 64, BufferedImage.TYPE_INT_ARGB);
        for (int part = 0; part < 6; part++) {
            int[] size = partSize(part, slim);
            int[][] rects = boxRects(PART_UV[part][0], PART_UV[part][1], size[0], size[1], size[2]);
            for (int face = 0; face < 6; face++) {
                int[] r = rects[face];
                for (int y = 0; y < r[3]; y++) for (int x = 0; x < r[2]; x++) {
                    int quadrant = (y < r[3] / 2 ? 0 : 2) + (x < r[2] / 2 ? 0 : 1);
                    img.setRGB(r[0] + x, r[1] + y, skinColor(0, part, face, quadrant));
                }
            }
        }
        int[] hatFront = boxRects(OVERLAY_UV[0][0], OVERLAY_UV[0][1], 8, 8, 8)[4];
        for (int y = 0; y < hatFront[3]; y++) for (int x = 0; x < hatFront[2] / 2; x++) {
            img.setRGB(hatFront[0] + x, hatFront[1] + y, skinColor(1, 0, 4, 0));
        }
        return img;
    }

    private void handleEntities(HttpExchange ex, String mapId) throws IOException {
        StringWriter out = new StringWriter();
        try (JsonWriter json = new JsonWriter(out)) {
            LiveEntitiesJson.write(json, System.currentTimeMillis(), 250,
                    mapId.equals("world") ? List.copyOf(entities.values()) : List.of());
        }
        send(ex, 200, "application/json", out.toString().getBytes(StandardCharsets.UTF_8));
    }

    /** baked by the real ItemModelBaker from a small, color-coded resource-pack (see E2EItemResources) */
    /**
     * "head:iron,legs:leather:3355ff" -> the vanilla layers of these materials (leather: dyeable layer and overlay),
     * "none" -> no armor
     */
    private static Armor armor(String value) {
        if (value.equals("none") || value.isEmpty()) return null;
        Map<String, List<Armor.Layer>> slots = new HashMap<>();
        for (String piece : value.split(",")) {
            String[] v = piece.split(":");
            String base = "minecraft:models/armor/" + v[1] + "_layer_" + (v[0].equals("legs") ? 2 : 1);
            Integer color = v.length > 2 ? Integer.parseInt(v[2], 16) : null;
            slots.put(v[0], v[1].equals("leather") ?
                    List.of(new Armor.Layer(base, color != null ? color : 0xA06540), new Armor.Layer(base + "_overlay", null)) :
                    List.of(new Armor.Layer(base, null)));
        }
        return new Armor(slots.get("head"), slots.get("chest"), slots.get("legs"), slots.get("feet"));
    }

    private static LiveEntityState.Impact impact(String value) {
        String[] v = value.split(",");
        return new LiveEntityState.Impact(new Vector3d(Double.parseDouble(v[0]), Double.parseDouble(v[1]), Double.parseDouble(v[2])),
                Double.parseDouble(v[3]));
    }

    private void handleItem(HttpExchange ex, String file) throws IOException {
        if (itemsDown) {
            send(ex, 404, "text/plain", "not yet".getBytes(StandardCharsets.UTF_8));
            return;
        }
        String path = file.substring("assets/items/".length(), file.length() - ".json".length());
        int slash = path.indexOf('/');
        String itemId = path.substring(0, slash) + ":" + path.substring(slash + 1);
        byte[] json = itemAssets.get(itemId);
        if (json == null) {
            json = new ItemModelBaker(new E2EItemResources()).bake(itemId).getBytes(StandardCharsets.UTF_8);
            itemAssets.put(itemId, json);
        }
        send(ex, 200, "application/json", json);
    }

    private void handleTexture(HttpExchange ex, String file) throws IOException {
        String path = file.substring("assets/textures/".length(), file.length() - ".png".length());
        int slash = path.indexOf('/');
        BufferedImage image = new E2EItemResources().texture(path.substring(0, slash) + ":" + path.substring(slash + 1));
        if (image == null) {
            send(ex, 404, "text/plain", "no texture".getBytes(StandardCharsets.UTF_8));
            return;
        }
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(image, "png", png);
        send(ex, 200, "image/png", png.toByteArray());
    }

    private void handleEntityAsset(HttpExchange ex, String file) throws IOException {
        String path = file.substring("assets/entities/".length(), file.length() - ".json".length());
        int slash = path.indexOf('/');
        String type = path.substring(0, slash) + ":" + path.substring(slash + 1);
        send(ex, 200, "application/json",
                new ItemModelBaker(new E2EItemResources()).bakeEntity(type).getBytes(StandardCharsets.UTF_8));
    }

    private void handleSkin(HttpExchange ex, String file) throws IOException {
        String uuid = file.substring("assets/playerskins/".length(), file.length() - 4);
        SimPlayer p = online.get(uuid);
        if (p == null || !(p.skin.equals("classic") || p.skin.equals("slim"))) {
            send(ex, 404, "text/plain", "no skin".getBytes(StandardCharsets.UTF_8));
            return;
        }
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(colorCodedSkin(p.skin.equals("slim")), "png", png);
        send(ex, 200, "image/png", png.toByteArray());
    }

    private static String dataUrl(BufferedImage img) throws IOException {
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(img, "png", png);
        return "data:image/png;base64," + Base64.getEncoder().encodeToString(png.toByteArray());
    }

    private static String textures() throws IOException {
        // one 16x16 checkered texture
        BufferedImage img = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
        for (int x = 0; x < 16; x++) for (int y = 0; y < 16; y++) {
            boolean dark = ((x / 4) + (y / 4)) % 2 == 0;
            img.setRGB(x, y, dark ? 0xFF5E8C3A : 0xFF79A84B);
        }
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(img, "png", png);
        String data = "data:image/png;base64," + Base64.getEncoder().encodeToString(png.toByteArray());
        // synthetic stand-in for the default skin of the resource-pack (uniform gray, NOT the mojang texture)
        BufferedImage steve = new BufferedImage(64, 64, BufferedImage.TYPE_INT_ARGB);
        for (int x = 0; x < 64; x++) for (int y = 0; y < 32; y++) steve.setRGB(x, y, 0xFF808080);
        for (int x = 0; x < 64; x++) for (int y = 48; y < 64; y++) if (x >= 16 && x < 48) steve.setRGB(x, y, 0xFF808080);
        for (int x = 0; x < 64; x++) for (int y = 16; y < 32; y++) if (x >= 32 && x < 40) steve.setRGB(x, y, 0);

        return "[{\"resourcePath\":\"test:block/grass\",\"color\":[0.4,0.6,0.3,1],\"halfTransparent\":false,\"texture\":\"" + data + "\"}," +
                "{\"resourcePath\":\"minecraft:entity/player/slim/steve\",\"color\":[0.5,0.5,0.5,1],\"halfTransparent\":false,\"texture\":\"" + dataUrl(steve) + "\"}]";
    }

    /** A 32x32 ground plane at y=64 with a 4x6x4 pillar (local 14..18), written with BlueMaps own PRBMWriter */
    private static byte[] createTile() throws IOException {
        ArrayTileModel model = new ArrayTileModel(64);
        // ground (top face, facing up)
        quad(model, 0, 64, 0,  0, 64, 32,  32, 64, 32,  32, 64, 0);
        // pillar: 4 sides + top
        float x0 = 14, x1 = 18, z0 = 14, z1 = 18, y0 = 64, y1 = 70;
        quad(model, x0, y0, z1,  x1, y0, z1,  x1, y1, z1,  x0, y1, z1); // south (+z)
        quad(model, x1, y0, z0,  x0, y0, z0,  x0, y1, z0,  x1, y1, z0); // north (-z)
        quad(model, x1, y0, z1,  x1, y0, z0,  x1, y1, z0,  x1, y1, z1); // east (+x)
        quad(model, x0, y0, z0,  x0, y0, z1,  x0, y1, z1,  x0, y1, z0); // west (-x)
        quad(model, x0, y1, z1,  x1, y1, z1,  x1, y1, z0,  x0, y1, z0); // top
        model.sort();

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (PRBMWriter writer = new PRBMWriter(out)) {
            writer.write(model);
        }
        return out.toByteArray();
    }

    /** adds a quad (two faces, both windings so culling-direction does not matter for this test) */
    private static void quad(ArrayTileModel m,
                             float ax, float ay, float az, float bx, float by, float bz,
                             float cx, float cy, float cz, float dx, float dy, float dz) {
        for (int winding = 0; winding < 2; winding++) {
            int f = m.add(2);
            m.setPositions(f, ax, ay, az, bx, by, bz, cx, cy, cz);
            m.setPositions(f + 1, ax, ay, az, cx, cy, cz, dx, dy, dz);
            for (int i = f; i < f + 2; i++) {
                m.setUvs(i, 0, 0, 1, 0, 1, 1);
                m.setAOs(i, 1, 1, 1);
                m.setColor(i, 1, 1, 1);
                m.setSunlight(i, 15);
                m.setBlocklight(i, 0);
                m.setMaterialIndex(i, 0);
                if (winding == 1) m.invertOrientation(i);
            }
        }
    }

    // --- static files ---

    private void serveStatic(HttpExchange ex, String path) throws IOException {
        if (path.equals("/")) path = "/index.html";
        Path file = webroot.resolve(path.substring(1)).normalize();
        if (!file.startsWith(webroot) || !Files.isRegularFile(file)) {
            send(ex, 404, "text/plain", "not found".getBytes(StandardCharsets.UTF_8));
            return;
        }
        send(ex, 200, contentType(file.toString()), Files.readAllBytes(file));
    }

    private static String contentType(String name) {
        if (name.endsWith(".html")) return "text/html; charset=utf-8";
        if (name.endsWith(".js")) return "application/javascript";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".json")) return "application/json";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".woff2")) return "font/woff2";
        if (name.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }

    private static void send(HttpExchange ex, int status, String type, byte[] body) throws IOException {
        ex.getResponseHeaders().set("Content-Type", type);
        ex.getResponseHeaders().set("Cache-Control", "no-cache");
        ex.sendResponseHeaders(status, body.length);
        try (OutputStream out = ex.getResponseBody()) {
            out.write(body);
        }
    }

}
