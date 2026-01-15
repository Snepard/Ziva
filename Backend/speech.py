import json
import os
import sys
import wave
import zipfile
from pathlib import Path
from urllib.request import urlretrieve

import vosk
from piper.config import SynthesisConfig
from piper.download_voices import download_voice
from piper.voice import PiperVoice


_PIPER_VOICE_CACHE: dict[tuple[str, str], PiperVoice] = {}
_VOSK_MODEL: vosk.Model | None = None


def _get_env_float(name: str) -> float | None:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return None
    try:
        return float(raw)
    except ValueError:
        raise ValueError(f"Invalid float for {name}: {raw!r}")


def _get_env_int(name: str) -> int | None:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return None
    try:
        return int(raw)
    except ValueError:
        raise ValueError(f"Invalid int for {name}: {raw!r}")


def _build_synthesis_config(style: str | None = None, speaker_id: int | None = None) -> SynthesisConfig | None:
    """Build Piper SynthesisConfig.

    Piper exposes prosody controls through SynthesisConfig:
    - length_scale: < 1.0 = faster, > 1.0 = slower
    - noise_scale/noise_w_scale: higher can sound more expressive, too high sounds noisy

    Precedence:
    1) Explicit style preset (cheerful)
    2) Env overrides (PIPER_LENGTH_SCALE / PIPER_NOISE_SCALE / PIPER_NOISE_W_SCALE / PIPER_VOLUME)
    3) None -> use model defaults
    """

    style = (style or os.getenv("PIPER_TTS_STYLE") or "default").strip().lower()

    # Preset defaults (tuned to be a bit brighter/less robotic without sounding noisy).
    preset: dict[str, float] = {}
    if style == "cheerful":
        preset = {
            "length_scale": 0.88,
            "noise_scale": 0.80,
            "noise_w_scale": 0.90,
            "volume": 1.05,
        }
    elif style in ("default", "", "none"):
        preset = {}
    else:
        # Unknown style -> fall back to defaults
        preset = {}

    # Env overrides (take precedence over preset)
    env_speaker_id = _get_env_int("PIPER_SPEAKER_ID")
    length_scale = _get_env_float("PIPER_LENGTH_SCALE")
    noise_scale = _get_env_float("PIPER_NOISE_SCALE")
    noise_w_scale = _get_env_float("PIPER_NOISE_W_SCALE")
    volume = _get_env_float("PIPER_VOLUME")

    final_speaker_id = speaker_id if speaker_id is not None else env_speaker_id

    # If nothing is set, return None to keep Piper defaults.
    if (
        final_speaker_id is None
        and not preset
        and all(v is None for v in (length_scale, noise_scale, noise_w_scale, volume))
    ):
        return None

    return SynthesisConfig(
        speaker_id=final_speaker_id,
        length_scale=length_scale if length_scale is not None else preset.get("length_scale"),
        noise_scale=noise_scale if noise_scale is not None else preset.get("noise_scale"),
        noise_w_scale=noise_w_scale if noise_w_scale is not None else preset.get("noise_w_scale"),
        normalize_audio=True,
        volume=volume if volume is not None else preset.get("volume", 1.0),
    )


def _ensure_vosk_model() -> str:
    """Return a usable Vosk model directory path.

    Priority:
    1) VOSK_MODEL_PATH env var
    2) ./models/vosk-model-small-en-us-0.15

    If missing, optionally downloads a small English model when VOSK_AUTO_DOWNLOAD=1.
    """
    env_path = os.getenv("VOSK_MODEL_PATH")
    if env_path:
        p = Path(env_path)
        if p.exists() and p.is_dir():
            return str(p)
        raise FileNotFoundError(f"VOSK_MODEL_PATH points to missing directory: {p}")

    local_path = Path(__file__).parent / "models" / "vosk-model-small-en-us-0.15"
    if local_path.exists() and local_path.is_dir():
        return str(local_path)

    if os.getenv("VOSK_AUTO_DOWNLOAD", "1") != "1":
        raise FileNotFoundError(
            "Vosk model not found. Set VOSK_MODEL_PATH or place model at Backend/models/vosk-model-small-en-us-0.15. "
            "To auto-download on first run, set VOSK_AUTO_DOWNLOAD=1."
        )

    models_dir = Path(__file__).parent / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    zip_path = models_dir / "vosk-model-small-en-us-0.15.zip"
    url = os.getenv(
        "VOSK_MODEL_URL",
        "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip",
    )
    if not zip_path.exists():
        urlretrieve(url, zip_path)

    def _extract_zip() -> None:
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(models_dir)

    try:
        _extract_zip()
    except zipfile.BadZipFile:
        # Partial/corrupted download (or HTML error page). Retry once.
        try:
            zip_path.unlink(missing_ok=True)
        except Exception:
            pass
        urlretrieve(url, zip_path)
        _extract_zip()

    if local_path.exists() and local_path.is_dir():
        return str(local_path)

    raise FileNotFoundError("Vosk model download/extract did not produce expected directory.")


