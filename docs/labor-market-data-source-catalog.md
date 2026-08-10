# Labor Market Data: Source Plan for the Career Planning Section

*AI-assisted hiring platform — data layer for job-seeker career planning. **Deferred until after POC/MVP.***

**Status:** this workstream now belongs to a new **career planning section**, slotting between the current onboarding step 2 (resume/profile reflection) and step 3. Nothing here is POC/MVP scope. The document is a standing plan to pick up when that section gets designed.

---

## 1. Locked Decisions

| Question | Decision | Consequence |
|---|---|---|
| Occupation spine | **SOC** is canonical | Need title→SOC coding; no proprietary taxonomy for now |
| Job level | **Not a stratifier.** Rough analogs only from free data | No level-based filtering, ranking, or scoring in the UI |
| Market definition | Track **both stock and flow** | Two different numbers, described to the user in different language |
| Demand granularity | **Industry-level** is sufficient | Requires an occupation→industry crosswalk (see §3.3) |
| Purpose | **Calibrate a career development action plan** for the job seeker. No matching engine | Lower accuracy bar, higher calibration and tone bar |
| Geography | **MSA**, plus **remote** as a user-selected second radius | MSA also serves as the cost-of-living index key |
| Refresh | **Manual, operator-triggered** update cycles | Build scraping/parsing/ETL scripts; pin and stamp each snapshot |
| Placement in flow | **New career planning section**, between current steps 2 and 3 | Post-MVP; a stated career goal is an input, not an inference |
| Presentation | **Reviewable, with room for discussion and reaction** | Not a verdict delivered mid-conversation; a panel the user responds to |
| Audience | **Job seeker only.** Not on the recruiter link | Stays advice; avoids becoming a selection input |
| Failure handling | **Descriptive messages** surfacing what went wrong | Optimized for troubleshooting; revisit before real customers |
| Voice | Helpful, positive, forward-moving, **as realistic as it takes to stay factual** | No cheerleading, no bubble-bursting; see §6 |

**Priority note:** this entire workstream sits below the qualitative interview/discussion experience, and now below the POC/MVP entirely. Sized so it never blocks that work.

---

## 2. Architectural Shape

These decisions collapse the data layer into a **bundled, quarterly-refreshed reference dataset**:

- No vendor contracts, no licensing negotiation, no live third-party API in the request path
- All sources are free, government or academic, and redistributable with attribution
- The dataset serves as **retrieval context for the conversation**, not as a scoring system — it feeds the same RAG layer already planned for the candidate profile
- Refresh cadence is quarterly at most; nothing here changes fast enough to justify more

This is the smallest thing that can honestly answer a user's questions about their market. Everything heavier is parked in §8.

### 2.1 Pipeline and refresh

Refresh is **manual and operator-triggered** — no schedulers, no cron, no silent updates. The engineering work is the ETL, not the orchestration.

What needs building:

- **Per-source ingestion scripts.** Most sources are bulk flat files (OEWS, QCEW, EP, O\*NET, BEA RPP) or simple APIs (BLS v2, NIOCCS, CareerOneStop). Little true scraping is required at this tier, which keeps terms-of-service exposure near zero.
- **A normalized intermediate store** keyed on SOC × NAICS × MSA, so each source is transformed once and joined rather than re-parsed per query.
- **Snapshot versioning.** Each update cycle produces a pinned, immutable snapshot. Nothing mutates in place.
- **Vintage stamps on every displayed figure.** OEWS, EP, and JOLTS have very different reference periods; the user-facing layer should be able to say when a number is from. This also makes the aging rule in §4 auditable.
- **A per-run report**: rows ingested, unmapped titles, suppressed cells, schema drift. Federal file layouts change between vintages more often than you'd expect.

### 2.2 Where it appears in the product

Market data belongs to the **career planning section**, between the current step 2 reflection and step 3. It does not appear in onboarding.

- **Separation of concerns is explicit.** The SOC/source dataset is built and versioned independently of anything that consumes it. Recalculation policy — whether a user's plan recomputes on profile change, on new snapshot, or only on demand — is a decision for whoever designs the career planning section, not a property of the data layer.
- **A stated career goal is an input, not an inference.** Achievability only means something against a target the user has named. That target gets captured in the career planning conversation, which is precisely why this couldn't live at step 2.
- **Reviewable, not pronounced.** The output is a panel the user reads, reacts to, and argues with — the market picture is raw material for a discussion, not a verdict delivered mid-flow.
- **The deliverable is a plan, not a report.** What comes out the far side is an action plan for training and career development toward the user's goal. Market data calibrates that plan: it sets realistic targets, prices the gap, and ranks which adjacent moves shorten it.
- **Job seeker only.** Nothing from this layer appears on the recruiter link. That keeps it advice rather than a selection input.

