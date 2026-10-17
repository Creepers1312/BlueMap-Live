import {test} from "node:test";
import assert from "node:assert/strict";
import {readdirSync, readFileSync} from "node:fs";
import parseHocon from "hocon-parser";

const LANG = new URL("../public/lang/", import.meta.url);
const read = file => parseHocon(readFileSync(new URL(file, LANG), "utf8"));
const flat = (object, prefix = "", out = {}) => {
    for (const [key, value] of Object.entries(object || {})) {
        const path = prefix ? prefix + "." + key : key;
        if (value && typeof value === "object" && !Array.isArray(value)) flat(value, path, out);
        else out[path] = value;
    }
    return out;
};

// the texts of BlueMap Live (the original BlueMap has the other keys)
const LIVE_ROOTS = ["live.", "worldClock.", "liveIndicator.", "qualityPreset.", "lighting.worldTime."];
const english = flat(read("en.conf"));
const liveKeys = Object.keys(english).filter(key => LIVE_ROOTS.some(root => key.startsWith(root)));

test("languages: every language of settings.conf has all texts of BlueMap Live", () => {
    const settings = read("settings.conf");
    assert.ok(liveKeys.length >= 47, "live-keys: " + liveKeys.length);
    for (const {locale} of settings.languages) {
        const texts = flat(read(locale + ".conf"));
        const missing = liveKeys.filter(key => typeof texts[key] !== "string" || texts[key].trim() === "");
        assert.deepEqual(missing, [], locale);
    }
});

test("languages: all language-files can be read (no broken sections)", () => {
    for (const file of readdirSync(LANG).filter(f => f.endsWith(".conf") && f !== "settings.conf")) {
        const texts = read(file);
        for (const section of ["lighting", "live", "controls", "blockTooltip"]) {
            assert.equal(typeof texts[section], "object", `${file}: ${section}`);
        }
    }
});