def _ensure_piper_voice(voice_override: str | None = None) -> tuple[str, str]:
    """Ensure Piper voice model + config exist, return (onnx_path, json_path).

    Voice priority:
    1) voice_override (when provided)
    2) PIPER_VOICE env var
    3) en_US-amy-low
    """
    voice = (voice_override or os.getenv("PIPER_VOICE") or "en_US-amy-low").strip()
    models_dir = Path(os.getenv("PIPER_MODELS_DIR", Path(__file__).parent / "models" / "piper"))
    models_dir.mkdir(parents=True, exist_ok=True)

    onnx_path = models_dir / f"{voice}.onnx"
    json_path = models_dir / f"{voice}.onnx.json"
    if onnx_path.exists() and json_path.exists():
        return str(onnx_path), str(json_path)

    if os.getenv("PIPER_AUTO_DOWNLOAD", "1") == "1":
        download_voice(voice, models_dir)
        if onnx_path.exists() and json_path.exists():
            return str(onnx_path), str(json_path)

    raise FileNotFoundError(
        f"Piper voice not found. Expected {onnx_path} and {json_path}. "
        "Set PIPER_VOICE/PIPER_MODELS_DIR or set PIPER_AUTO_DOWNLOAD=1."
    )


def tts(
    text: str,
    output_path: str,
    voice: str | None = None,
    style: str | None = None,
    speaker_id: int | None = None,
) -> str:
    """Piper TTS output (realistic, offline, free).

    Outputs WAV.
    """
    onnx_path, json_path = _ensure_piper_voice(voice_override=voice)

    cache_key = (onnx_path, json_path)
    piper_voice = _PIPER_VOICE_CACHE.get(cache_key)
    if piper_voice is None:
        piper_voice = PiperVoice.load(onnx_path, config_path=json_path)
        _PIPER_VOICE_CACHE[cache_key] = piper_voice

    syn_config = _build_synthesis_config(style=style, speaker_id=speaker_id)
    with wave.open(str(output_path), "wb") as wav_file:
        piper_voice.synthesize_wav(text, wav_file, syn_config=syn_config)
    return str(output_path)


def stt(audio_path: str) -> str:
    """Vosk STT.

    Expects WAV mono PCM 16-bit.
    """
    global _VOSK_MODEL
    if _VOSK_MODEL is None:
        model_dir = _ensure_vosk_model()
        _VOSK_MODEL = vosk.Model(model_dir)
    model = _VOSK_MODEL

    with wave.open(audio_path, "rb") as wf:
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getcomptype() != "NONE":
            return "STT error: Audio must be WAV mono PCM 16-bit."

        rec = vosk.KaldiRecognizer(model, wf.getframerate())
        chunks = []
        while True:
            data = wf.readframes(4000)
            if not data:
                break
            if rec.AcceptWaveform(data):
                chunks.append(json.loads(rec.Result()).get("text", ""))
        chunks.append(json.loads(rec.FinalResult()).get("text", ""))

    text = " ".join([c for c in chunks if c]).strip()
    return text if text else "Could not understand audio"


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "tts":
        text = sys.argv[2]
        output_path = sys.argv[3]
        voice = sys.argv[4] if len(sys.argv) > 4 else None
        style = sys.argv[5] if len(sys.argv) > 5 else None
        speaker_id = int(sys.argv[6]) if len(sys.argv) > 6 and sys.argv[6] != "" else None
        tts(text, output_path, voice=voice, style=style, speaker_id=speaker_id)
    elif mode == "stt":
        audio_path = sys.argv[2]
        print(stt(audio_path))
    elif mode == "warmup":
        # Pre-fetch models so the first real request is fast.
        _ensure_piper_voice()
        _ensure_vosk_model()
        print("OK")
    elif mode == "serve":
        # Simple JSONL RPC server on stdin/stdout.
        # Each line in: {"id":"...","cmd":"stt"|"tts"|"warmup", ...}
        # Each line out: {"id":"...","ok":true|false, ...}

        # Eagerly warm up by default (can be expensive only once).
        try:
            _ensure_vosk_model()
        except Exception:
            pass
        try:
            _ensure_piper_voice()
        except Exception:
            pass

        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            req_id = None
            try:
                req = json.loads(line)
                req_id = req.get("id")
                cmd = (req.get("cmd") or "").strip().lower()

                if cmd == "warmup":
                    _ensure_vosk_model()
                    _ensure_piper_voice()
                    sys.stdout.write(json.dumps({"id": req_id, "ok": True, "result": "OK"}) + "\n")
                    sys.stdout.flush()
                    continue

                if cmd == "stt":
                    audio_path = req.get("audio_path")
                    text = stt(str(audio_path))
                    sys.stdout.write(json.dumps({"id": req_id, "ok": True, "text": text}) + "\n")
                    sys.stdout.flush()
                    continue

                if cmd == "tts":
                    text = req.get("text")
                    output_path = req.get("output_path")
                    voice = req.get("voice")
                    style = req.get("style")
                    speaker_id = req.get("speaker_id")
                    speaker_id = int(speaker_id) if speaker_id is not None and str(speaker_id) != "" else None
                    out = tts(str(text), str(output_path), voice=voice, style=style, speaker_id=speaker_id)
                    sys.stdout.write(json.dumps({"id": req_id, "ok": True, "output_path": out}) + "\n")
                    sys.stdout.flush()
                    continue

                sys.stdout.write(json.dumps({"id": req_id, "ok": False, "error": f"Unknown cmd: {cmd}"}) + "\n")
                sys.stdout.flush()
            except Exception as e:
                sys.stdout.write(json.dumps({"id": req_id, "ok": False, "error": str(e)}) + "\n")
                sys.stdout.flush()
