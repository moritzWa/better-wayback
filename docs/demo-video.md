# Short product demo

The current timing gives OpenAI and Apple 3.5 seconds each in the base edit (2.8 seconds at 1.25×), with a longer hold on their final cards. The closing URL card is shortened to 2.4 base seconds (1.92 seconds in the output) and uses the new original Visual Wayback wordmark. Total duration remains about 13.13 seconds. The CTA starts over the final Apple card, then the URL appears as the address is spoken.

## Current cut: farther scrolling at 1.25×

The full edit now runs at 1.25×, including pitch-preserved narration using FFmpeg `atempo`, for a target 394 frames / about 13.13 seconds at 30 fps. Each site scrolls through four consecutive preview cards, pausing briefly on each and ending at a recent/current design. The opening still records the actual Visual Wayback header and Nvidia results; OpenAI and Apple follow the logo problem section. No editing camera translation or slideshow replaces the native continuous recording.

The problem narration is: “On Wayback Machine, you open snapshots one by one.” This replaces the earlier imperative wording. The visual stream, speed and overall duration are unchanged.

Nvidia: 2007, 2013, 2025, November 13, 2026. OpenAI: 2022, 2023, 2025, November 13, 2026. Apple: 1999, 2007, 2012 and a freshly captured current homepage, explicitly marked **Current / live site capture, not an archive replay**. Apple's November 13/14 archive replays had missing hero assets, so they were not packaged. The live endpoint is a real product example card with source provenance, not a fake archived timestamp injected for the video. It is excluded from comparisons with archived text.

Nvidia's recent archived and live homepage were checked in a browser. OpenAI's live browser hit Cloudflare, but a direct read of its public homepage confirmed the same “What can I help with?” layout and current announcements visible in the November 13 archive. Apple's live screenshot matches its public Apple HomeView homepage. UTC capture timestamps are kept as recorded, even across local midnight.

## Source workflow: continuous screen recording of the outer page

The current sequence is **Nvidia opening → Internet Archive problem → OpenAI → Apple → closing URL**. Nvidia is not repeated after the opening. Apple is a real cached product example with genuine 1999, 2007 and 2012 captures, recorded by scrolling the outer Visual Wayback timeline at native 4K.

The earlier audio inserted silence by splitting a complete generated take immediately after “Nvidia.” Sample jumps at the splice were consistent with the reported glitch. The replacement narration and CTA are generated as separate complete takes, with no mid-sentence cut. `tools/prepare-demo-audio.py` keeps both full files, applies eight-millisecond edge fades and places the CTA at 12.8 seconds in the 16.4-second base edit, before the full 1.25× speed-up. Independent transcription verifies “OpenAI and Apple” and the full closing invitation; the gap before the CTA is digitally silent. This is data-level audio verification, not a claim of a listening review.

The current recording opens on the actual Visual Wayback header with Nvidia selected and scrolls down the Visual Wayback page into Nvidia results. The OpenAI/Nvidia showcase also scrolls only this outer timeline. Archived pages within the preview cards remain still. There is no title-slide opening, floating screenshot frame, edited camera move or per-frame staged scroll capture.

`tools/record-demo-screen.js` records Chromium's live continuous screencast at a physical 3840×2160 viewport and device scale factor 1. Browser presentation zoom is 300% so the interface remains readable at that physical resolution. Every emitted JPEG is checked to be genuinely 3840×2160. The genuine same-date high-resolution archive assets are reused in the recording browser, without changing the public site. Browser animation frames drive an actual timed outer-page scroll; no screenshots are requested at scripted scroll positions. The recording logs outer scroll positions and verifies all inner preview scroll positions remain zero.

`tools/build-demo-screen.py` uses the recorded full-screen frames directly, with no scaling or translation. It retains the Internet Archive logo problem section, Will narration and spoken closing URL, at 16.4 seconds. `tools/check-demo-screen.py` checks the final decoded UI frames against their corresponding native browser frames, in addition to checking resolution, duration, outer/inner scrolling and full-file decode. Source recordings and verification reports are in `~/Documents/visual-wayback/demo-video/screen-record/`. The output remains the same Desktop MP4.

Verified current export: 176 continuously emitted native 3840×2160 browser frames across the source recording. The opening logs 47 distinct outer-page scroll positions, OpenAI 62 and Apple 59; all inner-preview scroll positions stay zero. Each scene records four consecutive card timestamps and ends at the verified recent/current endpoint. The final OpenAI and Apple cards hold for approximately 0.70 and 0.68 seconds in the output, respectively. Six decoded UI frames match their exact source frames with average per-channel encoding error below 0.4/255. Full-file decoding and 394-frame/13.133333-second checks passed. Audio runs at 1.25× with pitch preserved. The corrected “On Wayback Machine, you open snapshots one by one” wording is verified. Whole-file speech recognition misspelled the final domain, so the isolated closing line was independently transcribed and correctly returned “Try it out now at visualwayback.com.” Separate endpoint and identity sheets show the held final cards, the original logo and the favicon at actual small sizes.

## Earlier revision: shorter scrolling motion edit

Use the [motion research and production notes](demo-motion-research.md) for the current version. Moritz preferred real scrolling over the static 4K montage, wanted a different narrator, the Internet Archive logo in the problem section and an explicit spoken closing invitation. The new workflow retains native 4K capture, restores actual browser scrolling and targets 16.4 seconds, shorter than both the 17.1-second and 19.2-second cuts.

Run `tools/capture-demo-motion.js`, `tools/build-demo-motion.py --overwrite` and `tools/check-demo-motion.py` through the heavy-job queue. Generate narration into the `motion` source folder with `tools/create-demo-voiceover.py`; its current default is Will - Conversational Narrator. The deliverable still replaces the same Desktop video. The older workflows below are retained for source history, not as the current creative direction.

## Earlier direction: native 4K, pitch / problem / showcase

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
