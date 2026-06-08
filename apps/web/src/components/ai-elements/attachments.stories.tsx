import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Attachment,
  type AttachmentData,
  AttachmentEmpty,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "./attachments";

const meta = {
  title: "AI Elements/Attachments",
  component: Attachments,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof Attachments>;

export default meta;
type Story = StoryObj<typeof meta>;

// A 1x1 transparent PNG data URL so the image preview renders without network access.
const SAMPLE_IMAGE_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#6366f1"/><circle cx="48" cy="48" r="22" fill="#fff" opacity="0.85"/></svg>`,
  );

const IMAGE_ATTACHMENT: AttachmentData = {
  id: "att-image",
  type: "file",
  mediaType: "image/png",
  filename: "architecture-diagram.png",
  url: SAMPLE_IMAGE_URL,
};

const SAMPLE_ATTACHMENTS: AttachmentData[] = [
  IMAGE_ATTACHMENT,
  {
    id: "att-pdf",
    type: "file",
    mediaType: "application/pdf",
    filename: "roadmap-q3.pdf",
    url: "https://example.local/roadmap-q3.pdf",
  },
  {
    id: "att-source",
    type: "source-document",
    sourceId: "src-notion",
    mediaType: "text/markdown",
    title: "Taxonomy Suggestion Plan",
    filename: "taxonomy-suggestion-plan.md",
  },
];

const noop = () => {};

/** Grid variant — square media tiles with a hover remove button. */
export const Grid: Story = {
  render: () => (
    <Attachments variant="grid">
      {SAMPLE_ATTACHMENTS.map((data) => (
        <Attachment key={data.id} data={data} onRemove={noop}>
          <AttachmentPreview />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  ),
};

/** Inline variant — compact chips suited to a prompt input row. */
export const Inline: Story = {
  render: () => (
    <Attachments variant="inline">
      {SAMPLE_ATTACHMENTS.map((data) => (
        <Attachment key={data.id} data={data} onRemove={noop}>
          <AttachmentPreview />
          <AttachmentInfo />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  ),
};

/** List variant — full-width rows with preview, name, media type, and remove. */
export const List: Story = {
  render: () => (
    <div className="w-96">
      <Attachments variant="list">
        {SAMPLE_ATTACHMENTS.map((data) => (
          <Attachment key={data.id} data={data} onRemove={noop}>
            <AttachmentPreview />
            <AttachmentInfo showMediaType />
            <AttachmentRemove />
          </Attachment>
        ))}
      </Attachments>
    </div>
  ),
};

/** Read-only — without `onRemove`, the remove button renders nothing. */
export const ReadOnly: Story = {
  render: () => (
    <Attachments variant="grid">
      {SAMPLE_ATTACHMENTS.map((data) => (
        <Attachment key={data.id} data={data}>
          <AttachmentPreview />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  ),
};

/** A grid tile wrapped in a hover card revealing the full filename and type. */
export const WithHoverCard: Story = {
  render: () => {
    const data = IMAGE_ATTACHMENT;
    return (
      <Attachments variant="grid">
        <Attachment data={data} onRemove={noop}>
          <AttachmentHoverCard>
            <AttachmentHoverCardTrigger
              render={
                <div className="size-full">
                  <AttachmentPreview />
                </div>
              }
            />
            <AttachmentHoverCardContent>
              <div className="text-sm text-fg">{data.filename}</div>
              <div className="text-xs text-fg-mute">{data.mediaType}</div>
            </AttachmentHoverCardContent>
          </AttachmentHoverCard>
          <AttachmentRemove />
        </Attachment>
      </Attachments>
    );
  },
};

/** The empty state shown when there are no attachments. */
export const Empty: Story = {
  render: () => (
    <div className="w-96 rounded-md border border-hairline">
      <AttachmentEmpty />
    </div>
  ),
};
