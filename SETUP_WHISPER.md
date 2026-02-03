# Real Local STT Setup (Whisper.cpp)

## 1. Prerequisites
- Windows 10/11
- PowerShell

## 2. Download Whisper.cpp
1. Visit [Whisper.cpp Releases](https://github.com/ggerganov/whisper.cpp/releases/latest).
2. Download `whisper-bin-x64.zip`.
3. Extract contents to `C:\Users\%USERNAME%\.tele\whisper\`.
   - Ensure `main.exe` is at `C:\Users\%USERNAME%\.tele\whisper\main.exe`.

## 3. Download Model
1. Download a ggml model (e.g., `ggml-base.en.bin`) from [HuggingFace](https://huggingface.co/ggerganov/whisper.cpp/tree/main).
2. Save it to `C:\Users\%USERNAME%\.tele\whisper\ggml-base.en.bin`.

## 4. Configure Environment
Create or update `.env` in the root `TELE` directory:

```env
TELE_GATEWAY_CHANNEL=telegram
TELE_TELEGRAM_BOT_TOKEN=your_token
TELE_TELEGRAM_ALLOWED_CHAT_IDS=your_id
TEXT_SIMULATION=0

# Whisper Configuration
WHISPER_CPP_BIN="C:\\Users\\Administrator\\.tele\\whisper\\main.exe"
WHISPER_CPP_MODEL="C:\\Users\\Administrator\\.tele\\whisper\\ggml-base.en.bin"
```

## 5. Running the Demo (Real Voice Loop)
1. Start the system:
   ```powershell
   node dist/demo/runner.js
   ```
2. Open the UI (Notebook Overlay) - usually auto-launched or at `http://127.0.0.1:3000`.
3. **Push-to-Talk**:
   - Hold the **"HOLD TO SPEAK"** button in bottom right.
   - Speak a command (e.g., "scan temp").
   - Release button.
4. **Observations**:
   - UI Status changes: RECORDING -> PROCESSING.
   - Plan appears in Notebook.
5. **Interrupt Test**:
   - Drag plan to "Quarantine" to start cleanup.
   - Hold PTT and say "Stop".
   - System should cancel immediately.
   - Check Console/Telegram for `Stop Latency` metrics.

## CPU Usage Note
- Whisper.cpp 'base' model is lightweight (~100MB RAM, low CPU).
- `stt.ts` uses a 200ms poll for new files.
- Recording uses native Windows MCI (negligible CPU).
