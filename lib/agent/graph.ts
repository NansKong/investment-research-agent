import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { StateGraph, MessagesAnnotation, END, START } from "@langchain/langgraph";
import { ChatReplicate } from "./chat-replicate";
import { extractJson } from "./json-utils";
import { webSearch, stockQuote, bindSourceSink } from "./tools";
import { RESEARCH_SYSTEM_PROMPT, DECISION_SYSTEM_PROMPT } from "./prompts";
import { InvestmentDecisionSchema, type AgentRunResult, type Source } from "./types";

const MAX_RESEARCH_STEPS = 10;

/**
 * Builds the graph fresh per request (cheap to construct) so we can bind a
 * request-scoped source sink and emit log lines via the onLog callback.
 */
function buildGraph(onLog: (line: string) => void) {
  const researchModel = new ChatReplicate({ temperature: 0.2 });

  async function agentNode(state: typeof MessagesAnnotation.State) {
    onLog("Analyst is researching...");
    const response = await researchModel.invoke(state.messages);
    const responseText =
      typeof response.content === "string" ? response.content : JSON.stringify(response.content);

    let parsed: any;
    try {
      parsed = extractJson(responseText);
    } catch {
      // JSON parsing failed — ask the model to retry
      onLog("Model output wasn't valid JSON, retrying...");
      return {
        messages: [
          new AIMessage(responseText),
          new HumanMessage(
            "Your last reply wasn't valid JSON. Remember: reply with ONLY a JSON object, no prose, no markdown fences. Try again."
          ),
        ],
      };
    }

    const action = parsed.action;

    if (action === "finish") {
      onLog("Research complete.");
      return {
        messages: [new AIMessage(responseText)],   // keep the raw JSON, not parsed.brief
      };
    }

    if (action === "web_search" && parsed.query) {
      onLog(`Searching web: "${parsed.query}"`);
      const result = await webSearch(parsed.query);
      return {
        messages: [
          new AIMessage(responseText),
          new HumanMessage(`Tool result for web_search("${parsed.query}"):\n\n${result}`),
        ],
      };
    }

    if (action === "stock_quote" && parsed.ticker) {
      onLog(`Looking up stock quote: ${parsed.ticker}`);
      const result = await stockQuote(parsed.ticker);
      return {
        messages: [
          new AIMessage(responseText),
          new HumanMessage(`Tool result for stock_quote("${parsed.ticker}"):\n\n${result}`),
        ],
      };
    }

    // Unknown action — ask the model to retry
    onLog("Model output had unknown action, retrying...");
    return {
      messages: [
        new AIMessage(responseText),
        new HumanMessage(
          `Unknown action "${action}". Valid actions are: web_search, stock_quote, finish. Reply with ONLY a JSON object.`
        ),
      ],
    };
  }

  function shouldContinue(state: typeof MessagesAnnotation.State) {
    const last = state.messages[state.messages.length - 1];
    const lastContent =
      typeof last.content === "string" ? last.content : JSON.stringify(last.content);

    if (last._getType() === "ai") {
      try {
        const parsed = extractJson(lastContent);
        if ((parsed as any).action === "finish") return END;
      } catch {
        // not valid JSON — loop back, but still subject to the cap below
      }
    }

    // Count every agent turn (any AI message), not just successful tool calls —
    // this guarantees termination even if the model gets stuck on bad JSON/unknown actions.
    const agentTurnCount = state.messages.filter((m) => m._getType() === "ai").length;
    if (agentTurnCount >= MAX_RESEARCH_STEPS) {
      return END;
    }

    return "agent";
  }

  const researchGraph = new StateGraph(MessagesAnnotation)
    .addNode("agent", agentNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue, { agent: "agent", [END]: END })
    .compile();

  return researchGraph;
}

export async function runInvestmentResearch(
  companyName: string,
  onLog: (line: string) => void = () => { }
): Promise<AgentRunResult> {
  const start = Date.now();
  const sources: Source[] = [];
  bindSourceSink(sources);

  const researchGraph = buildGraph(onLog);

  const researchResult = await researchGraph.invoke({
    messages: [
      new SystemMessage(RESEARCH_SYSTEM_PROMPT),
      new HumanMessage(`Research this company thoroughly: "${companyName}"`),
    ],
  });

  const lastMessage = researchResult.messages[researchResult.messages.length - 1];
  let researchBrief =
    typeof lastMessage.content === "string" ? lastMessage.content : JSON.stringify(lastMessage.content);

  // If the last message is a JSON finish action, extract the brief
  try {
    const parsed = extractJson(researchBrief);
    if ((parsed as any).action === "finish" && (parsed as any).brief) {
      researchBrief = (parsed as any).brief;
    }
  } catch {
    // Not JSON — use as-is
  }

  onLog("Research complete. Handing brief to Investment Committee for a decision...");

  // --- Decision step: call ChatReplicate, parse JSON, validate with Zod, retry once on failure ---
  const decisionModel = new ChatReplicate({ temperature: 0.1 });

  const decisionMessages = [
    new SystemMessage(DECISION_SYSTEM_PROMPT),
    new HumanMessage(
      `Company being evaluated: "${companyName}"\n\nResearch brief:\n\n${researchBrief}\n\nRender your final verdict now.`
    ),
  ];

  let decision: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    const decisionResponse = await decisionModel.invoke(decisionMessages);
    const decisionText =
      typeof decisionResponse.content === "string"
        ? decisionResponse.content
        : JSON.stringify(decisionResponse.content);

    try {
      const raw = extractJson(decisionText);
      const result = InvestmentDecisionSchema.safeParse(raw);
      if (result.success) {
        decision = result.data;
        break;
      }
      // Validation failed — add error context and retry
      onLog(`Decision validation failed (attempt ${attempt + 1}), retrying...`);
      decisionMessages.push(new AIMessage(decisionText));
      decisionMessages.push(
        new HumanMessage(
          `Your output didn't match the required schema. Validation errors:\n${JSON.stringify(result.error.issues, null, 2)}\n\nPlease try again with the exact JSON structure specified in the system prompt.`
        )
      );
    } catch (e) {
      // JSON extraction failed — add error context and retry
      onLog(`Decision JSON parse failed (attempt ${attempt + 1}), retrying...`);
      decisionMessages.push(new AIMessage(decisionText));
      decisionMessages.push(
        new HumanMessage(
          `Your last reply wasn't valid JSON. Reply with ONLY a JSON object matching the schema in the system prompt. No prose, no markdown fences.`
        )
      );
    }
  }

  if (!decision) {
    throw new Error("Failed to get a valid investment decision after 2 attempts.");
  }

  onLog("Decision rendered.");

  const researchLog = researchResult.messages
    .filter((m) => typeof m.content === "string" && m.content.length > 0)
    .map((m) => `[${m.getType()}] ${m.content}`);

  return {
    decision,
    sources: dedupeSources(sources),
    researchLog,
    durationMs: Date.now() - start,
  };
}

function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    if (!s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
  }
  return out;
}
