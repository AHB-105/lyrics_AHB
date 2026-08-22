import os
import json
import uuid
import subprocess
import urllib.request
import urllib.parse
from flask import Flask, request, jsonify, send_from_directory
from faster_whisper import WhisperModel

app = Flask(__name__)
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

model = None
MODEL_SIZE = "small"


@app.before_request
def load_model():
    global model
    if model is None:
        model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/app.js")
def app_js():
    return send_from_directory(".", "app.js")


@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.route("/upload", methods=["POST"])
def upload():
    f = request.files.get("audio")
    if not f:
        return jsonify({"error": "No file"}), 400
    ext = os.path.splitext(f.filename)[1] or ".mp3"
    name = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, name)
    f.save(path)
    return jsonify({"id": name, "filename": f.filename})


@app.route("/youtube", methods=["POST"])
def youtube_download():
    data = request.get_json()
    url = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "No URL"}), 400

    name = uuid.uuid4().hex + ".mp3"
    out_path = os.path.join(UPLOAD_DIR, name)

    try:
        result = subprocess.run(
            [
                "yt-dlp",
                "--js-runtimes", "node",
                "-x", "--audio-format", "mp3",
                "--no-playlist",
                "-o", out_path,
                url,
            ],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            return jsonify({"error": "Download failed", "details": result.stderr[-500:]}), 400
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Download timed out"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # yt-dlp may add the extension, find the actual file
    if not os.path.exists(out_path):
        for f in os.listdir(UPLOAD_DIR):
            if f.startswith(name.replace(".mp3", "")):
                out_path = os.path.join(UPLOAD_DIR, f)
                name = f
                break

    # Get title from yt-dlp
    title = "YouTube Audio"
    try:
        info = subprocess.run(
            ["yt-dlp", "--js-runtimes", "nodejs", "--get-title", "--no-playlist", url],
            capture_output=True, text=True, timeout=15,
        )
        if info.returncode == 0 and info.stdout.strip():
            title = info.stdout.strip()
    except Exception:
        pass

    return jsonify({"id": name, "filename": title})


@app.route("/lyrics", methods=["GET"])
def lyrics():
    title = request.args.get("title", "").strip()
    artist = request.args.get("artist", "").strip()
    if not title:
        return jsonify({"error": "No title"}), 400

    params = {"track_name": title}
    if artist:
        params["artist_name"] = artist
    url = "https://lrclib.net/api/search?" + urllib.parse.urlencode(params)

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "LyricsKaraoke/1.0 (local project)"})
        with urllib.request.urlopen(req, timeout=15) as r:
            results = json.loads(r.read())
    except Exception as e:
        return jsonify({"error": f"lrclib request failed: {e}"}), 502

    if not results:
        return jsonify({"error": "No lyrics found", "results": []}), 404

    # prefer a result with synced lyrics, else plain
    best = next((r for r in results if r.get("syncedLyrics")), None) or next((r for r in results if r.get("plainLyrics")), None)
    if not best:
        return jsonify({"error": "No lyrics content"}), 404

    return jsonify({
        "trackName": best.get("trackName"),
        "artistName": best.get("artistName"),
        "syncedLyrics": best.get("syncedLyrics"),
        "plainLyrics": best.get("plainLyrics"),
    })


@app.route("/transcribe/<file_id>", methods=["POST"])
def transcribe(file_id):
    path = os.path.join(UPLOAD_DIR, file_id)
    if not os.path.exists(path):
        return jsonify({"error": "File not found"}), 404

    data = request.get_json(silent=True) or {}
    language = data.get("language", "en")

    segments, info = model.transcribe(
        path,
        word_timestamps=True,
        language=language if language != "auto" else None,
        condition_on_previous_text=True,
    )

    words = []
    for seg in segments:
        for w in seg.words:
            words.append({
                "word": w.word.strip(),
                "start": round(w.start, 3),
                "end": round(w.end, 3),
            })

    return jsonify({"words": words, "language": info.language})


if __name__ == "__main__":
    print(f"Loading Whisper model ({MODEL_SIZE})...")
    model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
    print("Model loaded. Starting server on http://localhost:5000")
    app.run(port=5000, debug=False)
