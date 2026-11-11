# 0.1.6 release verification

- TypeScript and production build passed.
- 476 unit/regression tests passed; community catalog validated (0 submitted pets, 2 data plugins).
- Native macOS packaged test: first launch, local replies, pet window, persistence, dependency isolation and payload audit passed with MORI_QUIET and temporary user data.
- Native onboarding test: one starter, five atlas pages decoded, 1440×900 and 1000×700 guide controls reachable, dismissal persisted across reload, windows invisible and unfocused.
- Native profile/chat regression: 3,125,608 bytes of reference data remained local; provider request was 8,923 bytes. Structured dossier, spoiler filtering, classified memories and saved data preservation passed with a fixture provider, not a paid live request.
- Windows package: ZIP CRC, PE x64 header, six current-art PNG hashes, one bundled-pet catalog, no workspace/keys and no Cubism Core verified. **No Windows runtime verification**.
- Both videos: 67.2 seconds, 30 fps, 2,016 fully decoded frames each, AAC audio, 1080p landscape/portrait. Four GIFs fully decoded. Narration segments fit scenes; fixed PCM mix peak -1.63 dBFS before AAC encoding.

Windows ZIP SHA-256: `19524b9ab51946ab27eed2d09e449b4289b2146b78f78785429bfb6216aa2ea4`.

Build warnings: large Vite chunks remain; the release is unsigned. The macOS helper's window awareness is not available on Windows. The film is an editorial composition using real artwork, not an uncut recording.
