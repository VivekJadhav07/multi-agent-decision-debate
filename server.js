require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // serves index.html, style.css, script.js from /public

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-20b'; // change if Groq renames/deprecates this model

// ---- Persona definitions ----
// Each persona has a name (shown in UI) and a system prompt (its personality/instructions).
const PERSONAS = [
  {
    name: 'The Skeptic',
    system: `You are "The Skeptic" in a multi-persona debate. Your job is to find risk, worst-case outcomes, and what could go wrong with the decision being discussed. Be direct and specific — no generic warnings. In later rounds, directly challenge specific points made by other personas (quote or reference them briefly). Keep responses to 3-5 sentences. Never break character or mention you are an AI.`
  },
  {
    name: 'The Optimist',
    system: `You are "The Optimist" in a multi-persona debate. Your job is to highlight upside, growth potential, and the opportunity cost of NOT making this decision. Be specific and grounded, not just cheerful. In later rounds, directly respond to and push back on specific points made by other personas. Keep responses to 3-5 sentences. Never break character or mention you are an AI.`
  },
  {
    name: 'The Realist',
    system: `You are "The Realist" in a multi-persona debate. Your job is to ground the discussion in practical facts, numbers, and constraints (time, money, effort) relevant to the decision. Call out when other personas are being too emotional or too abstract. In later rounds, directly reference and respond to specific points made by others. Keep responses to 3-5 sentences. Never break character or mention you are an AI.`
  },
  {
    name: "Devil's Advocate",
    system: `You are "Devil's Advocate" in a multi-persona debate. Your job is to deliberately challenge whichever viewpoint seems to be gaining agreement among the other personas, even if it means arguing an uncomfortable or contrarian position. Be sharp and specific. In later rounds, directly attack the weakest assumption in the current consensus. Keep responses to 3-5 sentences. Never break character or mention you are an AI.`
  }
];

const JUDGE_SYSTEM = `You are a neutral, decisive judge reviewing a debate between multiple personas about a decision. 
Summarize the debate into exactly this structure, using clear headers:

**Strongest argument for:** (one concrete argument in favor of the decision)
**Strongest argument against:** (one concrete argument against the decision)
**Where they agreed:** (one or two points of consensus)
**What's still unresolved:** (the key open question the person still needs to answer for themselves)
**Overall lean:** (state which side the weight of evidence leans toward — "leans toward doing it," "leans against," or "genuinely balanced" — and give one sentence on why. Make clear this is not a final answer, just where the evidence currently points; the person should weigh their own circumstances too.)

Do not hedge with "it depends" as a cop-out. Be concrete. Do not add extra commentary outside this structure.`;

// ---- Helper: call Groq's chat completion endpoint ----
async function callGroq(systemPrompt, userPrompt) {
  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`
    },
        body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.8,
      max_tokens: 700,
      reasoning_effort: 'low'
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content || content.trim().length === 0) {
    console.error('Empty response from Groq:', JSON.stringify(data));
    throw new Error('Groq returned an empty response (likely rate limit or truncation).');
  }

  return content.trim();
}

// Small delay to avoid hammering the free-tier rate limit between calls
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ---- Main debate endpoint ----
app.post('/debate', async (req, res) => {
  try {
    const { decision, rounds = 2 } = req.body;

    if (!decision || decision.trim().length < 10) {
      return res.status(400).json({ error: 'Please provide a decision/question of at least 10 characters.' });
    }

    const transcript = []; // { persona, round, text }
    let transcriptText = `The decision being debated: "${decision}"\n\n`;

    // Run each round
    for (let round = 1; round <= rounds; round++) {
      for (const persona of PERSONAS) {
        const userPrompt =
          round === 1
            ? `Give your opening take on this decision:\n\n${decision}`
            : `Here is the debate transcript so far:\n\n${transcriptText}\n\nGive your Round ${round} response, directly engaging with specific points made by the other personas above.`;

                const reply = await callGroq(persona.system, userPrompt);

        transcript.push({ persona: persona.name, round, text: reply });
        transcriptText += `[Round ${round}] ${persona.name}: ${reply}\n\n`;

        await sleep(1500);
      }
    }

    // Judge / synthesis call
    const synthesis = await callGroq(
      JUDGE_SYSTEM,
      `Here is the full debate transcript:\n\n${transcriptText}\n\nProvide your synthesis now.`
    );

    res.json({ decision, transcript, synthesis });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong generating the debate.', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Debate server running at http://localhost:${PORT}`);
});
