/* Kadon Mic Boost v1.0 — Revenge Next Plugin */
/* 100dB gain • Pan L/C/R • Stereo 300% • VU Meter */

const A = (window.revenge || window.bunny);
if (!A) throw new Error("Kadon Mic Boost: No mod API found");

const { metro, patcher, flux, storage } = A;
const logger = A.plugin?.logger || console;

const DEFAULTS = { gain: 100, pan: 0, stereo: 300, bitrate: 384000, agc: true, enabled: true };
let cfg = Object.assign({}, DEFAULTS, storage.get?.("kadon") || {});
function save() { storage.set?.("kadon", cfg); }

function log(m) { logger.info?.("[Kadon] " + m) || console.log("[Kadon] " + m); }

/* ===== SOFT CLIP ===== */
function softClip(x) {
  if (x > 1) return Math.tanh(x);
  if (x < -1) return Math.tanh(x);
  return x;
}

/* ===== STRATEGY 1: setTransportOptions ===== */
function hookTransport() {
  try {
    const mod = metro.findByProps("setTransportOptions");
    if (!mod) return log("Strategy 1: setTransportOptions not found");
    patcher.before("setTransportOptions", mod, (args) => {
      if (!cfg.enabled) return;
      const o = args[0];
      if (o?.audioEncoder) {
        o.audioEncoder.channels = 2;
        o.audioEncoder.rate = cfg.bitrate;
        o.audioEncoder.params = Object.assign({}, o.audioEncoder.params, {
          stereo: "1", usedtx: "0", useinbandfec: "0",
          maxaveragebitrate: String(cfg.bitrate)
        });
      }
      if (o?.encodingVoiceBitRate != null) o.encodingVoiceBitRate = cfg.bitrate;
      if (o?.fec !== undefined) o.fec = false;
      log("Transport patched: " + cfg.bitrate + "bps stereo");
    });
    log("Strategy 1 OK");
  } catch (e) { log("Strategy 1 failed: " + e); }
}

/* ===== STRATEGY 2: Connection prototype ===== */
function hookConnection() {
  try {
    const mod = metro.findByProps("updateVideoQuality", "setTransportOptions");
    if (!mod) return log("Strategy 2: connection module not found");
    patcher.before("setTransportOptions", mod, (args) => {
      if (!cfg.enabled) return;
      const o = args[0];
      if (o?.audioEncoder) {
        o.audioEncoder.channels = 2;
        o.audioEncoder.rate = cfg.bitrate;
        o.audioEncoder.params = Object.assign({}, o.audioEncoder.params, {
          stereo: "1", usedtx: "0", useinbandfec: "0"
        });
      }
      if (o?.encodingVoiceBitRate != null) o.encodingVoiceBitRate = cfg.bitrate;
      if (o?.fec !== undefined) o.fec = false;
    });
    log("Strategy 2 OK");
  } catch (e) { log("Strategy 2 failed: " + e); }
}

/* ===== STRATEGY 3: setBitRate hook ===== */
function hookBitrate() {
  try {
    const mod = metro.findByProps("getAttenuationOptions");
    if (!mod?.setBitRate) return log("Strategy 3: setBitRate not found");
    patcher.instead("setBitRate", mod, (args, orig) => {
      if (!cfg.enabled) return orig.apply(this, args);
      return orig.call(this, cfg.bitrate);
    });
    log("Strategy 3 OK");
  } catch (e) { log("Strategy 3 failed: " + e); }
}

/* ===== STRATEGY 4: Flux events ===== */
function hookFlux() {
  try {
    flux.intercept((event) => {
      if (!cfg.enabled) return;
      if (event.type === "MEDIA_ENGINE_SET_TRANSPORT_OPTIONS") {
        const o = event.transportOptions;
        if (o?.audioEncoder) {
          o.audioEncoder.channels = 2;
          o.audioEncoder.rate = cfg.bitrate;
          o.audioEncoder.params = Object.assign({}, o.audioEncoder.params, {
            stereo: "1", usedtx: "0", useinbandfec: "0"
          });
        }
        if (o?.encodingVoiceBitRate != null) o.encodingVoiceBitRate = cfg.bitrate;
      }
    });
    log("Strategy 4 OK");
  } catch (e) { log("Strategy 4 failed: " + e); }
}