---

## 3. The Core Source Set

All free, government or academic, redistributable with attribution.

### 3.1 O\*NET — semantic layer

Free, quarterly, CC-BY (attribution required in-product). Currently v30.x; note the Feb 2026 release consolidated Job Zones 1 and 2 into a combined category, so write Job Zone logic against the current release rather than the historical five-zone model.

**What we use:**
- **Tasks, skills, knowledge, technology skills** — vocabulary for describing what a job actually involves
- **Work Styles** (16 dimensions) and **Work Values** (6, from Theory of Work Adjustment) — the occupation-side analog to our candidate trait continua
- **Job Zone** — preparation/entry requirements, our honest substitute for "level"
- **Related Occupations** and the **Career Changers Matrix** — free, structured adjacency; the backbone of "what could I switch into"
- **Alternate Titles file** — tens of thousands of real-world job titles mapped to O\*NET-SOC (see §3.2)

**Caveat to carry forward:** O\*NET's occupation-side ratings come from incumbent surveys and analysts, not from our candidates. Comparing an inferred candidate trait to an O\*NET Work Style rating is a cross-instrument comparison. Treat any resulting fit signal as directional and describe it that way to the user.

### 3.2 Title → SOC coding

Not a dataset, but the join key everything depends on. Free options, in order of likely use:

1. **O\*NET Alternate Titles file** — lookup table, covers most common real-world titles
2. **LLM extraction against that lookup** — handles the long tail ("Growth Engineer," "Member of Technical Staff") at POC volume
3. **NIOCCS** (NIOSH) — government-built industry and occupation autocoder, free API
4. **CareerOneStop APIs** — DOL-funded wrapper over BLS + O\*NET, includes title search

Log unmapped and low-confidence titles from day one. That log is the requirements doc for whatever replaces this later.

### 3.3 BLS — wages, outlook, demand

| Source | Role in the product | Key fields |
|---|---|---|
| **OEWS** | "What does this pay in your market" | Employment count and wage percentiles (10/25/50/75/90) by SOC × MSA |
| **Employment Projections** | "Is this field growing" + flow | 10-yr growth, **annual average openings** (growth + replacement), typical entry education/experience |
| **National Employment Matrix** | **The crosswalk.** Occupation-by-industry staffing patterns | Tells us which NAICS industries employ a given SOC — this is what makes industry-level demand usable for an occupation-level user |
| **JOLTS** | "Is this part of the market hiring" | Openings, hires, quits, layoffs by industry and region/state |
| **QCEW** | Employer density — "how many places near you could hire this" | Establishment counts and employment by county × NAICS |
| **CPS telework series** | Remote feasibility by occupation/industry | Official telework rates |
| **ECI** | Aging stale OEWS wages forward | Wage growth by occupation group |

All free; BLS Public Data API v2 plus bulk flat files. OEWS and QCEW are bulk-download-friendly.

**Stock vs. flow, concretely:**
- **Stock** = OEWS employment counts by SOC × MSA, plus QCEW establishment density
- **Flow** = EP annual average openings (occupation level, national only) and JOLTS rates (industry level, regional)

These answer different user questions and should never be blended into a single "market health" number.

### 3.4 BEA Regional Price Parities — cost of living

Free, annual, published by state and MSA. A purpose-built price-level index — do not improvise a COL adjustment out of wage data. Keys directly to the MSA spine, so it drops in cleanly for real-wage comparisons across metros.

Optional add: **HUD Fair Market Rents** for a housing-specific layer if RPP proves too coarse.

### 3.5 Remote as a second radius

OEWS has no remote dimension. The approach:

- **National OEWS** as the baseline wage picture for a remote search (with an explicit caveat that many employers geo-adjust)
- **BLS CPS telework data** for official remote/hybrid rates by occupation and industry
- **Stanford SWAA** (Barrero, Bloom & Davis) — monthly, CC-BY licensed, mirrored on FRED, with a required citation. Best free series for remote-work share trends.

**Framing point, not a data point:** remote isn't simply a wider radius. It expands the user's opportunity pool *and* the competing applicant pool simultaneously. The advice layer should say so rather than presenting remote as strictly more options.

### 3.6 Optional cheap demand data

Only if real postings turn out to be necessary for credibility:

