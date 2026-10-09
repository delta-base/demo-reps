# REPS.be page sitemap proposal

## Verified starting point

- `https://reps.be/` — the REPS company website is identified as `reps.be` in public company information. Direct access to the site and its sitemap endpoints could not be verified during this task.
- The local project includes an AI roleplay prototype for configuring a sales scenario, practising a buyer conversation, and reviewing feedback. This establishes product context, but not public page URLs.

## Proposed information architecture

These are page ideas, not verified live URLs. Confirm the final paths against the deployed site before adding them to `sitemap.xml`.

- Home — REPS value proposition and calls to action
- Product
  - AI roleplay / deliberate practice
  - Coaching and feedback
  - Scenario library
- Use cases
  - Sales teams
  - Managers and coaches
- Sales Excellence Scan — assessment offer referenced in public company updates; confirm it remains available
- Insights — negotiation, sales practice, and performance articles, if this content section exists
- About REPS
- Contact / book a conversation
- Legal
  - Privacy notice
  - Terms of service

## Sitemap maintenance notes

- Add only canonical, publicly accessible pages that return a successful response. Exclude private app screens, login routes, test pages, redirects, and duplicate locale variants unless each is intentionally canonical.
- If the deployed site uses `www.reps.be` or another canonical host, update both `sitemap.xml` and the `Sitemap:` line in `robots.txt` to match it.
- Keep `robots.txt` permissive only if public pages should be crawlable; add exclusions only for confirmed private or non-public routes.
- Submit the sitemap URL in the relevant search-engine webmaster tools after deployment.
