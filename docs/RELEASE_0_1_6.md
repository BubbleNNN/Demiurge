# 0.1.6 release verification

- TypeScript and production build passed.
- 477 unit/regression tests passed; community catalog validated (0 submitted pets, 2 data plugins).
- Native macOS packaged test: first launch, local replies, pet window, persistence, dependency isolation and payload audit passed with MORI_QUIET and temporary user data.
- Native onboarding test: one starter, five atlas pages decoded, 1440×900 and 1000×700 guide controls reachable, dismissal persisted across reload, windows invisible and unfocused.
- Native profile/chat regression: 3,125,608 bytes of reference data remained local; provider request was 8,923 bytes. Structured dossier, spoiler filtering, classified memories and saved data preservation passed with a fixture provider, not a paid live request.
- Windows package: ZIP CRC, PE x64 header, six current-art PNG hashes, one bundled-pet catalog, no workspace/keys and no Cubism Core verified. **No Windows runtime verification**.
- Original release videos (superseded by the music-only story edit; see docs/media/validation.json): 67.2 seconds, 30 fps, 2,016 fully decoded frames each, AAC audio, 1080p landscape/portrait. Four GIFs fully decoded. Narration segments fit scenes; fixed PCM mix peak -1.63 dBFS before AAC encoding.

The authoritative Windows ZIP checksum is the `.sha256` asset attached to release v0.1.6.

Build warnings: large Vite chunks remain; the release is unsigned. The macOS helper's window awareness is not available on Windows. The film is an editorial composition using real artwork, not an uncut recording.

The manual **Windows release** GitHub Actions workflow repeats the build and verifies every payload hash before uploading to an existing draft release. CI packaging can produce a different ZIP hash due to archive metadata; use the `.sha256` attached to the downloaded release asset. This workflow does not claim Windows runtime testing.

Windows packaging expands shared runtime dependencies into real directories rather than Unix symlinks, so Explorer extraction can preserve the dependency closure. The regression test resolves shared dependencies after removing the source checkout and rejects symlinks in portable mode.

Media-only revision (2026-11-11): 112.7 seconds, 3,381 fully decoded frames per layout, 54 distinct clips, no AI narration or PV audio; only the requested soundtrack. Final AAC decoding has zero clipped samples and identical audio in both layouts. The Windows package is unchanged.
