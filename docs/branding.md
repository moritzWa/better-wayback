# Visual Wayback identity

The original mark pairs a rewind symbol with a condensed red-and-charcoal wordmark. The palette and compact lettering nod to the Wayback Machine, but the shape, name lock-up and type treatment are distinct. It does not use the Internet Archive's columns, the Wayback logo artwork or an affiliation claim.

- Brick red: `#a13832`.
- Charcoal: `#252528`.
- Warm white inside the icon: `#fff8f4`.
- Lettering: Barlow Condensed Bold, converted to SVG outlines so rendering never depends on installed fonts or third-party font requests. The font source and SIL Open Font License are in `tools/brand/`.
- The square-ended rewind glyph sits in a stand-alone app-icon tile. It is not a second rounded container; there is no competing nested corner radius.

`public/logo.svg` is the primary wordmark, used on the app and blog. `public/logo.png` is a transparent native-resolution lock-up for the video closing card. `public/favicon.svg`, the multi-size `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png` and `icon-512.png` share the same original rewind mark.

The website keeps its existing minimal layout and colors. The new logo does not add fonts, trackers or runtime services. Blog CSP allows only self-hosted images so the logo can render without permitting external images or scripts.

To regenerate the assets, install Pillow and fonttools in a local environment, then run `python tools/build-brand.py` through the heavy-job queue. The SVG wordmark uses outlined glyphs. The PNG is drawn from the same licensed font and geometry. Check the mark at 16, 32 and 180 pixels and the full lock-up on white before publishing.

Production checks verified matching asset hashes, working app/blog logos, favicon declarations and no horizontal overflow at 320 pixels. A platform-injected Cloudflare analytics beacon was separately blocked by the strict CSP. It is not required by the branding; no analytics permission was added. The saved live-check report keeps those warnings rather than claiming a completely empty console.
