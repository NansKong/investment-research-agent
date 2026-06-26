import { SimpleChatModel } from "@langchain/core/language_models/chat_models";
import { BaseMessage } from "@langchain/core/messages";
import Replicate from "replicate";

export class ChatReplicate extends SimpleChatModel {
  replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  temperature: number;

  constructor(fields?: { temperature?: number }) {
    super({});
    this.temperature = fields?.temperature ?? 0.2;
  }

  _llmType() {
    return "replicate-gpt-4.1-mini";
  }

  async _call(messages: BaseMessage[]): Promise<string> {
    const system = messages.find((m) => m._getType() === "system")?.content ?? "";
    const rest = messages
      .filter((m) => m._getType() !== "system")
      .map((m) => `${m._getType()}: ${m.content}`)
      .join("\n\n");

    const output = await this.replicate.run("openai/gpt-4.1-mini", {
      input: {
        prompt: rest,
        system_prompt: String(system),
        temperature: this.temperature,
        max_completion_tokens: 4096,
      },
    });
    return Array.isArray(output) ? output.join("") : String(output);
  }
}
