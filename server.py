import os
import json
import uuid
import subprocess
import urllib.request
import urllib.parse
import whisper
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__)

_whisper_model = None

THEMES = {"1": "crimson", "2": "emerald"}
_INDEX_TEMPLATE = None


def get_index_template():
    global _INDEX_TEMPLATE
    if _INDEX_TEMPLATE is None:
        base = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(base, "index.html"), "r", encoding="utf-8") as fh:
            _INDEX_TEMPLATE = fh.read()
    return _INDEX_TEMPLATE


def themed_index(theme):
    html = get_index_template()
    html = html.replace("<html lang=\"en\">", "<html lang=\"en\" data-theme=\"{0}\">".format(theme), 1)
    html = html.replace("</head>", "<link rel=\"stylesheet\" href=\"/themes.css\">\n</head>", 1)
    return html


def get_whisper():
    global _whisper_model
    if _whisper_model is None:
        print("Loading Whisper model (base)...", flush=True)
        _whisper_model = whisper.load_model("base")
        print("Whisper model loaded.", flush=True)
    return _whisper_model
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/1")
def index_crimson():
    return themed_index(THEMES["1"])


@app.route("/2")
def index_emerald():
    return themed_index(THEMES["2"])


@app.route("/themes.css")
def serve_themes():
    return send_from_directory(".", "themes.css")


@app.route("/app.js")
def app_js():
    return send_from_directory(".", "app.js")


@app.route("/fonts/<path:filename>")
def serve_font(filename):
    return send_from_directory(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts"), filename)


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

    uid = uuid.uuid4().hex
    out_pattern = os.path.join(UPLOAD_DIR, uid + ".%(ext)s")

    try:
        result = subprocess.run(
            [
                "yt-dlp",
                "-f", "bestaudio/best",
                "--no-playlist",
                "-o", out_pattern,
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

    name = None
    for f in os.listdir(UPLOAD_DIR):
        if f.startswith(uid):
            name = f
            break
    if not name:
        return jsonify({"error": "File not found after download"}), 500

    title = "YouTube Audio"
    try:
        info = subprocess.run(
            ["yt-dlp", "--get-title", "--no-playlist", url],
            capture_output=True, text=True, timeout=15,
        )
        if info.returncode == 0 and info.stdout.strip():
            title = info.stdout.strip()
    except Exception:
        pass

    return jsonify({"id": name, "filename": title})


@app.route("/transcribe", methods=["POST"])
def transcribe():
    data = request.get_json()
    filepath = data.get("filepath", "").strip()
    language = data.get("language", "auto")

    full_path = os.path.join(UPLOAD_DIR, filepath)
    if not os.path.exists(full_path):
        return jsonify({"error": "File not found"}), 404

    try:
        model = get_whisper()
        opts = {}
        if language and language != "auto":
            opts["language"] = language
        result = model.transcribe(full_path, word_timestamps=True, **opts)

        words = []
        for seg in result.get("segments", []):
            for w in seg.get("words", []):
                words.append({
                    "word": w["word"].strip(),
                    "start": round(w["start"], 3),
                    "end": round(w["end"], 3),
                })

        return jsonify({
            "words": words,
            "language": result.get("language", "en"),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


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

    best = next((r for r in results if r.get("syncedLyrics")), None) or next((r for r in results if r.get("plainLyrics")), None)
    if not best:
        return jsonify({"error": "No lyrics content"}), 404

    return jsonify({
        "trackName": best.get("trackName"),
        "artistName": best.get("artistName"),
        "syncedLyrics": best.get("syncedLyrics"),
        "plainLyrics": best.get("plainLyrics"),
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"Starting server on http://0.0.0.0:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
