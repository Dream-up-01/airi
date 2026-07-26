# AIRI local GPT-SoVITS bridge

Run `..\start-gpt-sovits-airi.bat` and leave its window open. It starts the
native GPT-SoVITS API on `127.0.0.1:9880` when needed, then exposes the AIRI
bridge at `http://127.0.0.1:9888/v1/`.

The bridge uses the supplied Firefly v4 weights and the matched reference
sample `firefly_0001.wav`. Its reference audio path, reference transcript and
weight paths stay on this machine. AIRI receives only:

- model: `airi-firefly-v4`
- voice: `airi-firefly`

The bridge is intentionally loopback-only. It does not persist raw text or
audio, and its `/health` and error responses do not reveal local paths.
