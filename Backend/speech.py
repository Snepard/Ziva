import json
import os
import sys
import wave
import zipfile
from pathlib import Path
from urllib.request import urlretrieve

import vosk
from piper.download_voices import download_voice
from piper.voice import PiperVoice


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


def _ensure_piper_voice() -> tuple[str, str]:
    """Ensure Piper voice model + config exist, return (onnx_path, json_path)."""
    voice = os.getenv("PIPER_VOICE", "en_US-amy-low")
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


def tts(text: str, output_path: str) -> str:
    """Piper TTS output (realistic, offline, free).

    Outputs WAV.
    """
    onnx_path, json_path = _ensure_piper_voice()
    voice = PiperVoice.load(onnx_path, config_path=json_path)
    with wave.open(str(output_path), "wb") as wav_file:
        voice.synthesize_wav(text, wav_file)
    return str(output_path)


def stt(audio_path: str) -> str:
    """Vosk STT.

    Expects WAV mono PCM 16-bit.
    """
    model_dir = _ensure_vosk_model()
    model = vosk.Model(model_dir)

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
        tts(text, output_path)
    elif mode == "stt":
        audio_path = sys.argv[2]
        print(stt(audio_path))
    elif mode == "warmup":
        # Pre-fetch models so the first real request is fast.
        _ensure_piper_voice()
        _ensure_vosk_model()
        print("OK")