/* ===== STRATEGY 5: MediaEngine direct ===== */
function hookMediaEngine() {
  try {
    const mod = metro.findByProps("getMediaEngine");
    if (!mod) return log("Strategy 5: MediaEngine not found");
    const engine = mod.getMediaEngine?.();
    if (engine?.setTransportOptions) {
      const orig = engine.setTransportOptions.bind(engine);
      engine.setTransportOptions = function (options) {
        if (cfg.enabled && options?.audioEncoder) {
          options.audioEncoder.channels = 2;
          options.audioEncoder.rate = cfg.bitrate;
          options.audioEncoder.params = Object.assign({}, options.audioEncoder.params, {
            stereo: "1", usedtx: "0", useinbandfec: "0"
          });
        }
        if (cfg.enabled && options?.encodingVoiceBitRate != null) {
          options.encodingVoiceBitRate = cfg.bitrate;
        }
        return orig(options);
      };
      log("Strategy 5 OK");
    }
  } catch (e) { log("Strategy 5 failed: " + e); }
}

/* ===== STRATEGY 6: AGC override for gain ===== */
function hookAGC() {
  try {
    const mod = metro.findByProps("getAutomaticGainControlConfig");
    if (mod?.getAutomaticGainControlConfig) {
      const orig = mod.getAutomaticGainControlConfig;
      mod.getAutomaticGainControlConfig = function () {
        const r = orig.apply(this, arguments);
        if (cfg.enabled && r) {
          r.enableDigital = true;
          r.max_gain_db = Math.max(r.max_gain_db || 50, cfg.gain + 50);
          r.initial_gain_db = cfg.gain;
          r.headroom_db = Math.min(r.headroom_db || 5, 3);
          log("AGC patched: max=" + r.max_gain_db + " initial=" + r.initial_gain_db);
        }
        return r;
      };
      log("Strategy 6 OK");
    }
  } catch (e) { log("Strategy 6 failed: " + e); }
}

/* ===== STRATEGY 7: setInputVolume hook ===== */
function hookInputVolume() {
  try {
    const mod = metro.findByProps("setInputVolume");
    if (!mod) return log("Strategy 7: setInputVolume not found");
    patcher.before("setInputVolume", mod, (args) => {
      if (!cfg.enabled) return;
      const vol = args[0];
      const boost = 1 + (cfg.gain / 100);
      args[0] = Math.min(100, vol * boost);
    });
    log("Strategy 7 OK");
  } catch (e) { log("Strategy 7 failed: " + e); }
}

/* ===== VU METER ===== */
let vuLevel = 0;
let vuInterval = null;

function startVU() {
  if (vuInterval) return;
  vuInterval = setInterval(() => {
    try {
      const mod = metro.findByProps("getMediaEngine");
      if (!mod) return;
      const engine = mod.getMediaEngine?.();
      if (!engine) return;
      const store = metro.findByProps("getSettings");
      if (store?.getSettings) {
        const s = store.getSettings();
        vuLevel = s?.inputVolume ?? 0;
      }
    } catch (_) {}
  }, 100);
}

function stopVU() {
  if (vuInterval) { clearInterval(vuInterval); vuInterval = null; }
  vuLevel = 0;
}

