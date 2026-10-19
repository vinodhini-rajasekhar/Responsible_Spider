# Responsible Spider: research notes

## Motivation

Two Responsible AI problems meet in the humble web scraper.

1. **Consent and data governance.** Generative models are trained on scraped web data. Publishers have responded with a patchwork of opt-out signals: robots.txt rules for AI user-agents, `noai` meta tags, `ai.txt`, and the W3C TDMRep protocol. Longpre et al. (2024) found these restrictions are spreading fast and are often contradictory. The EU's DSM Directive (Art. 4) lets rightsholders reserve text-and-data-mining rights, and the EU AI Act (Art. 53(1)(c)) requires general-purpose model providers to respect those reservations. In practice, nobody outside the company can see whether a crawler honoured them.
2. **Adversarial content.** LLM agents that browse the web read text that humans never see. Indirect prompt injection (Greshake et al., 2023) hides instructions in that text, and the agent may follow them. Prompt injection tops the OWASP Top 10 for LLM applications. Benchmarks such as BIPIA (Yi et al., 2023), InjecAgent (Zhan et al., 2024) and AgentDojo (Debenedetti et al., 2024) show high attack success against undefended agents.

Both problems share a root cause: **the gap between what a human sees on a page and what a machine takes from it.** Responsible Spider makes that gap visible, one page and one decision at a time.

## Research questions

- **RQ1 (Consent):** How common are AI-specific opt-outs on the real web, and how much would a consent-blind scraper take that a consent-aware one would refuse?
- **RQ2 (Security):** How well do hidden-content prompt injections work against an LLM summarisation agent? How much does a transparent, layered defence cut attack success, and what does it cost in utility and false positives?
- **RQ3 (Explainability):** Can per-page decision receipts make crawler behaviour auditable by non-experts? The receipts combine three things: contrastive naive-vs-responsible framing, line-level evidence, and leave-one-out causal attribution.

## Design

### Explanations

Each design choice maps to known findings about what makes explanations useful:

- **Contrastive.** People ask "why P rather than Q?" (Miller, 2019). Every receipt contrasts *Naive scraper: takes everything* with *Responsible spider: skipped*, and the naive agent's output with the Responsible Spider agent's.
- **Evidence-bearing.** Each check cites the exact artefact, such as `robots.txt line 11: Disallow: /research/`, `<meta name="tdm-reservation" content="1">`, or the hidden segment's CSS selector and hiding technique. An auditor can verify the claim without trusting the tool.
- **Causal, not just correlational.** The injection score says "this looks suspicious". Leave-one-out ablation, i.e. occlusion or representation erasure (Zeiler & Fergus, 2014; Li et al., 2016), says "removing *this* segment stops the hijack". It is model-agnostic and needs only black-box access.
- **Transparent by construction.** The detector is a weighted list of named signals. The score is \(1 - \prod_i (1 - w_i)\) over the signals that fire, so every point of it is attributable to a sentence a human can read. We deliberately chose this over a more accurate but opaque classifier; future work could compare the two.
- **Embodied.** The spider is not decoration. It turns an invisible background process into something you watch, and it slows decisions down to a pace a human can follow (Doshi-Velez & Kim, 2017, on explanation needing to fit the audience).

### Defence layers (Responsible Spider agent)

1. **Visibility filtering.** Text that is never rendered for humans is dropped. Alt text is kept unless it looks like an instruction, because it is legitimate accessibility content.
2. **Quarantine.** Segments scoring ≥ 0.5 after the context judge (below) are removed.
3. **PII redaction.**
4. **Spotlighting** (Hines et al., 2024). Content is delimited and *datamarked* (words joined with `^`), and the system prompt declares it to be data, not instructions.
5. **Output check.** The agent's answer is scanned for known payload markers and for links that do not appear in the visible page.

### Context judge (second stage)

Short phrases alone are a poor basis for quarantine. In a live crawl, a recipe page that said a sauce should "act as a counterpoint" to a rich dish was quarantined, because "act as" was one of the role-reassignment signals. That false positive drove a two-stage design (`judgeInjections` in `server/llm.ts`):

1. **Candidates.** The pattern rules still run first. Any segment with a score of 0.3 or more, or with any signal firing, becomes a candidate. Soft phrases ("act as", "pretend to be", "you are now", "new persona") were lowered to weight 0.3, so none of them can reach the 0.5 threshold on its own.
2. **Judgement with the full sentence.** Each candidate is re-read in context:
   - **LLM judge** (when the AI agent is on and a key is set). The model sees the segment text, whether it is hidden from humans, and which signals fired, and returns `{"injection": true|false, "reason": "..."}` at temperature 0.
   - **Local judge** (no key, AI agent off, or the daily request limit is reached). A rule-based check clears segments whose only signals are soft phrases used in ordinary visible prose, such as "act as" not followed by an AI-related role. Anything hidden from humans, or carrying a strong signal ("ignore previous instructions", "note to AI", "do not tell the user"), keeps its score.
