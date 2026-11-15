# Short product demo

## Current direction: native 4K, pitch / problem / showcase

The current edit replaces the earlier upscaled 720p screencast. `tools/capture-demo-hires.js` photographs five genuine archive replays at a 1280×800 CSS viewport with device scale factor 3, producing 3840×2400 PNGs (four showcase dates plus Nvidia 2007 for the overview). It then photographs the deployed product at 1280×720 CSS pixels and DPR 3, producing lossless 3840×2160 product frames. There is no screencast-resolution limit and no enlargement of 720p source frames.

The higher-resolution archive PNGs replace only the same dated PNG responses inside the recording browser. The production site's assets, dates, labels and behavior stay unchanged. Every replacement must resolve to the exact manifest timestamp. Archive-only HTTP and WebSocket isolation and the normal readiness/error checks still apply. Failed replays are not presented as successful previews. Original archived raster artwork may itself have limited resolution.

`tools/build-demo-hires.py` makes a 19.2-second 4K H.264/AAC edit with 576 frames at 30 fps. The structure is:

- 0–4.4 seconds: Visual Wayback, website history in one timeline.
- 4.4–8.4 seconds: Wayback Machine means opening snapshots one by one, returning and choosing another date.
- 8.4–14.4 seconds: genuine OpenAI 2019/2023 and Nvidia 2013/2025 product frames. OpenAI's 2025 DPR-3 replay did not settle on two bounded attempts, so it was excluded rather than photographed unfinished. Nvidia 2013 has a stronger intact hero than the partially archived 2007 page.
- 14.4–16.2 seconds: the actual Visual Wayback overview.
- 16.2–19.2 seconds: the URL and free/open-source end card.

No comparison dialog appears. Anthropic remains excluded from the showcase, but its website example stays available. The pitch and problem cards are editorial typography, not fabricated Wayback UI. The product scenes are an edited montage, not a speed benchmark.

ElevenLabs Brian now reads a new pitch/problem/showcase script. The previous take is retained with the previous deliverable. New source files and QA reports live in `~/Documents/visual-wayback/demo-video/high-res/`. The finished deliverable still replaces the same `~/Desktop/visual-wayback-demo.mp4` for review.

```sh
python3 ~/.claude/scripts/heavy-job.py --wait -- node tools/capture-demo-hires.js
python3 tools/create-demo-voiceover.py --item <personal-1password-item-id> --out ~/Documents/visual-wayback/demo-video/high-res
python3 ~/.claude/scripts/heavy-job.py --wait -- python3 tools/build-demo-hires.py --overwrite
```

The older workflow below documents the source of the pixelation and earlier revisions; use the native-4K workflow above for new renders.

The final native-4K revision passed full-file decoding and ffprobe checks: 3840×2160, 576 frames, 19.200 seconds, H.264/AAC. `tools/check-demo-hires.py` generated an eight-scene contact sheet from the completed MP4, not from intermediate frames. Independent transcription of the final MP4 verified the pitch, snapshot-by-snapshot problem, both company names and the complete closing URL. The comparison dialog and Anthropic showcase are absent. Review artifacts and checks are saved beside the high-resolution sources.

The demo uses the actual Visual Wayback UI and the genuine packaged OpenAI and Nvidia captures. Anthropic was removed from the video at Moritz's request because its website was less visually interesting. Its website example remains available. The video is edited for brevity, not a real-time speed benchmark. The archive pages themselves are not fabricated. The opening and closing captures for each company show different archived dates.

## Sources and narration

- OpenAI: five captures, 2016–2025.
- Nvidia: three captures, 2007–2025.
- Narration: ElevenLabs Brian stock voice, Eleven v4, speed 1.05. No voice cloning.
- No background music, so speech stays clear.

The voiceover text is in `tools/create-demo-voiceover.py`. It uses the personal ElevenLabs account, not the Arca forced-alignment key. The restricted personal credential is stored in 1Password Main as **ElevenLabs Visual Wayback voiceover**, expires December 15, 2026 and is capped at 2,000 credits per refresh period. No key is written to source, files or command arguments.

Independent whisper.cpp transcription verifies the retained company names, removal of the Anthropic sentence and the uncut website address in the final edit. Loudness is normalized during the final edit. Generating/analysing audio does not play it on the host.

## Recording and edit

`tools/record-demo.js` drives a dedicated muted Linux Space Chromium over forwarded CDP port 19832. Never use an authenticated/shared browser. It warms the actual packaged examples before recording, records CDP screencast frames with timestamps, and logs four scenes: OpenAI, Nvidia, timeline navigation and text comparison. The small cursor overlay is only a recording aid. It changes no product data. The original recording also contains an Anthropic scene, which the current edit excludes.

`tools/build-demo.py` samples the completed recording to exactly 513 video frames at 30 fps, adds a simple URL end card and the ElevenLabs narration, and exports a target 17.1-second 1920×1080 H.264/AAC MP4. The voice starts 200 ms into the video. When using the original ElevenLabs take, it uses character timestamps to remove the Anthropic sentence with a short audio crossfade; freshly generated narration already omits it. It verifies the muxed duration is no more than 20 seconds before moving the finished file into place. It refuses to overwrite an existing output without `--overwrite`.

Run recording, encoding and audio checks through the shared heavy-job queue. The recording must finish successfully before encoding or copying any frames. Read the first frame and a contact sheet, verify the audio transcript and levels, and check ffprobe duration before opening the MP4 for review.

The default deliverable is `~/Desktop/visual-wayback-demo.mp4`. Source frames, scene timings, voiceover and QA reports live in `~/Documents/visual-wayback/demo-video/`. Keep those paths for revisions rather than opening differently named versions.

## Verified export

The original November 15, 2026 export was 19.600 seconds and 588 frames. It was recorded from the deployed public site. The first frame shows the actual OpenAI 2016 capture, not a loading screen. The current revision omits Anthropic's scene and spoken sentence, while retaining the comparison dialog and final URL card. Duration, frames and final audio are checked again after each edit rather than relying on the original export's measurements.

The revised export is verified at 17.100 seconds and 513 frames. Its final-MP4 transcription contains OpenAI, Nvidia, the full product explanation and closing URL, with no spoken Anthropic reference. The revised contact sheet confirms the two company scenes, timeline, comparison and end card. The website's Anthropic example was not removed.

Example commands, after starting the task's muted Linux browser and CDP forward:

```sh
python3 ~/.claude/scripts/heavy-job.py --wait -- node tools/record-demo.js
python3 tools/create-demo-voiceover.py --item <personal-1password-item-id> --out ~/Documents/visual-wayback/demo-video
python3 ~/.claude/scripts/heavy-job.py --wait -- python3 tools/build-demo.py
```

The public site receives the new example presets. The video itself is a local review deliverable; this task does not post it to social media or publish it as a separate website asset.
