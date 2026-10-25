// ─────────────────────────────────────────────────────────────────────────────
// SHARED CONTRACT: shape of content/question-bank.json. Owner: Part 4 (content).
// The server (Part 3) loads the JSON at startup and validates it against this.
// ─────────────────────────────────────────────────────────────────────────────

export interface Question {
  id: string; // L01, P01, D01...
  text: string;
  tags?: string[];
}

export interface CollabCard {
  id: string; // C01...
  /** Shown to each pair. May contain "{deep}", replaced by a random deep question. */
  text: string;
  /** What each partner submits (one line, <= LIMITS.collabMaxChars). */
  submitPrompt: string;
  tags?: string[];
}

export interface QuestionBank {
  _readme?: string;
  /** Order of rounds. Rounds 1–2 draw from tiers; round 3 draws a collab card. */
  rounds: ["light", "personal", "collab"];
  tiers: {
    light: Question[];
    personal: Question[];
    deep: Question[]; // only used inside collab cards via "{deep}"
  };
  collab: CollabCard[];
}
