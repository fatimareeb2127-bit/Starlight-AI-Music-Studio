# Starlight AI Music Studio

A responsive, animated music-making web application with a playable browser piano, MIDI import, a melody generator, recording, playback, MIDI export, and a local song library.

## Features

- Animated starfield, glowing colors, floating notes, and responsive dashboard.
- Play piano with mouse/touch or computer keyboard.
- Record piano performances and play them back.
- Import and play MIDI files.
- Generate a new demo melody with mood, tempo, and length controls.
- Download generated MIDI and export piano recordings.
- Save songs to a library held in the current browser session.
- Flask backend with MIDI export using `mido`.

## Important note about the AI model

The application works immediately with its built-in demo melody generator. The generator is not the trained DataFlair LSTM. The LSTM needs to be connected using its saved model, note vocabulary, and compatible event encoding. A Keras model file alone is not enough to reliably decode the original note/chord strings. The backend `/api/generate` route is the intended integration point.

## Run on Windows

1. Install Python 3.10 or newer.
2. Extract this folder.
3. Open Command Prompt or the VS Code terminal inside this folder.
4. Create and activate a virtual environment:

   ```bash
   python -m venv .venv
   .venv\Scripts\activate
   ```

5. Install requirements:

   ```bash
   pip install -r requirements.txt
   ```

6. Start the app:

   ```bash
   python app.py
   ```

7. Open `http://127.0.0.1:5000` in Chrome or Edge.

## Run on macOS / Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000`.

## Browser requirements

The piano sound uses the Web Audio API. Click a piano key or playback button to allow the browser to start audio. MIDI import and client-side MIDI export use a small library loaded from jsDelivr, so those functions require an internet connection. Core piano playback and melody generation work without that MIDI parsing library.

## Project structure

```text
ai_music_studio/
├── app.py
├── requirements.txt
├── README.md
├── templates/
│   └── index.html
├── static/
│   ├── app.js
│   └── style.css
├── generated/
└── uploads/
```

## Connecting your trained LSTM

In `app.py`, replace the body of `generate()` with inference from your trained model. Preserve the exact vocabulary mapping and event encoding used during training. Update the output conversion so each generated event has at least `pitch`, `start`, `duration`, and `velocity`. For the original DataFlair implementation, fix the note/chord representation and preserve onset/duration before treating the output as production-ready.

## Troubleshooting

- If the server does not start, confirm the virtual environment is active and `pip install -r requirements.txt` completed.
- If the piano is silent, click a key once and check browser tab volume.
- If MIDI import fails, check the internet connection and confirm the file is a valid `.mid` or `.midi` file.
- Generated MIDI download requires `mido`, installed through `requirements.txt`.
