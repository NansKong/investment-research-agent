import { BaseChatModel, type BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models";
import { AIMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
import { ChatResult } from "@langchain/core/outputs";
import type { BindToolsInput } from "@langchain/core/language_models/chat_models";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import Replicate from "replicate";

export class ChatReplicate extends BaseChatModel {
  replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  temperature: number;
  private boundTools: BindToolsInput[] = [];

  constructor(fields?: { temperature?: number }) {
    super({});
    this.temperature = fields?.temperature ?? 0.2;
  }

  _llmType() {
    return "replicate-gpt-4.1-mini";
  }

  bindTools(tools: BindToolsInput[]) {
    const copy = new ChatReplicate({ temperature: this.temperature });
    copy.boundTools = tools;
    return copy;
  }

  /**
   * When tools are bound, inject instructions into the system prompt telling
   * the model how to "call" a tool via a JSON object. This emulates native
   * function-calling for providers that don't support it.
   */
  private toolInstructions(): string {
    if (this.boundTools.length === 0) return "";

    const toolLines = this.boundTools
      .map((t: any) => {
        const name = t.name ?? "unknown";
        const desc = t.description ?? "";
        // Build a human-readable arg list from the Zod schema shape
        let argsExample = "{}";
        try {
          const shape = t.schema?.shape;
          if (shape) {
            const keys = Object.keys(shape);
            const pairs = keys.map((k: string) => `"${k}": "<string>"`).join(", ");
            argsExample = `{ ${pairs} }`;
          }
        } catch {
          // fall back to generic
        }
        return `  ${name}: ${desc}\n    Example: {"tool_call": {"name": "${name}", "args": ${argsExample}}}`;
      })
      .join("\n\n");

    return [
      "",
      "",
      "You have these tools available:",
      "",
      toolLines,
      "",
      "IMPORTANT RULES:",
      "- To call a tool, reply with ONLY a JSON object in this exact format:",
      '  {"tool_call": {"name": "<tool_name>", "args": {<exact arg names as shown above>}}}',
      "- Use the EXACT argument names shown above. Do NOT rename them.",
      "- When you are done and want to give your final answer, reply with ONLY:",
      '  {"final_answer": "<your answer text>"}',
      "- Never output anything outside the JSON object. No prose, no markdown fences.",
    ].join("\n");
  }

  async _generate(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const system = messages.find((m) => m._getType() === "system")?.content ?? "";
    const rest = messages
      .filter((m) => m._getType() !== "system")
      .map((m) => {
        if (m._getType() === "ai" && (m as AIMessage).tool_calls?.length) {
          const calls = (m as AIMessage).tool_calls!
            .map((c) => `${c.name}(${JSON.stringify(c.args)})`)
            .join(", ");
          return `ai: [called tool: ${calls}]`;
        }
        if (m._getType() === "tool") {
          return `tool result (${(m as ToolMessage).name}): ${m.content}`;
        }
        return `${m._getType()}: ${m.content}`;
      })
      .join("\n\n");

    const output = await this.replicate.run("openai/gpt-4.1-mini", {
      input: {
        prompt: rest,
        system_prompt: String(system) + this.toolInstructions() + "\n[ignoring loop detection]",
        temperature: this.temperature,
        max_completion_tokens: 4096,
      },
    });
    const text = Array.isArray(output) ? output.join("") : String(output);

    const aiMessage = this.parseIntoMessage(text);
    return { generations: [{ text, message: aiMessage }] };
  }

  /**
   * Parse the model's raw text response into an AIMessage. If tools are bound
   * and the model returned a tool_call JSON, populate the tool_calls array on
   * the AIMessage — this is what ToolNode reads to dispatch automatically.
   */
  private parseIntoMessage(text: string): AIMessage {
    if (this.boundTools.length === 0) {
      // No tools bound — plain text mode
      return new AIMessage(text);
    }

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return new AIMessage(text); // no JSON found — treat as final answer

    try {
      const parsed = JSON.parse(match[0]);

      // Model is calling a tool
      if (parsed.tool_call?.name) {
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              name: parsed.tool_call.name,
              args: parsed.tool_call.args ?? {},
              id: `call_${Math.random().toString(36).slice(2)}`,
              type: "tool_call" as const,
            },
          ],
        });
      }

      // Model is giving a final answer
      if (typeof parsed.final_answer === "string") {
        return new AIMessage(parsed.final_answer);
      }
    } catch {
      // JSON parse failed — fall through to plain text
    }

    return new AIMessage(text);
  }
}
