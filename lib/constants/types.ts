/** Shared shape for Muscadine Pages / curator link cards. */
export type ExternalLinkItem = {
  name: string;
  url: string;
  description: string;
  displayText?: string;
};

export type MorphoAutomationBot = {
  title: string;
  description: string;
  body: string;
  href: string;
};
