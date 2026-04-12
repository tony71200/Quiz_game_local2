# Sound Assets

This folder is for custom audio files. The game uses Web Audio API for
generated sounds by default. To use custom audio files:

1. Place WAV/MP3/OGG files here
2. Update the `SoundEngine` class in `/shared/sounds.js` to load them

## Default Generated Sounds

| Sound        | Trigger                        |
|-------------|-------------------------------|
| `correct`   | Player answers correctly       |
| `wrong`     | Player answers incorrectly     |
| `reveal`    | Answer reveal on host          |
| `victory`   | Final podium displayed         |
| `eliminated`| Team is eliminated             |
| `tick`      | Timer countdown (last 10s)     |
| `transition`| Phase transitions (slides)     |
