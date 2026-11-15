# Motion direction for the short demo

Moritz preferred the original real scrolling to the higher-resolution slideshow. The current direction keeps the high-resolution sources but restores real browser motion. It must be shorter than the 17.1-second cut, retain the pitch/problem/showcase structure, use the Internet Archive logo in the problem section, omit the comparison dialog and end with a spoken invitation to try the URL.

## Research

- [Screen Studio: creating product demo videos](https://screen.studio/create/product-demo-videos). Its recommendations center on smooth cursor movement, focused zooms and cutting or speeding up uninteresting segments. The page includes product examples from v0, Stripe, Supabase and Framer. We use the motion principles, not its paid app.
- [Screen Studio: animations](https://screen.studio/guide/animations). It distinguishes focused camera motion, which settles quickly for reading, from fluid motion intended for more creative content. It also describes motion blur during fast movement. Here, we use a small camera move that settles before the main scroll, and retain crisp paused endpoints rather than blur the whole UI.
- [Remotion: transitions](https://www.remotion.dev/docs/transitions/). Its model separates scenes, transition timing and presentation. We use frame-based scene timing and very short dissolves so transitions do not eat into the runtime. No dependency or subscription is needed for this edit.

## What changes in the video

- Real scrolling through the actual deployed UI. Not a pan across a long screenshot and not a sequence of still year cards.
- A small focused zoom from 91% to 95.5% of the native source size. The camera never enlarges a 720p source to 4K.
- Gentle title/logo reveals, short dissolves and a quiet neutral frame/shadow. No fake clicks, gratuitous spins, loud sound effects or comparison dialog.
- A brief dark problem scene uses the original white Internet Archive glyph and wordmark, extracted from its own navigation bundle. The dates that appear below are explanatory graphics, not a fabricated archive interface. The logo identifies the service being discussed, not an endorsement.
- A different licensed ElevenLabs library voice: **Will - Conversational Narrator**, voice ID `XZgCP7SDPjTJVTavedju`. It is not Brian, the similarly named premade Will voice or a clone. This is a different voice, not a claim about its overall popularity.
- A closing card and the spoken sentence: “Try it out now at visual wayback dot com.” The URL remains on screen after the speech ends.

## Timing and provenance

Target: **16.4 seconds**, 492 frames at 30 fps, native 3840×2160 H.264/AAC. Pitch 3.6 seconds, problem 3.4, OpenAI scrolling 2.9, Nvidia scrolling 2.9 and CTA 3.6. The voice has a deliberate 2.2-second pause before the CTA so the footage can breathe without rushing the read.

`tools/capture-demo-motion.js` samples the real browser at 120 scroll positions per company, using the exact-date high-resolution archive PNGs from the previous capture workflow. Each frame is a new screenshot after `scrollTo` and a browser animation frame. Capturing can take longer than playback; it is a deterministic recording, not a speed benchmark. The app and archived dates are not fabricated. Metadata records actual `scrollY` for every frame and fails if the scene does not move through at least 40 distinct positions. The original high-resolution assets remain unmodified.

`tools/build-demo-motion.py` resamples the source sequences to the edit, adds the motion graphics and new narrator, and refuses outputs 17.1 seconds or longer. `tools/check-demo-motion.py` verifies resolution/duration, fully decodes the finished MP4, compares decoded moving frames and creates a contact sheet. Independent speech-to-text checks the final export's whole CTA and URL.

Source frames, narration, logo provenance and verification artifacts live in `~/Documents/visual-wayback/demo-video/motion/`. The deliverable replaces the same `~/Desktop/visual-wayback-demo.mp4`. The prior cut is preserved in the source folder. No production site or example is changed by this revision.

The completed export passed full-file decoding, 4K/492-frame/16.400-second checks and independent final-audio transcription. Decoded moving-frame differences confirm visible motion in both company sequences; the browser capture logged 59 distinct OpenAI positions and 57 Nvidia positions. A twelve-frame contact sheet covers the first picture, logo scene, both actual scrolls and the final URL. The full invitation and URL survive in the final MP4, not just the source narration.
