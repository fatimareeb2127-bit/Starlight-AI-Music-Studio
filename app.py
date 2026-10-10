from flask import Flask, render_template, request, jsonify, send_from_directory
from pathlib import Path
import json, random, time, re

BASE_DIR = Path(__file__).resolve().parent
GENERATED_DIR = BASE_DIR / "generated"
UPLOAD_DIR = BASE_DIR / "uploads"
GENERATED_DIR.mkdir(exist_ok=True)
UPLOAD_DIR.mkdir(exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 30 * 1024 * 1024
ALLOWED_EXTENSIONS = {".mid", ".midi"}

ENGLISH_STYLES = {"Dreamy", "Classical", "Pop", "Jazz", "Lo-fi", "Relaxing"}
INDIAN_STYLE_OPTIONS = {
    "English": "English",
    "Hindi Bollywood": "Hindi Bollywood",
    "Urdu": "Urdu",
    "Pakistani drama OST": "Pakistani drama OST",
    "Ghazal": "Ghazal",
    "Qawwali": "Qawwali",
    "Romantic Hindi/Urdu": "Romantic Hindi/Urdu",
    "Sad Hindi/Urdu": "Sad Hindi/Urdu",
    "Classical Indian-inspired music": "Classical Indian-inspired music",
}


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def read_var_length(data, index, limit):
    value = 0
    while True:
        if index >= limit:
            return 0, limit
        byte = data[index]
        index += 1
        value = (value << 7) | (byte & 0x7F)
        if not (byte & 0x80):
            return value, index


def parse_midi_events(data):
    """Parse playable note events from MIDI bytes with lenient handling for malformed metadata."""
    if len(data) < 14 or data[:4] != b"MThd":
        return []

    format_type = int.from_bytes(data[8:10], "big")
    track_count = int.from_bytes(data[10:12], "big")
    division = int.from_bytes(data[12:14], "big")
    if division == 0:
        return []

    pos = 14
    tempo = 500_000
    active = {}
    events = []

    for _ in range(track_count):
        if pos + 8 > len(data):
            break
        if data[pos:pos + 4] != b"MTrk":
            break
        length = int.from_bytes(data[pos + 4:pos + 8], "big")
        pos += 8
        track_end = pos + length
        current_tick = 0
        running_status = None

        while pos < track_end:
            if pos >= track_end:
                break
            delta = 0
            if pos >= track_end:
                break
            byte = data[pos]
            pos += 1
            delta = byte & 0x7F
            while byte & 0x80:
                if pos >= track_end:
                    pos = track_end
                    break
                byte = data[pos]
                pos += 1
                delta = (delta << 7) | (byte & 0x7F)
            current_tick += delta
            if pos >= track_end:
                break
            status = data[pos]
            if status < 0x80:
                if running_status is None:
                    break
                status = running_status
            else:
                pos += 1
                running_status = status

            if status == 0xFF:
                if pos >= track_end:
                    break
                meta_type = data[pos]
                pos += 1
                if pos >= track_end:
                    break
                meta_len, pos = read_var_length(data, pos, track_end)
                if pos + meta_len > track_end:
                    pos = track_end
                    continue
                meta_data = data[pos:pos + meta_len]
                pos += meta_len
                if meta_type == 0x51 and len(meta_data) >= 3:
                    tempo = (meta_data[0] << 16) | (meta_data[1] << 8) | meta_data[2]
                continue

            if status in (0xF0, 0xF7):
                sysex_len, pos = read_var_length(data, pos, track_end)
                if pos + sysex_len > track_end:
                    pos = track_end
                    continue
                pos += sysex_len
                continue

            if (status & 0xF0) in (0x80, 0x90, 0xA0, 0xB0, 0xE0):
                if pos + 1 >= track_end:
                    break
                param1 = data[pos]
                param2 = data[pos + 1]
                pos += 2
                note_type = status & 0xF0
                channel = status & 0x0F
                if note_type == 0x90 and param2 > 0:
                    key = (channel, param1)
                    active[key] = {"start": current_tick, "pitch": param1, "velocity": param2}
                elif note_type == 0x80 or (note_type == 0x90 and param2 == 0):
                    key = (channel, param1)
                    if key in active:
                        note_info = active.pop(key)
                        start_tick = note_info["start"]
                        duration_ticks = max(1, current_tick - start_tick)
                        if duration_ticks > 0:
                            seconds = duration_ticks * (tempo / 1_000_000) / division
                            start_seconds = start_tick * (tempo / 1_000_000) / division
                            events.append({
                                "pitch": int(param1),
                                "start": round(start_seconds, 4),
                                "duration": round(max(0.08, seconds), 4),
                                "velocity": clamp(int(note_info.get("velocity", 80)), 1, 127),
                            })

        pos = track_end

    if format_type == 1 and len(events) == 0:
        return []
    return sorted(events, key=lambda e: e["start"])


def build_midi(events, filepath, tempo=120, track_name="melody", tracks=None):
    """Write a standards-compliant MIDI file with mido.

    Accepts either a flat list of note events or a list of track objects:
    [{"name": "melody", "events": [...]}, {"name": "bass", "events": [...]}]
    """
    try:
        import mido
    except ImportError as exc:
        raise RuntimeError("MIDI export requires mido. Install requirements.txt.") from exc

    if tracks is None:
        tracks = [{"name": track_name, "events": events or []}]

    midi = mido.MidiFile(ticks_per_beat=480)
    for index, track_data in enumerate(tracks):
        midi_track = mido.MidiTrack()
        midi.tracks.append(midi_track)
        midi_track.append(mido.MetaMessage("track_name", name=str(track_data.get("name", f"track-{index+1}")), time=0))
        tempo_us = int(60_000_000 / max(40, min(220, int(tempo))))
        midi_track.append(mido.MetaMessage("set_tempo", tempo=tempo_us, time=0))
        midi_track.append(mido.Message("program_change", program=track_data.get("program", 0), channel=index % 16, time=0))

        messages = []
        for event in track_data.get("events", []):
            pitch = clamp(int(event.get("pitch", 60)), 0, 127)
            start = max(0.0, float(event.get("start", 0)))
            duration = max(0.08, float(event.get("duration", 0.35)))
            velocity = clamp(int(event.get("velocity", 85)), 1, 127)
            messages.append((round(start * 480), True, pitch, velocity))
            messages.append((round((start + duration) * 480), False, pitch, 0))
        if not messages:
            midi_track.append(mido.MetaMessage("end_of_track", time=0))
            continue
        messages.sort(key=lambda x: (x[0], x[1]))
        previous = 0
        for tick, is_on, pitch, velocity in messages:
            delta = max(0, tick - previous)
            midi_track.append(mido.Message("note_on" if is_on else "note_off",
                                          note=pitch,
                                          velocity=velocity,
                                          channel=index % 16,
                                          time=delta))
            previous = tick
        midi_track.append(mido.MetaMessage("end_of_track", time=0))

    midi.save(str(filepath))
    return str(filepath)


def make_demo_song(style="Dreamy", bars=8, tempo=112):
    """Fallback generator so the application works even without TensorFlow/model files."""
    scales = {
        "Dreamy": [0, 2, 4, 7, 9],
        "Classical": [0, 2, 4, 5, 7, 9, 11],
        "Pop": [0, 2, 4, 7, 9],
        "Jazz": [0, 2, 3, 5, 7, 9, 10],
        "Lo-fi": [0, 2, 3, 7, 9],
        "Relaxing": [0, 2, 4, 7, 9],
    }
    scale = scales.get(style, scales["Dreamy"])
    roots = [60, 65, 67, 62, 60, 65, 67, 55]
    events = []
    beat = 0.0
    for bar in range(bars):
        root = roots[bar % len(roots)]
        for interval in [0, 4, 7]:
            events.append({"pitch": root + interval, "start": beat, "duration": 1.7, "velocity": 48})
        for step in range(8):
            pitch = 72 + random.choice(scale)
            if random.random() < 0.25:
                pitch += 12
            events.append({"pitch": pitch, "start": beat + step * 0.5,
                           "duration": random.choice([0.25, 0.45, 0.7]),
                           "velocity": random.randint(62, 94)})
        beat += 4.0
    return sorted(events, key=lambda e: e["start"])


def note_in_scale(root, interval, scale):
    return root + scale[interval % len(scale)]


def derive_style_from_prompt(prompt, fallback="English"):
    text = (prompt or "").lower()
    if not text:
        return fallback
    if "ghazal" in text:
        return "Ghazal"
    if "qawwali" in text:
        return "Qawwali"
    if "ost" in text or "pakistani drama" in text or "drama" in text:
        return "Pakistani drama OST"
    if "romantic" in text or "love" in text:
        return "Romantic Hindi/Urdu"
    if "sad" in text or "melancholy" in text or "emotional" in text:
        return "Sad Hindi/Urdu"
    if "classical" in text or "rag" in text or "raga" in text:
        return "Classical Indian-inspired music"
    if "urdu" in text:
        return "Urdu"
    if "hindi" in text or "bollywood" in text or "indian" in text:
        return "Hindi Bollywood"
    return fallback


def style_to_scale(style_name):
    style = str(style_name or "English")
    scales = {
        "English": [0, 2, 4, 5, 7, 9, 11],
        "Dreamy": [0, 2, 4, 7, 9],
        "Hindi Bollywood": [0, 2, 4, 5, 7, 9, 11],
        "Urdu": [0, 1, 4, 5, 7, 8, 10],
        "Pakistani drama OST": [0, 2, 3, 5, 7, 9, 10],
        "Ghazal": [0, 1, 4, 5, 7, 8, 10],
        "Qawwali": [0, 2, 3, 5, 7, 9, 10],
        "Romantic Hindi/Urdu": [0, 2, 4, 5, 7, 9, 11],
        "Sad Hindi/Urdu": [0, 1, 4, 5, 7, 8, 10],
        "Classical Indian-inspired music": [0, 2, 4, 5, 7, 9, 11],
    }
    base = scales.get(style, scales["English"])
    return base


def style_to_tempo(style_name):
    mapping = {
        "English": 112,
        "Hindi Bollywood": 116,
        "Urdu": 82,
        "Pakistani drama OST": 92,
        "Ghazal": 78,
        "Qawwali": 104,
        "Romantic Hindi/Urdu": 88,
        "Sad Hindi/Urdu": 70,
        "Classical Indian-inspired music": 84,
    }
    return mapping.get(str(style_name or "English"), 112)


def generate_indian_style_midi(style_name, prompt, bars=8, tempo=112):
    style_name = str(style_name or "English")
    normalized = style_name.strip()
    if normalized not in INDIAN_STYLE_OPTIONS and normalized not in ENGLISH_STYLES:
        normalized = derive_style_from_prompt(prompt, "Hindi Bollywood")
    phrase_scale = style_to_scale(normalized)
    root = 57 if normalized in {"Urdu", "Pakistani drama OST", "Ghazal", "Sad Hindi/Urdu"} else 60
    if normalized in {"Hindi Bollywood", "Romantic Hindi/Urdu", "Qawwali"}:
        root = 60
    if normalized == "Classical Indian-inspired music":
        root = 57

    motif_patterns = {
        "English": [0, 2, 4, 5, 4, 2, 1, 0],
        "Hindi Bollywood": [0, 2, 4, 5, 7, 5, 4, 2],
        "Urdu": [0, 1, 4, 5, 7, 8, 7, 5],
        "Pakistani drama OST": [0, 2, 3, 5, 7, 9, 7, 5],
        "Ghazal": [0, 1, 4, 5, 7, 8, 7, 4],
        "Qawwali": [0, 2, 3, 5, 7, 5, 3, 2],
        "Romantic Hindi/Urdu": [0, 2, 4, 5, 7, 9, 7, 5],
        "Sad Hindi/Urdu": [0, 1, 4, 5, 7, 5, 4, 2],
        "Classical Indian-inspired music": [0, 2, 4, 5, 7, 9, 11, 9],
    }
    motif = motif_patterns.get(normalized, motif_patterns["English"])

    melody = []
    bass = []
    accompaniment = []
    beat = 0.0
    for bar in range(max(4, int(bars))):
        chord_root = root + (bar % 2) * 2
        for substep in range(8):
            note_index = motif[(bar + substep) % len(motif)]
            pitch = note_in_scale(root, note_index, phrase_scale)
            if normalized in {"Qawwali", "Pakistani drama OST"} and substep % 3 == 0:
                pitch += 12
            if normalized in {"Ghazal", "Sad Hindi/Urdu"} and substep in {2, 5}:
                pitch = max(40, pitch - 2)
            if normalized == "Classical Indian-inspired music" and substep % 4 == 0:
                pitch += 2
            start = beat + substep * 0.5
            duration = 0.38 if substep % 2 == 0 else 0.22
            if normalized in {"Ghazal", "Sad Hindi/Urdu"}:
                duration += 0.18
            velocity = 80 + (substep % 4) * 8 + (bar % 3) * 4
            melody.append({"pitch": int(pitch), "start": round(start, 3), "duration": round(duration, 3), "velocity": velocity})

            if substep % 2 == 0:
                bass_pitch = chord_root - 12 + (note_index % 3) * 2
                bass.append({"pitch": int(clamp(bass_pitch, 36, 75)), "start": round(start, 3), "duration": 0.9, "velocity": 55})

            if substep % 4 == 0:
                for offset in [0, 4, 7]:
                    accompaniment.append({
                        "pitch": int(clamp(chord_root + offset, 40, 95)),
                        "start": round(start, 3),
                        "duration": 1.2,
                        "velocity": 38,
                    })

        beat += 4.0

    melody = sorted(melody, key=lambda e: e["start"])
    bass = sorted(bass, key=lambda e: e["start"])
    accompaniment = sorted(accompaniment, key=lambda e: e["start"])
    return {
        "events": melody,
        "tracks": [
            {"name": "melody", "program": 0, "events": melody},
            {"name": "bass", "program": 32, "events": bass},
            {"name": "accompaniment", "program": 25, "events": accompaniment},
        ],
        "style": normalized,
        "root": root,
        "prompt": prompt,
    }


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/status")
def status():
    model_exists = any((BASE_DIR / "s2s").glob("*")) if (BASE_DIR / "s2s").exists() else False
    return jsonify({
        "ok": True,
        "lstm_model_found": model_exists,
        "message": "This version uses algorithmic music generation rather than a trained neural network."
    })


@app.post("/api/generate")
def generate():
    data = request.get_json(silent=True) or {}
    style = str(data.get("style", "Dreamy"))
    language_style = str(data.get("languageStyle") or data.get("language") or style or "English")
    prompt = str(data.get("prompt") or "")
    tempo = max(40, min(220, int(data.get("tempo", style_to_tempo(language_style)))))
    bars = max(2, min(32, int(data.get("bars", 8))))

    selected_style = language_style if language_style in INDIAN_STYLE_OPTIONS or language_style in ENGLISH_STYLES else derive_style_from_prompt(prompt, style)
    if selected_style in ENGLISH_STYLES or selected_style == "English":
        events = make_demo_song(style, bars, tempo)
        track_bundle = [{"name": "melody", "program": 0, "events": events}]
        engine = "demo-generator"
        notice = "This version uses algorithmic music generation rather than a trained neural network."
    else:
        generated = generate_indian_style_midi(selected_style, prompt, bars, tempo)
        events = generated["events"]
        track_bundle = generated["tracks"]
        engine = "algorithmic-generator"
        notice = "This version uses algorithmic music generation rather than a trained neural network, with Hindi/Urdu-inspired melodic and rhythmic patterns."

    name = f"song_{int(time.time())}.mid"
    path = GENERATED_DIR / name
    try:
        build_midi([], path, tempo, tracks=track_bundle)
        midi_url = f"/generated/{name}"
    except RuntimeError:
        midi_url = None

    return jsonify({
        "events": events,
        "tempo": tempo,
        "style": selected_style,
        "languageStyle": selected_style,
        "prompt": prompt,
        "midi_url": midi_url,
        "filename": name,
        "engine": engine,
        "notice": notice,
    })


@app.post("/api/upload")
def upload():
    file = request.files.get("midi")
    if not file or not file.filename:
        return jsonify({"error": "Choose a MIDI file first."}), 400
    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        return jsonify({"error": "Please upload a .mid or .midi file."}), 400

    safe_name = f"upload_{int(time.time())}{suffix}"
    path = UPLOAD_DIR / safe_name
    file.save(path)

    try:
        file_bytes = path.read_bytes()
        parsed_events = parse_midi_events(file_bytes)
    except Exception:
        parsed_events = []

    if parsed_events:
        return jsonify({
            "ok": True,
            "filename": safe_name,
            "events": parsed_events,
            "message": "MIDI uploaded and parsed successfully.",
        })

    return jsonify({
        "ok": True,
        "filename": safe_name,
        "message": "MIDI uploaded. Load it in the player to hear it.",
    })


@app.get("/generated/<path:filename>")
def generated_file(filename):
    return send_from_directory(GENERATED_DIR, filename, as_attachment=True)


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
