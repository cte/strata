import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ChatStatus } from "ai";
import { Globe, Mic, Paperclip } from "lucide-react";
import { useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController,
} from "./prompt-input";

const noopSubmit = (_message: PromptInputMessage): void => {
  // no-op handler for stories
};

const meta = {
  title: "AI Elements/Prompt Input",
  component: PromptInput,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    onSubmit: noopSubmit,
  },
  // PromptInputButton renders a Tooltip when given `tooltip`, so every story
  // needs a TooltipProvider ancestor (the app provides one at the chat surface).
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof PromptInput>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The full chat composer: a textarea, a tools row with an action menu and a
 * couple of buttons, and a submit button. State is lifted into the optional
 * `PromptInputProvider`; `usePromptInputController` wires the textarea value.
 */
function ComposerDemo({
  placeholder = "Ask about priorities, projects, or open threads…",
  status,
}: {
  placeholder?: string;
  status?: ChatStatus;
}) {
  return (
    <PromptInputProvider>
      <div className="mx-auto w-full max-w-2xl">
        <PromptInput onSubmit={noopSubmit}>
          <PromptInputBody>
            <PromptInputTextarea placeholder={placeholder} />
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                    <PromptInputActionAddScreenshot />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                <PromptInputButton tooltip="Search the web">
                  <Globe className="!size-3.5" />
                </PromptInputButton>
                <PromptInputButton tooltip="Attach a file">
                  <Paperclip className="!size-3.5" />
                </PromptInputButton>
                <PromptInputButton tooltip="Dictate">
                  <Mic className="!size-3.5" />
                </PromptInputButton>
              </PromptInputTools>
              {status ? <PromptInputSubmit status={status} /> : <PromptInputSubmit />}
            </PromptInputFooter>
          </PromptInputBody>
        </PromptInput>
      </div>
    </PromptInputProvider>
  );
}

/** Seeds the controller with draft text so the composer renders with content. */
function PrefilledControllerSeed({ text }: { text: string }) {
  const controller = usePromptInputController();
  const [seeded, setSeeded] = useState(false);
  if (!seeded && controller.textInput.value === "") {
    controller.textInput.setInput(text);
    setSeeded(true);
  }
  return null;
}

function PrefilledComposerDemo() {
  return (
    <PromptInputProvider>
      <PrefilledControllerSeed text="Draft a follow-up note summarizing the taxonomy review decision and tag the owners for sign-off." />
      <div className="mx-auto w-full max-w-2xl">
        <PromptInput onSubmit={noopSubmit}>
          <PromptInputBody>
            <PromptInputTextarea placeholder="Type a message…" />
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                    <PromptInputActionAddScreenshot />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                <PromptInputButton tooltip="Search the web">
                  <Globe className="!size-3.5" />
                </PromptInputButton>
              </PromptInputTools>
              <PromptInputSubmit />
            </PromptInputFooter>
          </PromptInputBody>
        </PromptInput>
      </div>
    </PromptInputProvider>
  );
}

/** The empty composer, ready for input. */
export const Default: Story = {
  render: () => <ComposerDemo />,
};

/** The composer pre-filled with a drafted message via the controller. */
export const WithDraftText: Story = {
  render: () => <PrefilledComposerDemo />,
};

/** While the model is streaming, the submit button shows a stop affordance. */
export const Streaming: Story = {
  render: () => (
    <ComposerDemo placeholder="Generating a response…" status={"streaming" as ChatStatus} />
  ),
};

/**
 * A minimal variant inside an elevated panel, mirroring how the composer docks
 * at the bottom of the chat surface.
 */
export const InContext: Story = {
  render: () => (
    <div className={cn("rounded-md border border-hairline bg-bg-elev p-4")}>
      <p className="label-eyebrow mb-3">New message</p>
      <ComposerDemo placeholder="Send a message to the agent…" />
    </div>
  ),
};