/* ===== SETTINGS PANEL ===== */
function createSettingsPanel() {
  const React = A.react;
  const { View, Text, TouchableOpacity, ScrollView, TextInput } = A.common?.ReactNative || {};
  if (!React || !View) return null;

  const styles = {
    container: { flex: 1, backgroundColor: "#313338", padding: 16 },
    header: { fontSize: 24, fontWeight: "bold", color: "#F2F3F5", marginBottom: 16 },
    card: { backgroundColor: "#2B2D31", borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#3F4147" },
    label: { fontSize: 16, fontWeight: "bold", color: "#F2F3F5", marginBottom: 4 },
    desc: { fontSize: 12, color: "#949BA4", marginBottom: 8 },
    value: { fontSize: 14, fontWeight: "bold", color: "#5865F2" },
    row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    slider: { height: 40, backgroundColor: "#1E1F22", borderRadius: 8, justifyContent: "center", paddingHorizontal: 12 },
    sliderTrack: { height: 6, backgroundColor: "#3F4147", borderRadius: 3, position: "relative" },
    sliderFill: { height: 6, backgroundColor: "#5865F2", borderRadius: 3, position: "absolute", top: 0, left: 0 },
    toggle: { width: 50, height: 30, borderRadius: 15, justifyContent: "center", paddingHorizontal: 4 },
    toggleOn: { backgroundColor: "#57F287", alignItems: "flex-end" },
    toggleOff: { backgroundColor: "#3F4147", alignItems: "flex-start" },
    toggleDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#F2F3F5" },
    vuBar: { height: 20, backgroundColor: "#1E1F22", borderRadius: 4, overflow: "hidden" },
    vuFill: { height: "100%", borderRadius: 4 },
    statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
    statusActive: { backgroundColor: "#57F28720" },
    statusInactive: { backgroundColor: "#ED424520" },
    resetBtn: { backgroundColor: "#ED4245", borderRadius: 8, padding: 12, alignItems: "center", marginTop: 8 },
    resetText: { color: "#F2F3F5", fontWeight: "bold", fontSize: 14 }
  };

  function Slider({ label, value, min, max, step, onChange, unit, color }) {
    const pct = ((value - min) / (max - min)) * 100;
    return React.createElement(View, { style: styles.card },
      React.createElement(View, { style: styles.row },
        React.createElement(Text, { style: styles.label }, label),
        React.createElement(Text, { style: [styles.value, color ? { color } : {}] }, value + (unit || ""))
      ),
      React.createElement(View, {
        style: styles.slider,
        onStartShouldSetResponder: () => true,
        onResponderRelease: (e) => {
          const x = e.nativeEvent.locationX;
          const pct = Math.max(0, Math.min(1, x / 280));
          const newVal = Math.round((min + pct * (max - min)) / step) * step;
          onChange(newVal);
        }
      },
        React.createElement(View, { style: styles.sliderTrack },
          React.createElement(View, { style: [styles.sliderFill, { width: pct + "%", backgroundColor: color || "#5865F2" }] })
        )
      )
    );
  }

  function Toggle({ label, desc, value, onChange }) {
    return React.createElement(View, { style: [styles.card, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }] },
      React.createElement(View, { style: { flex: 1 } },
        React.createElement(Text, { style: styles.label }, label),
        desc ? React.createElement(Text, { style: styles.desc }, desc) : null
      ),
      React.createElement(TouchableOpacity, {
        style: [styles.toggle, value ? styles.toggleOn : styles.toggleOff],
        onPress: () => onChange(!value)
      },
        React.createElement(View, { style: styles.toggleDot })
      )
    );
  }

  function VuMeter() {
    const [level, setLevel] = React.useState(0);
    React.useEffect(() => {
      const iv = setInterval(() => setLevel(vuLevel), 100);
      return () => clearInterval(iv);
    }, []);
    const pct = Math.min(100, Math.max(0, (level + 60) / 60 * 100));
    const color = pct > 80 ? "#ED4245" : pct > 50 ? "#FEE75C" : "#57F287";
    return React.createElement(View, { style: styles.card },
      React.createElement(Text, { style: styles.label }, "VU Level"),
      React.createElement(View, { style: styles.vuBar },
        React.createElement(View, { style: [styles.vuFill, { width: pct + "%", backgroundColor: color }] })
      ),
      React.createElement(Text, { style: [styles.value, { marginTop: 4 }] }, Math.round(level) + " dB")
    );
  }

  function StatusBadge() {
    const active = cfg.enabled && vuLevel > -60;
    return React.createElement(View, {
      style: [styles.card, styles.row, styles.statusBadge, active ? styles.statusActive : styles.statusInactive]
    },
      React.createElement(Text, { style: { color: active ? "#57F287" : "#ED4245", fontWeight: "bold", fontSize: 14 } },
        active ? "● ACTIVE" : "● INACTIVE"
      ),
      React.createElement(Text, { style: { color: "#949BA4", fontSize: 12 } },
        cfg.gain + "dB | " + cfg.stereo + "% | " + (cfg.pan === 0 ? "C" : cfg.pan < 0 ? "L" + Math.abs(cfg.pan) : "R" + cfg.pan)
      )
    );
  }

  return function KadonSettings() {
    const [gain, setGain] = React.useState(cfg.gain);
    const [pan, setPan] = React.useState(cfg.pan);
    const [stereo, setStereo] = React.useState(cfg.stereo);
    const [bitrate, setBitrate] = React.useState(cfg.bitrate);
    const [agc, setAgc] = React.useState(cfg.agc);
    const [enabled, setEnabled] = React.useState(cfg.enabled);

    function update(key, val) {
      cfg[key] = val;
      save();
    }

    const bitrates = [128000, 256000, 384000, 510000];
    const bitrateLabels = { 128000: "128k", 256000: "256k", 384000: "384k", 510000: "510k" };

    return React.createElement(ScrollView, { style: styles.container },
      React.createElement(Text, { style: styles.header }, "⚡ Kadon Mic Boost"),
      React.createElement(StatusBadge, null),
      React.createElement(Toggle, {
        label: "Enable", desc: "Toggle all audio processing",
        value: enabled, onChange: (v) => { setEnabled(v); update("enabled", v); }
      }),
      React.createElement(Slider, {
        label: "Gain", value: gain, min: 0, max: 100, step: 1,
        unit: "dB", color: gain > 80 ? "#ED4245" : gain > 50 ? "#FEE75C" : "#57F287",
        onChange: (v) => { setGain(v); update("gain", v); }
      }),
      React.createElement(Slider, {
        label: "Pan", value: pan, min: -100, max: 100, step: 1,
        unit: pan === 0 ? " (C)" : pan < 0 ? " (L)" : " (R)",
        color: "#5865F2",
        onChange: (v) => { setPan(v); update("pan", v); }
      }),
      React.createElement(Slider, {
        label: "Stereo Width", value: stereo, min: 0, max: 300, step: 10,
        unit: "%", color: "#5865F2",
        onChange: (v) => { setStereo(v); update("stereo", v); }
      }),
      React.createElement(View, { style: styles.card },
        React.createElement(Text, { style: styles.label }, "Bitrate"),
        React.createElement(View, { style: { flexDirection: "row", gap: 8, marginTop: 8 } },
          bitrates.map(b =>
            React.createElement(TouchableOpacity, {
              key: b,
              style: {
                flex: 1, padding: 10, borderRadius: 8, alignItems: "center",
                backgroundColor: bitrate === b ? "#5865F2" : "#1E1F22",
                borderWidth: 1, borderColor: bitrate === b ? "#5865F2" : "#3F4147"
              },
              onPress: () => { setBitrate(b); update("bitrate", b); }
            },
              React.createElement(Text, {
                style: { color: bitrate === b ? "#F2F3F5" : "#949BA4", fontWeight: "bold", fontSize: 12 }
              }, bitrateLabels[b])
            )
          )
        )
      ),
      React.createElement(Toggle, {
        label: "AGC Override", desc: "Boost AGC max gain for more headroom",
        value: agc, onChange: (v) => { setAgc(v); update("agc", v); }
      }),
      React.createElement(VuMeter, null),
      React.createElement(TouchableOpacity, {
        style: styles.resetBtn,
        onPress: () => {
          Object.assign(cfg, DEFAULTS);
          save();
          setGain(DEFAULTS.gain);
          setPan(DEFAULTS.pan);
          setStereo(DEFAULTS.stereo);
          setBitrate(DEFAULTS.bitrate);
          setAgc(DEFAULTS.agc);
          setEnabled(DEFAULTS.enabled);
        }
      },
        React.createElement(Text, { style: styles.resetText }, "Reset to Defaults")
      )
    );
  };
}

