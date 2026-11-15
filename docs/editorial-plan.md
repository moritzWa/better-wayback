# Three next articles

These are article ideas, not keyword-volume claims or finished research.

## Stripe's homepage, through the years

Use the packaged Stripe captures as the evidence. Follow the shift in its words, audience and product presentation, rather than listing visual trends. Put dated screenshots beside short annotations and link every image to its original capture.

Distinguish what the page actually said from an interpretation of the company's strategy. Check the latter against Stripe's published annual letters and dated product announcements. Do not assign a redesign's launch date from the first capture alone.

Starting sources:
- The original capture URLs in the packaged Stripe demo.
- [Stripe's 2023 annual update](https://stripe.com/annual-updates/2023), which links to its founders' letter.

## Why an archived website can load as a black screen

Start with the exact Harvey capture that exposed a bug in Better Wayback. Show the incomplete screenshot beside the completed reveal, with measured timings. Explain the difference between missing archive resources, an animation that has not finished, and a renderer that cancels it.

Include a small practical checklist: open the original replay, check the final timestamp, let entrance effects finish, then inspect missing resource requests. Do not imply that waiting longer can recover resources that were never archived.

Starting sources:
- [The February 18, 2024 Harvey capture](https://web.archive.org/web/20240218234204/https://www.harvey.ai/).
- This repository's recorded before/after evidence and renderer regression tests.
- [Internet Archive's replay and missing-resource explanation](https://help.archive.org/help/using-the-wayback-machine/).
- [Webrecorder's replay documentation](https://replayweb.page/docs/).

## When did a website actually change?

Work through one real change using two adjacent captures. Show why a capture date bounds a change rather than proving its exact launch time. Explain gaps, HTTP/HTTPS and hostname variants, redirects, and assets captured on different dates. End with a reproducible evidence log readers can use for their own research.

This should be a visual tutorial, not another alternatives roundup. Use a change already supported by the packaged captures, then corroborate any claimed launch date with a dated announcement.

Starting sources:
- [Internet Archive: using the Wayback Machine](https://help.archive.org/help/using-the-wayback-machine/).
- [Internet Archive: web pages, sites and captures are different things](https://blog.archive.org/2016/10/23/defining-web-pages-web-sites-and-web-captures/).
- [CDX API documentation](https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server).
