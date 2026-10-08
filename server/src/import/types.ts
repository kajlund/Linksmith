export interface MarkdownFile {
  name: string;
  text: string;
}
export interface Occurrence {
  file: string;
  line: number;
  endLine: number;
  headings: string[];
  parent: string;
  excerpt: string;
  description: string;
}
export interface ImportCandidate {
  id: string;
  name: string;
  url: string;
  description: string;
  notes: string;
  category: string;
  tags: string[];
  included: boolean;
  reviewed: boolean;
  warnings: string[];
  occurrences: Occurrence[];
  existing: { id: string; name: string; url: string }[];
}
export interface Exclusion {
  file: string;
  line: number;
  reason: string;
  excerpt: string;
}
export interface FileReport {
  name: string;
  context: string;
  occurrences: number;
  candidates: number;
  duplicates: number;
  warnings: number;
  exclusions: number;
}
export interface ImportPreview {
  candidates: ImportCandidate[];
  exclusions: Exclusion[];
  files: FileReport[];
  limits: typeof importLimits;
}
export const importLimits = {
  files: 20,
  fileBytes: 256 * 1024,
  totalBytes: 1024 * 1024,
  previewBytes: 4 * 1024 * 1024,
  candidates: 1000,
  batch: 500,
};
export interface ImportEntry {
  id: string;
  reviewed: boolean;
  name: string;
  url: string;
  description: string;
  notes: string;
  category: string;
  tags: string[];
}
export interface ImportResult {
  created: number;
  skipped: number;
  failed: number;
  results: {
    id: string;
    status: 'created' | 'skipped';
    resourceId: string;
    name: string;
  }[];
}
