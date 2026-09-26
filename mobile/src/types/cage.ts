export type CageStatus =
  | 'normal'
  | 'attention'
  | 'warning'
  | 'offline';

export type Cage = {
  id: string;
  name: string;
  status: CageStatus;

  normalRatio: number | null;

  highBirds: number;
  lowBirds: number;
  totalBirds: number;

  updatedText: string;
};