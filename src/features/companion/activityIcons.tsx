import { BookOpen, Cookie, Gamepad2, Headphones, NotebookPen } from 'lucide-react';
import type { Activity } from '../../types';

// One icon per life activity in shared/activities.json.
export const activityIcons: Record<Activity, typeof BookOpen> = {
  office: NotebookPen,
  read: BookOpen,
  gaming: Gamepad2,
  snack: Cookie,
  music: Headphones,
  diary: NotebookPen,
};
