import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Temporary tool (model-dump branch only): dumps vanilla entity model data to json, via reflection. */
public class ModelDump {

    public static void main(String[] args) throws Exception {
        Path out = Paths.get(args[0]);
        Files.createDirectories(out);
        try { Class.forName("net.minecraft.SharedConstants").getMethod("createGameVersion").invoke(null); }
        catch (Throwable t) { System.out.println("createGameVersion: " + t); }
        try { Class.forName("net.minecraft.Bootstrap").getMethod("initialize").invoke(null); }
        catch (Throwable t) { System.out.println("Bootstrap: " + t); }

        Map<?, ?> models = (Map<?, ?>) Class.forName("net.minecraft.client.render.entity.model.EntityModels")
                .getMethod("getModels").invoke(null);
        System.out.println("layers: " + models.size());

        TreeMap<String, Object> sorted = new TreeMap<>();
        for (Map.Entry<?, ?> e : models.entrySet()) sorted.put(e.getKey().toString(), e.getValue());

        try (Writer raw = Files.newBufferedWriter(out.resolve("raw.json"), StandardCharsets.UTF_8);
             Writer baked = Files.newBufferedWriter(out.resolve("baked.json"), StandardCharsets.UTF_8)) {
            raw.write("{\n"); baked.write("{\n");
            boolean first = true;
            for (Map.Entry<String, Object> e : sorted.entrySet()) {
                Object tmd = e.getValue();
                if (!first) { raw.write(",\n"); baked.write(",\n"); }
                first = false;
                raw.write(quote(e.getKey()) + ":"); write(raw, tmd, new IdentityHashMap<>(), 0);
                Object part;
                try { part = tmd.getClass().getMethod("createModel").invoke(tmd); }
                catch (Throwable t) { part = "error: " + t; }
                baked.write(quote(e.getKey()) + ":"); write(baked, part, new IdentityHashMap<>(), 0);
            }
            raw.write("\n}\n"); baked.write("\n}\n");
        }
    }

    static void write(Writer w, Object o, IdentityHashMap<Object, Boolean> seen, int depth) throws IOException {
        if (o == null) { w.write("null"); return; }
        if (o instanceof Number n) {
            double d = n.doubleValue();
            if (Double.isFinite(d)) w.write(o instanceof Float || o instanceof Double ? Float.toString(n.floatValue()) : n.toString());
            else w.write(quote(n.toString()));
            return;
        }
        if (o instanceof Boolean || o instanceof Character) { w.write(o instanceof Boolean ? o.toString() : quote(o.toString())); return; }
        if (o instanceof CharSequence) { w.write(quote(o.toString())); return; }
        if (o instanceof Enum<?> en) { w.write(quote(en.name())); return; }
        if (depth > 40 || seen.containsKey(o)) { w.write(quote("<ref " + o.getClass().getSimpleName() + ">")); return; }
        seen.put(o, true);
        try {
            if (o.getClass().isArray()) {
                w.write("["); int len = Array.getLength(o);
                for (int i = 0; i < len; i++) { if (i > 0) w.write(","); write(w, Array.get(o, i), seen, depth + 1); }
                w.write("]"); return;
            }
            if (o instanceof Map<?, ?> m) {
                w.write("{"); boolean f = true;
                for (Map.Entry<?, ?> e : m.entrySet()) {
                    if (!f) w.write(","); f = false;
                    w.write(quote(String.valueOf(e.getKey())) + ":"); write(w, e.getValue(), seen, depth + 1);
                }
                w.write("}"); return;
            }
            if (o instanceof Collection<?> c) {
                w.write("["); boolean f = true;
                for (Object x : c) { if (!f) w.write(","); f = false; write(w, x, seen, depth + 1); }
                w.write("]"); return;
            }
            if (o.getClass().getName().startsWith("java.")) { w.write(quote(o.toString())); return; }
            w.write("{\"$class\":" + quote(o.getClass().getName()));
            for (Class<?> c = o.getClass(); c != null && c != Object.class; c = c.getSuperclass()) {
                for (Field f : c.getDeclaredFields()) {
                    if (Modifier.isStatic(f.getModifiers())) continue;
                    Object v;
                    try { f.setAccessible(true); v = f.get(o); } catch (Throwable t) { v = "<inaccessible>"; }
                    w.write("," + quote(f.getName()) + ":"); write(w, v, seen, depth + 1);
                }
            }
            w.write("}");
        } finally {
            seen.remove(o);
        }
    }

    static String quote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }
}
