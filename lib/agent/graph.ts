import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { StateGraph, MessagesAnnotation, END, START } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatReplicate } from "./chat-replicate";
import { extractJson } from "./json-utils";
import { allTools, bindSourceSink } from "./tools";
import { RESEARCH_SYSTEM_PROMPT, DECISION_SYSTEM_PROMPT } from "./prompts";
import { InvestmentDecisionSchema, type AgentRunResult, type Source } from "./types";

const MAX_RESEARCH_STEPS = 10;

/**
 * Builds the graph fresh per request (cheap to construct) so we can bind a
 * request-scoped source sink and emit log lines via the onLog callback.
 */
function buildGraph(onLog: (line: string) => void) {
  const researchModel = new ChatReplicate({ temperature: 0.2 }).bindTools(allTools);
  const toolNode = new ToolNode(allTools);

  async function researchNode(state: typeof MessagesAnnotation.State) {
    onLog("Analyst is researching...");
    const response = await researchModel.invoke(state.messages);
    return { messages: [response] };
  }

  function shouldContinue(state: typeof MessagesAnnotation.State) {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const toolCallCount = state.messages.filter(
      (m) => m instanceof AIMessage && m.tool_calls?.length
    ).length;
    if (last.tool_calls && last.tool_calls.length > 0 && toolCallCount < MAX_RESEARCH_STEPS) {
      for (const call of last.tool_calls) {
        if (call.name === "web_search" && call.args?.query) {
          onLog(`Searching web: "${call.args.query}"`);
        } else if (call.name === "stock_quote" && call.args?.ticker) {
          onLog(`Fetching stock quote: "${call.args.ticker}"`);
        }
      }
      return "tools";
    }
    return END;
  }

  const researchGraph = new StateGraph(MessagesAnnotation)
    .addNode("agent", researchNode)
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue, { tools: "tools", [END]: END })
    .addEdge("tools", "agent")
    .compile();

  return researchGraph;
}

export async function runInvestmentResearch(
  companyName: string,
  onLog: (line: string) => void = () => {}
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
  const researchBrief =
    typeof lastMessage.content === "string" ? lastMessage.content : JSON.stringify(lastMessage.content);

  onLog("Research complete.");
  onLog("Research complete. Handing brief to Investment Committee for a decision...");

  // --- Decision step: call ChatReplicate (no tools), parse JSON, validate with Zod, retry once ---
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
