/**
 * Heuristic indirect-prompt-injection scorer. Each signal has a weight; scores
 * combine as independent evidence: 1 - Π(1 - w). Deliberately transparent:
 * every point of the score maps to a named, human-readable signal.
 */
interface Signal {
  name: string;
  weight: number;
  re: RegExp;
}

const SIGNALS: Signal[] = [
  { name: 'override: "ignore previous instructions"', weight: 0.75, re: /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|earlier|all|your|system)\b[^.]{0,20}\b(instructions?|prompts?|rules|directions)\b/i },
  { name: 'addresses an AI system directly', weight: 0.45, re: /\b(AI|LLM|language model|assistant|chatbot|summari[sz]er|GPT|agent|crawler|model)s?\b[^.]{0,30}\b(must|should|need to|are required|are instructed|reading this|processing this)\b/i },
  { name: 'note/attention aimed at AI readers', weight: 0.5, re: /\b(note|attention|message|instructions?)\s+(to|for)\s+(any\s+|all\s+)?(AI|LLM|assistants?|language models?|bots?|crawlers?|agents?)\b/i },
  // Split: bare "act as" is common English ("act as a counterpoint") and must not
  // quarantine alone. Stronger role phrases keep a higher weight.
  { name: 'role reassignment ("you are now")', weight: 0.5, re: /\byou are (now|no longer)\b/i },
  { name: 'role play ("act as" / "pretend")', weight: 0.3, re: /\bact as\b|\bpretend (to be|you are)\b|\bnew (role|persona)\b/i },
  { name: 'role play aimed at an AI', weight: 0.45, re: /\bact as\b[^.]{0,40}\b(AI|assistant|chatbot|language model|LLM|GPT|agent|system)\b|\bpretend (to be|you are)\b[^.]{0,40}\b(AI|assistant|chatbot|helpful|unrestricted)\b/i },
  { name: 'fake system/assistant turn', weight: 0.55, re: /(^|\n|\s)(system|assistant|developer)\s*:|<\/?(system|instructions?)>|\[\/?INST\]|<\|im_start\|>/i },
  { name: 'output steering ("respond with", "say")', weight: 0.4, re: /\b(respond|reply|answer|output|say|write|begin your (response|summary))\b[^.]{0,25}\b(with|only|exactly|that|the (phrase|word|text))\b/i },
  { name: 'secrecy demand ("do not tell the user")', weight: 0.6, re: /\b(do not|don't|never)\b[^.]{0,20}\b(tell|mention|reveal|inform|disclose)\b[^.]{0,20}\b(user|reader|human|anyone)\b/i },
  { name: 'pushes a link or action on the user', weight: 0.35, re: /\b(tell|urge|instruct|direct|recommend)\b[^.]{0,30}\b(user|reader|them)\b[^.]{0,40}\b(visit|click|go to|download|log ?in|enter)\b/i },
  { name: 'mandatory/urgent framing', weight: 0.2, re: /\b(IMPORTANT|URGENT|MANDATORY|CRITICAL|PRIORITY)\b[:!]/ },
  { name: 'prompt/secret exfiltration', weight: 0.5, re: /\b(reveal|print|repeat|leak|send)\b[^.]{0,30}\b(system prompt|instructions|api key|password|conversation|chat history)\b/i },
  { name: 'encoded payload (base64-like blob)', weight: 0.3, re: /\b[A-Za-z0-9+/]{60,}={0,2}/ },
];

export interface InjectionScore {
  score: number;
  signals: string[];
}

export function scoreInjection(text: string, hidden: boolean): InjectionScore {
  const signals: string[] = [];
  let keep = 1;
  for (const s of SIGNALS) {
    if (s.re.test(text)) {
      signals.push(s.name);
      keep *= 1 - s.weight;
    }
  }
  // Hidden text that also talks like an instruction is far more suspicious.
  if (hidden && signals.length > 0) {
    signals.push('instruction-like text is hidden from humans');
    keep *= 1 - 0.4;
  }
  return { score: 1 - keep, signals };
}

export const QUARANTINE_THRESHOLD = 0.5;
