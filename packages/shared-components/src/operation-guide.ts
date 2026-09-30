export interface GuideAction {
  label: string;
  to: string;
}

export interface GuideCard {
  id: string;
  title: string;
  description: string;
  instructions: string[];
  action?: GuideAction;
  secondaryAction?: GuideAction;
}

/** Display-only guidance; navigation never implies completion of a business step. */
export interface OperationGuideModel {
  storageKey: string;
  audience: string;
  description: string;
  steps: GuideCard[];
  management: GuideCard[];
}