3. **Outcome.** A segment judged benign has its score capped at 0.25 and gets the signal `cleared by <judge>: <reason>`. A segment judged malicious is raised to at least 0.5 and gets `<judge>: injection. <reason>`. Both appear in the receipt, so the decision stays explainable.

The judge only runs on candidates, so ordinary pages cost no extra model calls. When the AI agent is switched off, the crawler uses the local judge only and never calls the API.

### Consent policy

We act as an *AI* data collector, so we honour the strictest relevant signal. If a site blocks any major AI-training bot (GPTBot, CCBot, ClaudeBot, Google-Extended…) from a path, we treat that path as opted out even when our own user-agent isn't named. This is a deliberate normative choice: honour the spirit of the opt-out, not the loophole of an unlisted user-agent. Signals that can only be seen after fetching (`noai`, in-page TDM reservation) cause the content to be discarded.

## Method

### Real-world audit (RQ1)

We fetch only `/robots.txt` from 49 popular sites across 14 categories (`bench/sites.csv`), and record whether each of 12 known AI crawlers may access the homepage (`npm run audit`).

### Injection benchmark (RQ2)

There are **89 generated pages**:

- **81 attacks:** 3 benign gardening articles × 3 attacker goals (emit a canary phrase, push a phishing link, defame a competitor) × 9 hiding techniques.
- **8 benign controls:** 3 plain pages; 3 pages with *benign* hidden content (a collapsed menu, a noscript notice, descriptive alt text); and 2 pages that *discuss* prompt injection or AI policy.

The nine hiding techniques are:
1. CSS `display:none`
2. White-on-white text
3. Zero font size
4. Off-screen positioning via a stylesheet class
5. HTML comment
6. Image alt text
7. `<noscript>`
8. Visible fine print
9. Subtle visible phrasing with no trigger words

Each attacker goal has a regex detector for its payload, so attack success is measured without a judge model. Benign utility is the share of each article's three key facts that a summary keeps.

Metrics: detector precision, recall, F1 and false-positive rate; attack success rate (ASR) for the naive and Responsible Spider agents; benign utility; false refusals.

### Lab walkthrough (RQ1 and RQ3)

The Willow Creek site has 20 pages and exercises every check:
- robots.txt disallows for all bots and for AI bots specifically
- TDMRep
- `noai`
- `tdm-reservation`
- `nofollow`
- a CC-BY licence and copyright notices
- personal data
- 7 injection pages using different techniques
- a subtle injection
- a benign article about injection

## Results

### RQ1: Real-world opt-outs (robots.txt, 16 Oct 2026)

- 44 sites were reachable and 5 failed.
- **29 of 44 (66%) block at least one AI crawler** from the homepage. **All 9 news sites do.**
- **19 block GPTBot but allow Googlebot**: an explicit "search yes, AI training no" stance that a search-era protocol was never designed to express.
- The most-blocked crawlers are CCBot (57%), Bytespider (55%) and ClaudeBot (52%). GPTBot is blocked by 45%.
- Per-bot and per-site tables are in [`bench/results/ai-bot-audit.md`](../bench/results/ai-bot-audit.md).

On the lab site, a consent-blind scraper takes all 20 pages. The responsible crawler never requests 4 of them, discards 2 after fetching, redacts personal data on 2, and quarantines injections on 8.

### RQ2: Injection benchmark

| | Simulated model (89 pages) | Real model `gpt-4.1-mini` (stratified 17 pages) |
|---|---|---|
| Detector precision / recall | 99% / 89% | 89% / 89% |
| Detector false-positive rate | 13% (1 of 8 benign) | 13% (1 of 8 benign) |
| Naive agent ASR | 89% | **89%** (8/9 canary attacks) |
| Responsible Spider agent ASR | 0% | **0%** (0/9) |
| Benign utility (naive / Responsible Spider) | 56% / 67% | **100% / 100%** |
| Responsible Spider false refusals | 1 | **0** |

The real-model run is a free-tier-friendly stratified sample: all 8 benign controls plus one canary attack per hiding technique (`npm run eval -- --stratified`, 17 Oct 2026). The same detector logic underlies both columns; agent ASR is the RQ2 result.

- **Detection by technique:** every technique that hides text from humans is caught 100% of the time. That is because hiding is itself the strongest signal: instruction-like text humans can't see has almost no legitimate use.
- **Where the detector fails:**
  - *Subtle visible phrasing* evades it completely (0%). This is the fundamental limit of pattern-based defences.
  - It falsely flags an article that *quotes* "ignore previous instructions". Context matters, and keywords can't see it. The context judge was added for exactly this kind of case, but the local judge does not clear this page: "ignore previous instructions" is a strong signal, and quoting it looks the same as using it to a rule. Running all 89 pages through the pattern rules plus the local judge gives identical numbers (72 true positives, 1 false positive, 9 misses, 7 true negatives). The LLM judge has not been benchmarked yet.