- **Direct ATS endpoints** (Greenhouse, Lever, Ashby, SmartRecruiters, Workday tenants) — free, structured, high-fidelity, safest on terms of service. Very workable for a narrow tech beachhead where we can assemble the company list by hand.
- **TheirStack** (usable free tier) or **Adzuna API** for prototyping breadth
- **USAJOBS API** — free, and carries explicit GS pay grades
- **DOL PERM/H-1B disclosure files** — free, quarterly; employer, title, worksite, SOC, offered wage, and prevailing wage level I–IV on one row. Tech-heavy, which suits the beachhead.

### 3.7 Training and credential data — new requirement

**This is a gap the original catalog didn't cover.** Once the deliverable is an action plan for training and career development rather than a market summary, the source set needs a supply side: what a user could actually *do* to close the gap. Free options:

- **CIP–SOC crosswalk** (NCES/BLS) — maps education programs to occupations. The structural link between "target job" and "relevant program."
- **IPEDS** (NCES) — every Title IV institution: programs offered, completions, tuition, location. Joins to CIP, so it answers "who near me teaches this and what does it cost."
- **CareerOneStop** — DOL-funded APIs covering training finder, certification finder, licensed-occupation lookup, and apprenticeship finder. Closest thing to a turnkey source for this section.
- **O\*NET certification and apprenticeship crosswalks** — already in the bundle, links occupations to recognized credentials.
- **Apprenticeship.gov / RAPIDS** — registered apprenticeship programs by occupation and state.
- **State WIOA Eligible Training Provider Lists** — state-vetted programs, often with outcome data (completion, employment, earnings). Quality and format vary by state; Iowa's is worth checking first given the local network.
- **Credential Engine registry** — open credential descriptions, still uneven in coverage but improving.

**The honest limit:** none of these tell you whether a given credential actually moves someone's outcomes. The plan should present training options as paths people take, not as investments with a promised return.

---

## 4. Dimension Handling

**Occupation** — SOC, via O\*NET-SOC where the extra granularity helps. Canonical.

**Industry** — NAICS. Reached from the user's occupation through the National Employment Matrix, not asked for directly.

**Geography** — MSA primary; state and national as fallbacks where MSA data is suppressed (OEWS suppresses small cells). Remote handled as a separate mode, not a location value.

**Level** — deliberately weak. Available signals:
- O\*NET Job Zone (entry preparation, not seniority)
- Years-of-experience extraction from the user's own resume
- Title tokens (senior, staff, principal, director) as a soft label only

**Do not** present OEWS wage percentiles as a level proxy. The spread reflects tenure, employer size, sub-geography, and industry mix at least as much as seniority. Language should be "the wage range for this occupation in your market," never "you're at the senior end."

**Time** — OEWS lags 12–18 months; EP is a 10-year horizon; JOLTS is monthly. Mixing these without an explicit aging method produces numbers that look authoritative and are wrong. Pick an ECI-based aging rule and document it.

---

## 5. Mapping to User-Facing Questions

| User question | Sources | Honest limits |
|---|---|---|
| "Is this goal achievable?" | EP entry requirements, O\*NET Job Zone, OEWS wage distribution, resume-derived experience | We can describe typical paths, not predict this person's odds |
| "What does the market look like?" | OEWS stock, EP openings, JOLTS by mapped industries, QCEW density | Occupation-level flow is national only |
| "What's my marketability?" | Occupation-level demand + skill overlap from O\*NET | Not a score. Directional narrative only — see §6 |
| "What could I switch into?" | O\*NET Related Occupations + Career Changers Matrix, skill overlap | Theoretical adjacency, not observed transitions |
| "What would I earn there vs. here?" | OEWS by MSA, normalized by BEA RPP | Asking-price vs. accepted-pay gap; no equity or benefits |
| "What should I do to get there?" | CIP–SOC crosswalk, IPEDS, CareerOneStop, apprenticeship and certification crosswalks, state ETPLs | Programs people take, not returns we can promise |

---

## 6. Voice

**Helpful, positive, forward-moving, with as much realism as it takes to stay factual.**

The failure modes sit on both sides. Obsequious framing ("you'd be a strong candidate anywhere!") destroys the product's only real advantage, which is that the feedback is worth trusting. Blunt framing ("this goal is unrealistic") is both unkind and unsupported — the data describes a market, not a person's odds.

The resolution is that **the data describes conditions; the user decides what to do about them.** Practical rules:

