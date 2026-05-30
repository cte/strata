import { Inbox } from "lucide-react";
import type * as React from "react";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { TaxonomyReviewQueue } from "@/components/taxonomy-review-queue";
import { TabsIndicator, TabsList, TabsPanel, TabsRoot, TabsTab } from "@/components/ui/tabs";
import { ProposalsReview } from "@/routes/proposals";

/**
 * The unified review inbox. Two tabs: "Reviews" teaches the taxonomy by
 * confirming or correcting raw-to-wiki classification outcomes (corrections
 * apply immediately), and "Approvals" approves staged proposals (wiki, memory,
 * skill, schema) before they touch durable state. Replaces the former separate
 * `/proposals` and `/ingest-taxonomy` review surfaces.
 */
export function ReviewPage(): React.ReactElement {
  return (
    <PageContainer width="wide">
      <PageHeader
        icon={<Inbox size={15} strokeWidth={1.75} />}
        title="Review"
        description="Teach the taxonomy from ingest outcomes, and approve staged changes before they touch durable state."
      />

      <TabsRoot defaultValue="reviews">
        <TabsList>
          <TabsTab value="reviews">Reviews</TabsTab>
          <TabsTab value="approvals">Approvals</TabsTab>
          <TabsIndicator />
        </TabsList>

        <TabsPanel value="reviews">
          <TaxonomyReviewQueue />
        </TabsPanel>
        <TabsPanel value="approvals">
          <ProposalsReview />
        </TabsPanel>
      </TabsRoot>
    </PageContainer>
  );
}
