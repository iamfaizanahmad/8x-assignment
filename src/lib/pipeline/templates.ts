import type { TemplateId } from "@/db/schema";

export const TEMPLATES: Record<TemplateId, { name: string; description: string; instructions: string }> = {
  general: {
    name: "General",
    description: "Key takeaways, topics and next steps",
    instructions:
      "Sections: 'Key takeaways' (3-6 bullets), then one section per major topic discussed (named after the topic), then 'Next steps'.",
  },
  sales: {
    name: "Sales call",
    description: "Pain points, budget, objections, next steps",
    instructions:
      "Sections: 'Prospect context', 'Pain points', 'Current solution', 'Budget & timeline', 'Decision makers', 'Objections', 'Next steps'. Omit a section only if nothing relevant was said.",
  },
  one_on_one: {
    name: "1:1",
    description: "Wins, blockers, feedback, growth",
    instructions:
      "Sections: 'Updates & wins', 'Blockers & concerns', 'Feedback given', 'Career & growth', 'Follow-ups'. Omit a section only if nothing relevant was said.",
  },
  standup: {
    name: "Standup",
    description: "Per-person done / doing / blocked",
    instructions:
      "One section per participant (heading = their name or speaker label). Prefix each bullet with 'Done:', 'Next:' or 'Blocked:'.",
  },
  project_sync: {
    name: "Project sync",
    description: "Status, decisions, risks, owners",
    instructions:
      "Sections: 'Status', 'Decisions made', 'Open questions', 'Risks', 'Owners & deadlines'.",
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];