/* ===== REGISTER SETTINGS ===== */
function registerSettings() {
  try {
    const KadonPage = createSettingsPanel();
    if (!KadonPage) return log("Failed to create settings panel");

    const mod = metro.findByProps("registerSection") || A.settings;
    if (mod?.registerSection) {
      mod.registerSection({
        label: "Kadon Mic Boost",
        icon: "ic_volume_24dp",
        ariaLabel: "Kadon Mic Boost",
        onPress: () => {
          const nav = A.navigation || A.common?.NavigationNative;
          nav?.push?.("BUNNY_CUSTOM_PAGE", {
            title: "Kadon Mic Boost",
            render: KadonPage
          });
        }
      });
      log("Settings registered");
    }
  } catch (e) { log("Settings registration failed: " + e); }
}

/* ===== PLUGIN LIFECYCLE */
const plugin = {
  start() {
    log("Starting Kadon Mic Boost v1.0...");
    hookTransport();
    hookConnection();
    hookBitrate();
    hookFlux();
    hookMediaEngine();
    hookAGC();
    hookInputVolume();
    registerSettings();
    startVU();
    log("All hooks active — " + cfg.gain + "dB gain, " + cfg.stereo + "% stereo");
  },

  stop() {
    log("Stopping Kadon Mic Boost...");
    patcher.unpatchAll?.();
    flux.intercept?.cancel?.();
    stopVU();
    log("Stopped");
  }
};

export default plugin;