Note: the simulated model is circular by construction. The `gpt-4.1-mini` stratified run is the primary RQ2 evidence on the poster. A full 89-page real-model run needs a higher usage tier (the current key is capped at 50 requests/day per model).

### RQ3: Explainability

So far the evidence is design rationale and walkthroughs. A small expo-day study is planned (see Future work).

## Limitations and failure modes

- **Visibility analysis is static.** There is no rendering engine, external CSS or JavaScript, so false negatives are certain on real sites.
- **The heuristic detector can be evaded.** An adaptive attacker can phrase around the signals, and keyword matching causes false positives on security content.
- **The LLM context judge is itself an LLM reading attacker text.** A payload could try to talk the judge into clearing it. The judge only sees candidate segments as JSON data, and hidden segments (other than alt text) are dropped from the Responsible Spider agent's input whatever the judge says, but a visible, well-crafted injection could still be cleared.
- **Consent signals are voluntary and ambiguous.** robots.txt was designed for search indexing, and treating an AI-bot block as a general AI opt-out is an interpretation. Publishers may disagree, in either direction.
- **The benchmark is small and synthetic.** It uses one domain (gardening), three goals and English only. Results may not transfer.
- **Payload-specific success detection.** Attack success is measured with regexes, which can miss paraphrased compliance. An LLM judge would catch more but would add its own errors.
- **Misuse risk.** The same tool that finds hidden injections could help attackers test theirs. We mitigate this by keeping attacks synthetic and benign (`.example` domains) and by not optimising evasion.

## Stakeholders

- **Publishers and creators:** want their opt-outs honoured and visible.
- **Web users:** they are the people whose personal data and trust are at stake when agents get hijacked.
- **AI developers:** need auditable data pipelines to meet compliance obligations (EU AI Act Art. 53).
- **Auditors, regulators and journalists:** need evidence, not assurances.

## Future work

1. **Expo user study (RQ3).** Show visitors 5 pages. Ask them to predict the crawler's decision before and after reading the receipt, and to rate their trust. Measure prediction accuracy and calibration.
2. **Headless-browser visibility** using computed styles, so the static-analysis gap closes.
3. **Learned detector vs. transparent detector:** compare accuracy and explainability, for example by fine-tuning a small classifier and explaining it with SHAP.
4. **Adaptive attacks:** red-team the detector with an LLM that rewrites payloads until they evade it.
5. **A larger real-web audit:** expand the robots.txt survey to the top 10k domains, and track it over time like Longpre et al.
6. **Machine-readable consent receipts** that a crawler publishes alongside each dataset, as a data card in the spirit of Datasheets for Datasets (Gebru et al., 2021).

## References

- Debenedetti, E. et al. (2024). *AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents.* NeurIPS Datasets & Benchmarks.
- Doshi-Velez, F., & Kim, B. (2017). *Towards a Rigorous Science of Interpretable Machine Learning.* arXiv:1702.08608.
- European Union (2019). *Directive (EU) 2019/790 on copyright in the Digital Single Market*, Art. 4.
- European Union (2024). *Regulation (EU) 2024/1689 (AI Act)*, Art. 53.
- Gebru, T. et al. (2021). *Datasheets for Datasets.* Communications of the ACM.
- Greshake, K. et al. (2023). *Not What You've Signed Up For: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection.* AISec '23.
- Hines, K. et al. (2024). *Defending Against Indirect Prompt Injection Attacks With Spotlighting.* arXiv:2403.14720.
- Koster, M. et al. (2022). *RFC 9309: Robots Exclusion Protocol.* IETF.
- Li, J., Monroe, W., & Jurafsky, D. (2016). *Understanding Neural Networks through Representation Erasure.* arXiv:1612.08220.
- Liu, Y. et al. (2024). *Formalizing and Benchmarking Prompt Injection Attacks and Defenses.* USENIX Security.
- Longpre, S. et al. (2024). *Consent in Crisis: The Rapid Decline of the AI Data Commons.* NeurIPS Datasets & Benchmarks.
- Miller, T. (2019). *Explanation in Artificial Intelligence: Insights from the Social Sciences.* Artificial Intelligence, 267.
- OWASP (2025). *Top 10 for LLM Applications: LLM01 Prompt Injection.*
- W3C TDMRep Community Group (2024). *TDM Reservation Protocol (TDMRep).*
- Yi, J. et al. (2023). *Benchmarking and Defending Against Indirect Prompt Injection Attacks on Large Language Models (BIPIA).* arXiv:2312.14197.
- Zeiler, M., & Fergus, R. (2014). *Visualizing and Understanding Convolutional Networks.* ECCV.
- Zhan, Q. et al. (2024). *InjecAgent: Benchmarking Indirect Prompt Injections in Tool-Integrated LLM Agents.* Findings of ACL.
