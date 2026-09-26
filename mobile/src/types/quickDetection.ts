export type QuickMode = 'caged' | 'free_range';
export type QuickSource = 'camera' | 'gallery';
export interface QuickDetection {
 quick_detection_id: string; record_type: 'quick_detection'; source_label: string;
 farming_type: QuickMode; source_type: QuickSource; status: 'processing' | 'succeeded' | 'failed'; error_code: string | null;
 created_at: string; completed_at: string | null;
 normal_count: number | null; low_count: number | null; total_count: number | null;
 normal_ratio: number | null; low_ratio: number | null;
 image_url: string | null; annotated_image_url: string | null;
 previous_id?: string | null; next_id?: string | null;
 provenance?: {orientation_normalized?: boolean; limitation_note?: string | null};
}
export interface QuickPhoto { uri: string; mimeType?: string | null; fileName?: string | null; fileSize?: number; }
export interface QuickDraft {photo: QuickPhoto; mode: QuickMode; source: QuickSource; requestId: string;}