- Report the market, not a verdict. "Roles like this in your metro cluster around X, with the top quartile near Y" — not "you're aiming too high."
- When a goal looks like a stretch, follow with a path rather than a judgment: what typically bridges the gap, which adjacent occupations shorten it, what the same goal looks like in another metro or remote.
- Prefer ranges and distributions to point estimates. More honest, and they leave the user room to locate themselves.
- Never imply prediction about the individual. Occupation-level data supports "here's what this market looks like," never "here's how you'll do in it."
- No hedging pile-ups. One clear caveat beats three apologetic ones.

**No "marketability score."** A single number invites comparison, implies precision the data can't support, and edges toward selection-procedure territory the moment an employer can see it. Narrative with explicit ranges is more honest, safer, and a better fit for the voice above.

---

## 7. Caveats That Matter Now

- **Failure messages are descriptive for now.** When a title won't map to a SOC code, a cell is suppressed, or a source is missing from the snapshot, surface what specifically failed — optimized for troubleshooting during POC, not for polish. Revisit before real customers: "we couldn't classify your job title" reads very differently to a user than it does to us.
- **Suppressed cells.** OEWS suppresses small occupation × MSA combinations. Needs a documented fallback chain (MSA → state → national) and a message saying which level was actually used.
- **Attribution obligations.** O\*NET requires CC-BY attribution in-product. SWAA requires a specific citation. Both are trivial to satisfy but need to be designed into the UI, not bolted on.
- **Percentiles are not levels.** Repeated here because it's the easiest mistake to make and the hardest to walk back once it's in the copy.
- **Schema drift between vintages.** Federal file layouts change more often than expected. The per-run report in §2.1 is what catches it.

---

## 8. Parked — Placeholders for Later

Not needed for POC/MVP. Listed so we don't re-derive them.

- **Commercial postings vendors** — Lightcast (Emsi + Burning Glass), Revelio Labs (COSMOS), LinkUp (GlobalData), Coresignal. Deep history, real-time demand, occupation-level flow. Four-to-six-figure enterprise engagements; don't price before query patterns are stable.
- **Observed transitions** — Revelio transitions, Lightcast career pathways, LinkedIn Economic Graph, People Data Labs, Live Data Technologies. Upgrade path from O\*NET's theoretical adjacency to actual observed moves.
- **Federal microdata** — Census ACS PUMS (cohort and percentile framing), LEHD QWI (turnover), Job-to-Job Flows (observed industry moves), IPUMS (harmonized historical). Free but real engineering effort.
- **Compensation surveys** — Payscale, Salary.com CompAnalyst, ERI, Mercer, Radford, plus Levels.fyi, Pave, Ravio, Figures, Comprehensive.io. Note most prohibit *displaying* derived values, which constrains UI, not just budget.
- **Employer and company context** — Glassdoor/Blind/Comparably reviews, Crunchbase/PitchBook funding and headcount, SEC EDGAR human capital disclosures, DOL Form 5500 (benefits generosity, headcount cross-check), state WARN notices and layoffs.fyi, sponsorship history. Relevant to the employer-side profile workstream, not to job-seeker advice.
- **Skills taxonomies** — Lightcast Open Skills (free, API), ESCO (free, EU, ISCO crosswalks). Needed if we ever build skill-graph adjacency rather than relying on O\*NET.
- **International** — Eurostat, ESCO, ONS ASHE (UK), NOC/Job Bank (Canada), ILOSTAT, OECD, WageIndicator.
- **Proprietary corpus** — our own parsed resumes, transcripts, and eventually post-hire outcomes. The only source no competitor has, and the only one that can validate whether our advice was any good. Worth designing the schema for now even though the corpus is empty.

---

## 9. Remaining Open Questions

To pick up when the career planning section gets designed — not now.

1. **How is the career goal elicited?** A named target occupation, a direction ("more leadership," "out of healthcare"), or a set of constraints (pay floor, geography, hours)? Each implies a different SOC resolution path, and vague goals may not resolve to a SOC code at all.
2. **What happens with no clear goal?** Some users will arrive without one. Does the section shift to exploration — adjacency and interest-driven browsing — or does it require a goal before it runs?
3. **Does the plan have a horizon?** "Next role" and "five years out" pull on different data and produce very different training recommendations.
4. **Does personality data feed the plan?** By this point in the flow the trait profile exists. O\*NET Work Styles and Work Values are the obvious hooks, but using them to steer career recommendations is a much stronger claim than using them to describe fit. Worth deciding deliberately rather than by default.
5. **Recalculation trigger** — on profile change, on new data snapshot, on user request, or never. Deferred by design; the data layer stays agnostic either way.
