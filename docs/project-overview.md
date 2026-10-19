# Responsible Spider: project overview

## 1. Introduction

AI systems increasingly **scrape the web** to train models and to power “browse for me” agents. Those scrapers are usually invisible. You cannot easily see whether they:

- honoured a site’s **AI opt-out** (`robots.txt` rules for GPTBot/CCBot, `noai`, TDMRep, `ai.txt`)
- vacuumed up **personal data** (emails, phones, card numbers)
- obeyed **hidden instructions** aimed at AIs (indirect prompt injection)

Both problems share one gap: **what a human sees on a page vs. what a machine takes from the HTML.**

**Responsible Spider** is an interactive demo and research artifact that makes that gap visible. An animated spider walks a live map of a website. At each page it stops, decides, and shows a **decision receipt**: why the page was collected, redacted, quarantined, or skipped, and how a naive AI summariser vs. the Responsible Spider agent each behaved.

It sits at the intersection of:

- **Explainable AI (XAI):** transparent, evidence-bearing decisions
- **Adversarial AI / red-teaming:** hidden-text prompt injection
- **AI governance:** consent signals for training and crawling

---

## 2. Methods

### 2.1 System pipeline

For each URL the crawler:

1. Loads site policy (`robots.txt`, `ai.txt`, `/.well-known/tdmrep.json`)
2. Decides whether it may **fetch** the page (consent)
3. Extracts text into **segments** and marks which ones are invisible to humans
4. Scores segments for **prompt-injection**-like language
5. Detects and **redacts PII**
6. Emits a **receipt** (UI + log)
7. Optionally runs two AI agents: **naive** vs **Responsible Spider**

The spider visualisation is the embodiment layer: pages are nodes on a radial “web”; the spider walks to each node as decisions arrive.

### 2.2 Consent layer (governance)

We treat ourselves as an **AI data collector**, so we honour the strictest relevant signal:

| Signal | Action |
|---|---|
| `robots.txt` blocks us or major AI-training bots | Do not fetch (or shadow-fetch only on the lab site for comparison) |
| `noai` / `noimageai` | Discard after fetch |
| TDMRep / `tdm-reservation` | Discard / skip reserved paths |
| `ai.txt` | Honour disallow rules |
| Licence / copyright notices | Warn when reuse is restricted |

### 2.3 Privacy layer

Regex + Luhn validation for emails, phones, SSNs, card numbers, and IPs. Matches are redacted before storage or model input.

### 2.4 Security layer (prompt injection)

**Visibility analysis (static):** detect text hidden via `display:none`, white-on-white, zero font size, off-screen CSS, HTML comments, alt text, `<noscript>`, etc.

**Transparent injection scorer:** weighted, named signals (e.g. “ignore previous instructions”, “note to AI”, role reassignment). Score = \(1 - \prod(1 - w_i)\). Segments above threshold **0.5** are quarantined.

**Responsible Spider agent defences (stacked):**

1. Drop human-invisible text  
2. Quarantine high-score segments  
3. Redact PII  
4. **Spotlight** remaining content as untrusted data (datamarking)  
5. Check the model output for known payload markers / unexpected links  

**Causal explanation:** leave-one-out ablation. Re-run the naive agent without each suspicious segment; if the hijack stops, that segment is marked **causal**.

### 2.5 Evaluation methods

1. **Lab site:** Willow Creek Community Garden: 20 pages with opt-outs, PII, and 9 injection techniques  
2. **Injection benchmark:** 89 generated pages (81 attacks + 8 benign controls); stratified 17-page real-model sample for free-tier quotas  
3. **Real-web audit:** `robots.txt` only, 49 popular sites × 12 AI crawlers  

---

## 3. Results and evaluation metrics

### 3.1 Metrics we report

| Metric | Meaning |
|---|---|
| **Detector precision / recall / F1** | How well the scorer flags attack pages vs benign |
| **False-positive rate (FPR)** | Share of benign pages wrongly flagged |
| **Attack success rate (ASR)** | Share of attacks where the agent’s output matches the attacker’s goal (canary / phishing link / smear) |
| **Benign utility** | Share of key article facts kept in the summary |
| **False refusals** | Benign pages where the Responsible Spider agent wrongly refuses |
| **Opt-out prevalence** | Share of real sites blocking ≥1 AI crawler in `robots.txt` |

### 3.2 Key results

**Real web (robots.txt audit, 44 reachable sites)**

- **66%** block at least one AI crawler  
- **9/9** news sites do  
- **19** block GPTBot but still allow Googlebot (“search yes, AI training no”)

**Injection benchmark, real model `gpt-4.1-mini` (stratified 17 pages)**

| | Naive agent | Responsible Spider agent |
|---|---|---|
| Attack success rate | **89%** | **0%** |
| Benign utility | 100% | 100% |
| Detector precision / recall | 89% / 89% | n/a |
| False-positive rate | 13% (article *about* injection) | n/a |

**By hiding technique:** every *hidden*-text technique was detected 100%. The only miss was **subtle visible phrasing** (no trigger words): 0% detected, and the naive agent was not hijacked by that soft phrasing either in this sample.

**Lab walkthrough:** on the garden site, a consent-blind scraper would take everything; the responsible spider skips opted-out paths, redacts member PII, and quarantines injected blog posts, with receipts showing exactly why.

### 3.3 Limitations (honest)

- Visibility analysis is **static** (no full browser render / JS)  
- Keyword detector can be **evaded** and can false-positive on security writing  
- Free-tier API caps forced a **stratified** real-model sample (full 89-page real run needs higher rate limits)  
- Consent signals are **voluntary** and sometimes ambiguous  

---

## 4. Novelty

What is new / distinctive about this project:

1. **Unified consent + security crawler with live XAI**  
   Most tools do either robots compliance *or* injection defence. This couples both and explains each decision as it happens.

2. **Contrastive, evidence-bearing receipts**  
   Every page shows *naive vs responsible* and *naive agent vs Responsible Spider agent*, with the exact robots line, CSS trick, or text segment as evidence, not just a risk score.

3. **Causal, not only correlational, explanations**  
   Leave-one-out ablation answers: “which hidden paragraph *caused* the hijack?”

4. **Transparent detector by design**  
   Named weighted signals instead of an opaque classifier. Failures (subtle phrasing; security articles) are interpretable and teachable.

5. **Embodied visualisation**  
   The procedural spider on a site “web” turns an invisible backend process into something a non-expert can watch at Expo: memorable without being only decorative.

6. **Reproducible lab + benchmark + real-web audit in one artifact**  
   Demo site, 89-page attack suite, and a robots.txt survey ship together so others can re-run the evaluation.

In short: **Responsible Spider is not “just a scraper” and not “just a spider animation.”** It is an explainable interface for the responsible-AI question: *when an AI reads the web, what did it take, what did it refuse, and what tried to hijack it?*
