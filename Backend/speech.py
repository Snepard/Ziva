import pyttsx3
import speech_recognition as sr
import sys
import os

# TTS: pyttsx3

def tts(text, output_path=None):
    engine = pyttsx3.init()
    # Set female voice if available
    voices = engine.getProperty('voices')
    female_voice = None
    for v in voices:
        if 'female' in v.name.lower() or v.gender == 'VoiceGenderFemale':
            female_voice = v.id
            break
    if female_voice:
        engine.setProperty('voice', female_voice)
    # Make the voice a bit slower and more natural
    engine.setProperty('rate', 185)
    if output_path:
        engine.save_to_file(text, output_path)
        engine.runAndWait()
        return output_path
    else:
        engine.say(text)
        engine.runAndWait()
        return None

# STT: SpeechRecognition

def stt(audio_path):
    r = sr.Recognizer()
    with sr.AudioFile(audio_path) as source:
        audio = r.record(source)
    try:
        text = r.recognize_google(audio)
        return text
    except sr.UnknownValueError:
        return "Could not understand audio"
    except sr.RequestError as e:
        return f"STT error: {e}"

if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "tts":
        text = sys.argv[2]
        output_path = sys.argv[3] if len(sys.argv) > 3 else None
        tts(text, output_path)
    elif mode == "stt":
        audio_path = sys.argv[2]
        print(stt(audio_path))
