# Editorial verification record

Prepared and checked November 14, 2026, local America/New_York time. The canonical domain is a requested configuration target, not a purchased or deployed domain.

## Source selection

The public articles contain inline links and their full source lists with access dates. These are the main historical accounts:

- [Brewster Kahle, 2021 keynote transcript](https://blog.archive.org/2021/10/22/turns-out-its-not-the-technology-its-the-people/): first-person recollection of the library ambition, five years collecting before Wayback and the role of people. Labeled a retrospective, not an interview conducted by us.
- [Kendra Mayfield, WIRED, October 29, 2001](https://www.wired.com/2001/10/wayback-goes-way-back-on-web/): contemporary launch reporting with Kahle and Paul Grabowicz remarks. Supports public URL/date browsing in October 2001 and the attributed launch-era count.
- [Jill Lepore, The New Yorker](https://www.newyorker.com/magazine/2015/01/26/cobweb): online January 19, 2015, print issue January 26. Reported interviews with Kahle and others; WAIS, reference rot and the Shmelev collecting example. No current crawl rate or old prediction is imported from this article.
- [Alexis Rossi, October 25, 2013](https://blog.archive.org/2013/10/25/fixing-broken-links/): collection milestones in 1996/2001/2004/2006/2010; Save Page, Availability API and WordPress/Wikipedia work.
- [Vinay Goel, October 23, 2016](https://blog.archive.org/2016/10/23/defining-web-pages-web-sites-and-web-captures/): explicit distinction between webpages and timestamped web objects. Historical figures retain their date and unit.
- [2024 recovery update](https://blog.archive.org/2024/10/21/internet-archive-services-update-2024-10-21/) and [follow-up](https://blog.archive.org/2024/10/28/internet-archive-services-update/): primary incident and recovery chronology. The latter was last updated November 13, 2024; its publication date alone is not the restoration date for every listed service.
- [October 2025 one-trillion announcement](https://blog.archive.org/2025/10/31/one-trillion-web-pages-archived-internet-archive-celebrates-a-civilization-scale-milestone/): attributed institutional milestone, not a fresh 2026 measurement.

Product claims use provider documentation: archive.ph, Perma.cc, Common Crawl, Webrecorder, Archive-It and Visualping. The license for ArchiveWeb.page was separately checked through GitHub's repository-license API and its linked LICENSE.md (GNU AGPL v3).

## Facts and limits checked

- Internet Archive collecting began in 1996; the public Wayback Machine arrived in 2001. Exact launch day is not needed for this article and is not asserted.
- archive.org is the broader library website; web.archive.org is the web-history/replay host.
- Archive-It belongs to the Internet Archive and dates its service to 2006. It is not described as an independent institutional fallback.
- Common Crawl describes regular datasets since 2008 and free data access. WARC/WAT/WET have different uses. Computing and storage expenses remain separate.
- Visualping's current public table lists Free: 5 pages, 150 monthly checks. Personal 1K: $14 monthly billing or $120 yearly billing, 1,000 monthly checks and 10 pages. Displayed dollars are quoted without assuming tax or billing currency. Retention text says one year for business versus the last 90 days.
- Perma's homepage was readable in the initial research fetch and explicitly advertises free account registration. Detailed documentation and signup returned 403; no numeric free allowance, paid price or unlimited entitlement is invented.
- archive.today's homepage was read successfully with the web-fetch tool, including its text/graphical copy description, inactive-script statement and search examples. Its permanence language is not repeated as our guarantee. No universal subscription tariff or SLA is inferred from the public interface.
- Visual Wayback copy was checked against this repository's README and implementation: existing Archive data, sampled captures, rendered-text grouping and screenshot previews. No independent archive, continuous monitoring, pixel comparison or every-change promise. No hosted pricing is invented.
- No firsthand interviews, service-wide hands-on testing, performance comparisons, publication dates before preparation, fabricated quotes or fabricated source counts.

## Link check

The final finite Node GET check covered 25 unique external URLs. Twenty-three returned HTTP 200 (following the Archive-It About redirect). Two need access context, not silent deletion:

- `https://perma.cc/`: initial research fetch returned the full homepage; repeated checks returned HTTP 403, including a second HTTP client with a normal browser user agent. Retained as the official source and destination. Detailed current allowance/pricing is omitted.
- `https://archive.ph/`: research web-fetch returned the homepage twice. The Node client failed to fetch it and a second client's TLS handshake timed out. The successful research retrieval verifies the cited homepage text; no actual capture or availability guarantee was tested.

All internal article links and table-of-contents anchors resolve in module tests. Canonical, Open Graph, Article JSON-LD and sitemap URLs agree. The module does not deploy, buy a domain, submit archive captures or open a browser.

## Review

The parent reviewed the substantive articles and passed its integration contract test. Its editorial feedback was applied: remove the Perma legal-admissibility aside, shorten repeated negative caveats and preserve the meaningful limits in the relevant product section and source notes. The module's own five queued checks pass, including hostile metadata/content escaping and exact JSON-LD CSP hashes.
