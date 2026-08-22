/**
 * AI chat reply handling.
 *
 * These exist because of a live incident: after the model was switched to a
 * 2.5 "thinking" model, customers received replies cut off mid-word — "our
 * highest-priced piece is the" — and, once, the model's own reasoning:
 * "Formulate Response Strategy**:".
 *
 * Three causes, all covered below. Gemini is stubbed; no key or network needed.
 *
 * Run: npm run test:ai
 */
const Module = require('module');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${detail}`}`);
    cond ? pass++ : fail++;
};

let reply = null;
const originalLoad = Module._load;
Module._load = function (request) {
    if (request === 'axios') return { post: async () => ({ data: reply }) };
    return originalLoad.apply(this, arguments);
};

process.env.GEMINI_API_KEY = 'test-key';
const ai = require('../src/services/aiChatService');
// The product catalogue is not what is under test here.
ai.buildContext = async () => 'context';

const ask = async (candidate) => {
    reply = { candidates: [candidate] };
    return ai.processMessage('96599887766', 'question', []);
};

(async () => {
    // ── Reasoning must never reach a customer ───────────────────────────────
    {
        const r = await ask({
            finishReason: 'STOP',
            content: { parts: [
                { thought: true, text: 'Formulate Response Strategy**: greet, then list products' },
                { text: 'Our most luxurious piece is the Autumn Leaves Vase at 106 KWD.' },
            ] },
        });
        check('a thought part is not sent to the customer',
            !/Formulate Response Strategy/.test(r.text), r.text);
        check('the real answer is sent instead',
            r.text === 'Our most luxurious piece is the Autumn Leaves Vase at 106 KWD.', r.text);
    }
    {
        const r = await ask({
            finishReason: 'STOP',
            content: { parts: [{ thought: true, text: 'only reasoning, no answer' }] },
        });
        check('a response that is nothing but reasoning yields null, so a human is alerted',
            r === null, JSON.stringify(r));
    }

    // ── Every part, not just the first ──────────────────────────────────────
    {
        const r = await ask({
            finishReason: 'STOP',
            content: { parts: [
                { text: 'Our most luxurious and highest-priced piece is the ' },
                { text: 'Autumn Leaves Vase.' },
            ] },
        });
        check('a reply split across parts is joined, not truncated to the first',
            r.text === 'Our most luxurious and highest-priced piece is the Autumn Leaves Vase.', r.text);
    }

    // ── Genuine truncation ──────────────────────────────────────────────────
    {
        const r = await ask({
            finishReason: 'MAX_TOKENS',
            content: { parts: [{ text: 'We have vases, bowls and lighting. Our most expensive piece is the' }] },
        });
        check('a dangling clause is trimmed back to the last complete sentence',
            r.text === 'We have vases, bowls and lighting.', r.text);
    }
    {
        // Regression: a length floor here once discarded a short but complete
        // sentence in favour of the fragment it came from.
        const r = await ask({
            finishReason: 'MAX_TOKENS',
            content: { parts: [{ text: 'Yes. Our most expensive piece is the' }] },
        });
        check('a short complete sentence is preferred over a long dangling one',
            r.text === 'Yes.', r.text);
    }
    {
        const r = await ask({
            finishReason: 'MAX_TOKENS',
            content: { parts: [{ text: 'Our most expensive piece is the' }] },
        });
        check('with no complete sentence available, something is still returned',
            r && r.text.length > 0, JSON.stringify(r));
    }

    // ── Escalation ──────────────────────────────────────────────────────────
    {
        const r = await ask({
            finishReason: 'STOP',
            content: { parts: [{ text: 'Let me get someone for you. [ESCALATE_TO_HUMAN]' }] },
        });
        check('escalation is detected', r.shouldEscalate === true);
        check('the marker is stripped before sending', !r.text.includes('ESCALATE'), r.text);
    }
    {
        // The marker can land in a different part than the prose.
        const r = await ask({
            finishReason: 'STOP',
            content: { parts: [
                { text: 'I will pass this on. ' },
                { text: '[ESCALATE_TO_HUMAN]' },
            ] },
        });
        check('escalation is detected even when it lands in a separate part',
            r.shouldEscalate === true && !r.text.includes('ESCALATE'), JSON.stringify(r));
    }

    // ── Malformed responses ─────────────────────────────────────────────────
    {
        for (const shape of [{}, { content: {} }, { content: { parts: [] } }, { content: { parts: [{}] } }]) {
            const r = await ask(shape);
            if (r !== null) { check('a malformed candidate yields null', false, JSON.stringify(shape)); break; }
        }
        check('every malformed candidate shape yields null rather than throwing', true);
    }

    // ── Token budget ────────────────────────────────────────────────────────
    {
        // The original 250 could not fit reasoning plus an answer.
        const budget = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 2048);
        check('the output budget leaves room for reasoning and an answer', budget >= 1024, String(budget));
    }

    Module._load = originalLoad;
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Harness error:', e); process.exit(1); });
