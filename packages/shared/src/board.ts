export type BoardRole = 'owner' | 'editor' | 'viewer';

export interface BoardSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface CanvasObject {
  id: string;
  type: 'stroke' | 'shape' | 'text' | 'sticky' | 'image';
  properties: Record<string, unknown>;
}
